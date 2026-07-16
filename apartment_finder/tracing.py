"""
P3.5-1 — Langfuse tracing across the ADK agent pipeline.

Instruments the whole Manager -> ResearchTeam -> Analyst/Reviewer/Summarizer tree
(including tool calls and the Gemini `google_search` grounding call) with a single
call, via Google's OpenInference instrumentor for ADK. No-op unless
LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY are set, so importing/calling this is
always safe (per the user's 2026-07-15 request: wire the code, leave keys blank
until a Langfuse account exists).

Docs used (fetched live, not from training-data memory, per the Langfuse skill's
"documentation first" rule — the recommended API changed since P3.5-1 was first
scoped in the backlog):
- https://langfuse.com/integrations/frameworks/google-adk
- https://langfuse.com/integrations/frameworks/litellm-sdk (evaluated, not used —
  see note below)

Why GoogleADKInstrumentor alone (not also the separate LiteLLM callback the backlog
originally speculated about): `analyst`/`summarizer`/`manager` run on
`LiteLlm(...)`, but ADK dispatches every agent's model call through the same
`BaseLlm.generate_content_async` regardless of backend, and the ADK instrumentor
wraps at that layer — so it already captures the LiteLLM-backed agents too, in the
same trace tree as the Gemini `reviewer` and every tool call. Adding LiteLLM's own
`litellm.callbacks = ["langfuse_otel"]` on top would double-instrument those same
calls (two spans per LiteLLM completion, exported separately), which fights the
"one trace tree per search" goal from the backlog's acceptance criteria.
"""
import os
from contextlib import nullcontext

enabled = False


def init() -> bool:
    """
    Call once at process startup, AFTER environment variables are loaded (.env or
    OS env) — Langfuse must be configured before any agent code runs, and before
    `openinference` patches ADK's call path. Idempotent; returns whether tracing
    is active.
    """
    global enabled
    if enabled:
        return True
    if not (os.getenv("LANGFUSE_PUBLIC_KEY") and os.getenv("LANGFUSE_SECRET_KEY")):
        print("   ℹ️  Langfuse tracing disabled (LANGFUSE_PUBLIC_KEY/LANGFUSE_SECRET_KEY not set).")
        return False

    try:
        from langfuse import get_client
        from openinference.instrumentation.google_adk import GoogleADKInstrumentor
    except ImportError:
        print("   ⚠️  Langfuse tracing disabled — `pip install -r requirements.txt` to get the packages.")
        return False

    client = get_client()
    if not client.auth_check():
        print("   ⚠️  Langfuse auth check failed (bad keys/host?). Tracing disabled.")
        return False

    GoogleADKInstrumentor().instrument()
    enabled = True
    print("   📊 Langfuse tracing enabled — traces will appear in your Langfuse project's Traces tab.")
    return True


def session_scope(session_id: str, user_id: str | None = None):
    """
    Tag every span created during a conversation turn with the ADK session_id, so
    a multi-turn search (see FU-1) groups into one Langfuse Session instead of
    scattering across unrelated traces. No-op (nullcontext) when tracing is off.
    """
    if not enabled:
        return nullcontext()
    from langfuse import propagate_attributes
    return propagate_attributes(
        session_id=session_id,
        user_id=user_id,
        tags=["apartment-search"],
    )
