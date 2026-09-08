import asyncio
from typing import AsyncGenerator
from google.adk.agents import LlmAgent, SequentialAgent
from google.genai import types
from google.adk.models.base_llm import BaseLlm
from google.adk.models.google_llm import Gemini
from google.adk.models.lite_llm import LiteLlm
from google.adk.tools import FunctionTool
from google.adk.tools import google_search
from . import instructions
from . import tools
from . import tracing

# P3.5-1: instrument the agent tree for Langfuse before any agent runs. Must come
# after environment variables are loaded — `adk web` loads .env before importing
# this module; main.py / api/server.py call load_dotenv() before importing it too
# (see the ordering note in each). No-op if Langfuse keys aren't set.
tracing.init()

# Retry policy for the Gemini-backed Reviewer. We deliberately keep ONLY 429 here:
# exp_base=7 makes 429 (free-tier RPM quota) retries wait 7→49→343s so they land
# OUTSIDE the 60s RPM window and the quota refills (exp_base=2 retries inside the
# window and fails — do NOT lower it). Transient capacity errors (503/500/504
# "overloaded") are handled separately by ResilientGemini below with a SHORT retry +
# model fallback, because exp_base=7 would stall a 503 for minutes.
retry_config = types.HttpRetryOptions(
    attempts=5,
    exp_base=7,
    initial_delay=1,
    http_status_codes=[429],
)


class ResilientGemini(BaseLlm):
    """
    Wraps a primary Gemini model so the Reviewer survives Google-side capacity blips.

    On a transient error (503 UNAVAILABLE / "model overloaded" / 500 INTERNAL / 504
    DEADLINE) from the primary, it does a few SHORT retries, then falls back ONCE to a
    higher-capacity model. 429 (quota) is NOT treated as transient here — it propagates
    so the underlying exp_base=7 retry + the session bridge handle it. Each attempt runs
    on a deep copy of the request so ADK's in-place request mutations don't compound.
    """
    primary: BaseLlm
    fallback: BaseLlm
    transient_retries: int = 2
    retry_delay_s: float = 3.0

    async def generate_content_async(
        self, llm_request, stream: bool = False
    ) -> AsyncGenerator:
        attempt = 0
        while True:
            yielded = False
            try:
                async for resp in self.primary.generate_content_async(
                    llm_request.model_copy(deep=True), stream=stream
                ):
                    yielded = True
                    yield resp
                return
            except Exception as exc:
                if yielded:
                    raise  # already streamed partial output — unsafe to retry/fallback
                up = str(exc).upper()
                transient = any(
                    k in up for k in ("503", "504", "UNAVAILABLE", "OVERLOADED", "INTERNAL", "DEADLINE")
                )
                if not transient:
                    raise  # e.g. 429 → let exp_base=7 / the bridge handle it
                if attempt < self.transient_retries:
                    attempt += 1
                    await asyncio.sleep(self.retry_delay_s)
                    continue
                # Quick retries exhausted → fall back once to the bigger-capacity model.
                print(
                    f"   ⚠️  Reviewer: '{self.primary.model}' transient error after "
                    f"{attempt} retries — falling back to '{self.fallback.model}'."
                )
                async for resp in self.fallback.generate_content_async(
                    llm_request.model_copy(deep=True), stream=stream
                ):
                    yield resp
                return


# Gemini kept ONLY for Reviewer — google_search grounding requires a Gemini model.
# flash-lite primary (cheapest); on a 503/overload, fall back to full flash (separate
# capacity pool, usually available when lite is shedding load).
gemini_model = ResilientGemini(
    model="gemini-2.5-flash-lite",
    primary=Gemini(model="gemini-2.5-flash-lite", retry_options=retry_config),
    fallback=Gemini(model="gemini-2.5-flash", retry_options=retry_config),
)

# OpenAI for all other agents; reduces Gemini calls by ~75% per query.
# OPENAI_API_KEY is read automatically from .env.
openai_model = LiteLlm(model="openai/gpt-4o-mini", num_retries=5)

# --- 1. THE ANALYST AGENT ---
analyst = LlmAgent(
    name="analyst",
    model=openai_model,
    description="Executes tools to find and analyze apartments.",
    instruction=instructions.ANALYST_PROMPT,
    tools=[
        FunctionTool(tools.fetch_apartments),
        FunctionTool(tools.check_commutes),
        FunctionTool(tools.find_nearby_amenities),
    ],
    output_key="analyst_dossier"
)

# --- DETERMINISTIC STATUS-ROUTING GUARDS ---
# `tools.fetch_apartments` records the TRUE search outcome in session state
# (`search_status`) the moment it computes results — in code, not prose. The
# Reviewer/Summarizer are still supposed to relay that via the "STATUS: NO_RESULTS"
# marker in their own text, but that's LLM instruction-following stretched across
# two more hops, and it can misfire (a stray substring match, or the Summarizer
# conflating "nothing in budget" with "nothing found"). These callbacks make the
# code-computed flag win instead of trusting prose for this specific decision.

def _reviewer_before_callback(callback_context):
    """Skip the Gemini/google_search call entirely for a genuine zero-results
    search — cheaper (saves a Gemini call) and, unlike the prompt-only early-exit
    check it replaces, can't misfire on unrelated text in the dossier."""
    if callback_context.state.get("search_status") == "no_results":
        callback_context.state["safety_report"] = "STATUS: NO_RESULTS"
        return types.Content(role="model", parts=[types.Part(text="STATUS: NO_RESULTS")])
    return None


def _summarizer_before_callback(callback_context):
    """Safety net: if `search_status` says real listings exist but safety_report
    nonetheless collapsed to the NO_RESULTS bail-out, rebuild the reply from state
    directly (no LLM call) instead of letting the Summarizer stream a false
    negative to the user. See tools.build_fallback_recommendation."""
    fallback = tools.build_fallback_recommendation(callback_context.state)
    if fallback is None:
        return None
    callback_context.state["final_recommendation"] = fallback
    return types.Content(role="model", parts=[types.Part(text=fallback)])


# --- 2. THE REVIEWER AGENT ---
reviewer = LlmAgent(
    name="reviewer",
    model=gemini_model,
    description="Checks neighborhood safety.",
    instruction=instructions.REVIEWER_PROMPT,
    tools=[google_search],
    output_key="safety_report",
    before_agent_callback=_reviewer_before_callback,
)

# --- 3. THE SUMMARIZER AGENT ---
summarizer = LlmAgent(
    name="summarizer",
    model=openai_model,
    description="Compiles research into a final pitch.",
    instruction=instructions.SUMMARIZER_PROMPT,
    output_key="final_recommendation",
    before_agent_callback=_summarizer_before_callback,
)

# --- THE RESEARCH TEAM ---
research_team = SequentialAgent(
    name="ResearchTeam",
    description="A team that finds, vets, and summarizes apartments.",
    sub_agents=[analyst, reviewer, summarizer]
)

# --- ROOT AGENT (MAIN) ---
# store_requirements writes user input to session state before ResearchTeam runs,
# avoiding the fragile "read last Manager message" pattern that breaks on one-shot queries.
root_agent = LlmAgent(
    name="manager",
    description="Conversational agent that gathers user requirements.",
    model=openai_model,
    instruction=instructions.MANAGER_PROMPT,
    tools=[FunctionTool(tools.store_requirements)],
    sub_agents=[research_team]
)
