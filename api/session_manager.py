"""
Manages ADK InMemoryRunner sessions for the FastAPI server.
One (runner, session_id) pair per user conversation.
"""
import asyncio
import re
import uuid
from typing import AsyncGenerator
from google.adk.runners import InMemoryRunner
from google.adk.events import Event, EventActions
from google.genai import types
from apartment_finder.agent import root_agent
from apartment_finder.tools import _compute_requirements

# In-memory registry: session_id → (runner, adk_session_id, user_id)
_sessions: dict[str, tuple[InMemoryRunner, str, str]] = {}

# Cancel flags: session_id → bool
_cancel_flags: dict[str, bool] = {}

MAX_RETRIES = 3

AGENT_LABELS = {
    "manager": ("Manager", "Collecting your requirements…"),
    "analyst": ("Analyst", "Searching listings & checking commutes…"),
    "reviewer": ("Reviewer", "Researching neighborhood safety…"),
    "summarizer": ("Summarizer", "Writing your recommendation…"),
    "ResearchTeam": ("Research Team", "Running full research pipeline…"),
}


async def create_session() -> str:
    """Create a new ADK session and return an opaque session_id."""
    session_id = str(uuid.uuid4())
    runner = InMemoryRunner(agent=root_agent, app_name="apartment_finder")
    adk_session = await runner.session_service.create_session(
        app_name="apartment_finder",
        user_id=session_id,
    )
    _sessions[session_id] = (runner, adk_session.id, session_id)
    _cancel_flags[session_id] = False
    return session_id


def cancel_session(session_id: str) -> bool:
    """Signal the streaming loop for session_id to stop. Returns True if session exists."""
    if session_id in _cancel_flags:
        _cancel_flags[session_id] = True
        return True
    return False


async def stream_message(
    session_id: str,
    message: str,
    requirements: dict | None = None,
) -> AsyncGenerator[dict, None]:
    """
    Send a message to an existing session and yield SSE event dicts.

    If `requirements` (F3 structured-intake payload) is provided, session state is
    pre-seeded deterministically via `_seed_requirements` and the Manager is told
    to skip intake and delegate straight to the ResearchTeam.

    Yields:
      {"type": "status",  "agent": str, "step": str}
      {"type": "token",   "content": str, "author": str}
      {"type": "waiting", "seconds": int, "agent": str}
      {"type": "state",   "analyst_dossier": str, "safety_report": str}
      {"type": "error",   "content": str}
      {"type": "done"}
    """
    if session_id not in _sessions:
        yield {"type": "error", "content": "Session not found."}
        yield {"type": "done"}
        return

    runner, adk_session_id, user_id = _sessions[session_id]

    message_text = message
    if requirements:
        has_required = all(requirements.get(k) for k in ("city", "state", "budget", "landmark"))
        if has_required:
            # Fully-structured intake: pre-seed state deterministically (no LLM parse).
            # get_session returns a copy, so persist the delta via an event state_delta.
            computed = _compute_requirements(**requirements)
            if computed.get("error"):
                yield {"type": "error", "content": computed["message"]}
                yield {"type": "done"}
                return
            adk_session = await runner.session_service.get_session(
                app_name="apartment_finder",
                user_id=user_id,
                session_id=adk_session_id,
            )
            await runner.session_service.append_event(
                adk_session,
                Event(author="user", actions=EventActions(state_delta=computed["delta"])),
            )
            message_text = (
                "[STRUCTURED_INTAKE] The user's housing requirements have already been "
                "collected and saved to session state "
                f"(city={requirements.get('city')}, state={requirements.get('state')}, "
                f"budget={requirements.get('budget')}, landmark={requirements.get('landmark')}). "
                "Do NOT call store_requirements. Delegate to the ResearchTeam immediately."
            )
        else:
            # P2-5 optional-only payload from RequirementCards: the 4 required fields are
            # still in the free-text message (only the Manager can parse them). Seed the
            # optional prefs into `pending_optional`; store_requirements folds them in,
            # so proximity/beds/baths/roommates flow deterministically without the LLM
            # having to pass a nested list.
            optional = {
                k: requirements[k]
                for k in ("min_bedrooms", "min_bathrooms", "roommates",
                          "budget_is_per_person", "proximity")
                if requirements.get(k)
            }
            if optional:
                adk_session = await runner.session_service.get_session(
                    app_name="apartment_finder",
                    user_id=user_id,
                    session_id=adk_session_id,
                )
                import json as _json
                await runner.session_service.append_event(
                    adk_session,
                    Event(author="user", actions=EventActions(
                        state_delta={"pending_optional": _json.dumps(optional)})),
                )
                message_text = (
                    f"{message}\n\n[STRUCTURED_PREFERENCES] The user set optional preferences "
                    "in the UI; they are already saved to session state and will be applied "
                    "automatically. Parse the 4 REQUIRED fields (city, state, budget, landmark) "
                    "from the message above and call store_requirements with just those four. "
                    "Do NOT try to pass the optional preferences yourself."
                )

    new_message = types.Content(
        role="user",
        parts=[types.Part(text=message_text)],
    )

    last_active_agent = "Manager"
    run_error: str | None = None

    _cancel_flags[session_id] = False  # reset on each new message

    for attempt in range(MAX_RETRIES):
        seen_authors: set[str] = set()

        try:
            async for event in runner.run_async(
                user_id=user_id,
                session_id=adk_session_id,
                new_message=new_message,
            ):
                if _cancel_flags.get(session_id):
                    yield {"type": "done"}
                    return

                author = getattr(event, "author", None) or ""

                # Emit a status event the first time we see each sub-agent
                if author and author != "user" and author not in seen_authors:
                    seen_authors.add(author)
                    label, step = AGENT_LABELS.get(author, (author.title(), f"{author} is working…"))
                    last_active_agent = label
                    yield {"type": "status", "agent": label, "step": step}

                # Stream text tokens; also detect tool calls for fallback status events.
                # ADK sub-agents don't always surface their name in event.author, so we
                # infer Analyst / Reviewer activity from which tool is being invoked.
                content = event.content
                if content and content.parts:
                    for part in content.parts:
                        fn_call = getattr(part, "function_call", None)
                        if fn_call:
                            fn_name = getattr(fn_call, "name", "") or ""
                            if fn_name in ("fetch_apartments", "check_commutes") and "analyst" not in seen_authors:
                                seen_authors.add("analyst")
                                label, step = AGENT_LABELS["analyst"]
                                last_active_agent = label
                                yield {"type": "status", "agent": label, "step": step}
                            elif fn_name == "google_search" and "reviewer" not in seen_authors:
                                seen_authors.add("reviewer")
                                label, step = AGENT_LABELS["reviewer"]
                                last_active_agent = label
                                yield {"type": "status", "agent": label, "step": step}

                        if part.text:
                            yield {"type": "token", "content": part.text, "author": author}

            # Successful run — exit retry loop
            break

        except Exception as exc:
            error_msg = str(exc)
            is_rate_limit = "429" in error_msg or "RESOURCE_EXHAUSTED" in error_msg

            # 429 / RESOURCE_EXHAUSTED = free-tier RPM limit → worth retrying the whole
            # pipeline after a visible backoff countdown.
            if is_rate_limit and attempt < MAX_RETRIES - 1:
                delay_match = re.search(r"retry in (\d+)", error_msg, re.IGNORECASE)
                wait_seconds = int(delay_match.group(1)) if delay_match else 35

                # Stream countdown events every 5s to keep SSE alive and update the UI
                remaining = wait_seconds
                while remaining > 0:
                    yield {"type": "waiting", "seconds": remaining, "agent": last_active_agent}
                    sleep_for = min(5, remaining)
                    await asyncio.sleep(sleep_for)
                    remaining -= sleep_for

                # Loop back for retry (seen_authors resets at top of loop)
                continue

            # Any other terminal error — including a downstream Gemini 503 "model
            # overloaded" on the Reviewer — must NOT discard the run. Record it and
            # break, so we still emit whatever partial results the Analyst already
            # wrote to session state below. Re-running would waste provider quota
            # redoing Analyst work that already succeeded.
            run_error = error_msg
            break

    # Emit session state (partial OR complete) so the frontend can render cards even when
    # a downstream stage failed. The Analyst writes `analyst_dossier` BEFORE the Reviewer
    # runs, so listings/commutes/proximity survive a Reviewer/Summarizer failure.
    try:
        adk_session = await runner.session_service.get_session(
            app_name="apartment_finder",
            user_id=user_id,
            session_id=adk_session_id,
        )
        state = adk_session.state if adk_session else {}
        if not run_error or state.get("analyst_dossier") or state.get("final_recommendation"):
            yield {
                "type": "state",
                "analyst_dossier": state.get("analyst_dossier", ""),
                "safety_report": state.get("safety_report", ""),
                "user_requirements": state.get("user_requirements", ""),
                "final_recommendation": state.get("final_recommendation", ""),
                "landmark_lat": state.get("landmark_lat"),
                "landmark_lng": state.get("landmark_lng"),
                "landmark_name": state.get("landmark_name", ""),
            }
    except Exception:
        pass

    if run_error:
        low = run_error.lower()
        if "503" in run_error or "unavailable" in low or "overloaded" in low:
            yield {
                "type": "error",
                "content": (
                    "The safety-research step (Gemini) is temporarily overloaded, so I couldn't "
                    "finish the full write-up. I've shown the listings, commutes, and proximity I "
                    "found — please try again shortly for the safety summary and ranked recommendation."
                ),
            }
        elif "429" in run_error or "resource_exhausted" in low:
            yield {
                "type": "error",
                "content": "Rate limit reached. Please wait a moment and try again.",
            }
        else:
            yield {"type": "error", "content": f"An error occurred: {run_error[:200]}"}

    yield {"type": "done"}


async def get_session_state(session_id: str) -> dict:
    """Return raw ADK session state for a given session."""
    if session_id not in _sessions:
        return {}
    runner, adk_session_id, user_id = _sessions[session_id]
    try:
        adk_session = await runner.session_service.get_session(
            app_name="apartment_finder",
            user_id=user_id,
            session_id=adk_session_id,
        )
        return dict(adk_session.state) if adk_session else {}
    except Exception:
        return {}
