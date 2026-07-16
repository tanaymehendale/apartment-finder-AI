# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Setup
```bash
# Python environment
python -m venv .venv
.venv\Scripts\activate         # Windows
pip install -r requirements.txt
```

### Run
```bash
python main.py                 # Interactive CLI session
adk web                        # ADK web UI (browser-based conversation)
```

### Tests
```bash
python test_tools.py           # Tests check_commutes and fetch_apartments directly
python test_mcp.py             # Validates Google Maps MCP connectivity (legacy; MCP no longer used in main path)
```

## Environment Variables

`.env` requires:
- `GOOGLE_API_KEY` — Gemini API key (required)
- `GOOGLE_MAPS_API_KEY` — Google Maps key (required). Needs Distance Matrix, Directions,
  Geocoding, and **Places API (New)** enabled. Places (New) is used for landmark resolution
  (`store_requirements`), category proximity search (`places:searchText`), and **transit
  proximity** (nearest station by type via `places:searchNearby` — P2-4 `find_nearby_amenities`
  `kind="transit"`). Called directly via httpx (the `googlemaps` Python lib targets the legacy
  Places endpoint and does NOT work with Places API (New)). Gotcha: `searchText` only accepts a
  *circle* in `locationBias`; `searchNearby` requires a *circle* in `locationRestriction`.
- `RENTCAST_API_KEY` — RentCast listing API, free tier 50 calls/month (**at least one of these is required**)
- `APIFY_API_KEY` — Apify Zillow Scraper actor, ~$5 credit/month free tier (**at least one of these is required**)
- `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY` / `LANGFUSE_BASE_URL` — optional (P3.5-1). When both
  keys are set, `apartment_finder/tracing.py` instruments the whole agent tree for
  [Langfuse](https://langfuse.com) tracing at import time (via `GoogleADKInstrumentor` — see
  Observability section below). Omitting them is a clean no-op; nothing else in the app depends on
  these vars. `/api/health` reports `tracing_enabled` so you can confirm at a glance.

**There is no offline CSV fallback.** At least one listing provider (`RENTCAST_API_KEY` or
`APIFY_API_KEY`) must be set; otherwise `/api/health` reports `degraded` and searches return
`NO_RESULTS`. Check `/api/health` to confirm provider status before running. (`preprocessing.py`,
`data/apartments_cleaned.csv`, and `kagglehub` are retired — git history only.)

## Architecture

A **hierarchical multi-agent system** built on Google ADK with Gemini 2.5 Flash.

### Agent Hierarchy

```
Manager (root_agent)          ← user talks only to this agent
  └── ResearchTeam (SequentialAgent)
        ├── Analyst           ← fetch_apartments + check_commutes
        ├── Reviewer          ← google_search (safety research)
        └── Summarizer        ← synthesis, final recommendation
```

System prompts for all four agents live in [apartment_finder/instructions.py](apartment_finder/instructions.py). `apartment_finder/__init__.py` re-exports `root_agent` so `adk web` can discover it.

**Manager** — collects 4 required fields (city, state, budget, landmark) plus optional fields (min_bedrooms, min_bathrooms, roommates, budget_is_per_person). Validates US-only state. Calls the `store_requirements` tool to write them to ADK session state, then delegates to ResearchTeam. On a `[STRUCTURED_INTAKE]` message (the F3 deterministic path), state is already seeded — it skips `store_requirements` and delegates directly. Never outputs JSON directly to the user. **Follow-up requirement changes (FU-1):** after a search has already run, if the user changes/adds a requirement, the Manager calls `store_requirements` again with only the changed field(s) — omitted fields (including previously-set optional ones) are carried forward in code from the last saved `user_requirements`, then it re-delegates to ResearchTeam for a fresh run.

**Analyst** — reads `{user_requirements}` from session state via ADK template substitution. Calls `fetch_apartments` (passing `effective_budget` + layout filters) then `check_commutes` on the full set (up to 5–6, single Distance Matrix call). Writes output to `analyst_dossier`. Emits `"STATUS: NO_RESULTS"` to short-circuit the pipeline when no listings match, and appends `NO_MATCH_IN_BUDGET: suggested_budget=<N>` when nothing is in budget (P1-4).

**Reviewer** — reads `{analyst_dossier}`. Skips all tool calls if it sees `"STATUS: NO_RESULTS"`. Otherwise makes **one batched `google_search`** covering all listings' neighborhoods at once (not one call per apartment — cuts Gemini calls ~5×→1 to dodge 429/503), then writes a per-apartment safety note to `safety_report`. Runs on `ResilientGemini` (agent.py): `google_search` grounding requires Gemini, so the Reviewer is the only Gemini agent; on a transient 503/500/504 "overloaded" it does a short retry then falls back `gemini-2.5-flash-lite → gemini-2.5-flash`. 429 (RPM quota) is left to the model's `exp_base=7` retry (which must stay 7 — see agent.py). A Reviewer/Summarizer failure no longer discards results: `api/session_manager.py` still emits the `state` event with the Analyst's listings on any terminal error.

**Summarizer** — reads `{safety_report}`. On `"STATUS: NO_RESULTS"`, tells the user to adjust criteria. Labels any `over_budget` option ("$X above budget") and only elevates one as Top Pick if clearly better; on `NO_MATCH_IN_BUDGET` states nothing was in budget and quotes the area/layout market average. Otherwise produces the final ranked recommendation.

**Session state flow:** `user_requirements` → (Analyst) → `analyst_dossier` → (Reviewer) → `safety_report` → (Summarizer)

### Tool Layer (`apartment_finder/tools.py`)

**`fetch_apartments(city, state, max_budget, min_bedrooms=0, min_bathrooms=0)`** — provider chain **RentCast → Apify** (no offline fallback). The provider pool is fetched **price-uncapped** (layout filters applied) and partitioned by budget here (P1-4). Returns one of: (a) ≤5 in-budget listings tagged `over_budget: false` + optionally 1 stretch listing ≤15% over budget tagged `over_budget: true`; (b) `{no_match_in_budget, suggested_budget, available_options}` (suggested_budget = market average for the requested layout); (c) `{count: 0}`. Each listing carries `bedrooms`, `bathrooms`, `square_feet`, `listing_url`, `listing_source` (F2). `0` for a layout filter means "Any".

**`store_requirements(city=None, state=None, budget=None, landmark=None, tool_context, min_bedrooms=0, min_bathrooms=0, roommates=0, budget_is_per_person=False)`** — the 4 required params are `None`-defaulted so a follow-up call (FU-1) can omit any field that isn't changing; each omitted field (required or optional) falls back to the previously saved `user_requirements` in state, and returns a "missing information" message only if a field has never been set. Once resolved, delegates to the shared `_seed_requirements(...)` helper which persists the **expanded `user_requirements` schema** (adds `effective_budget`, `areas`, `min_bedrooms/min_bathrooms`, `roommates`, `budget_is_per_person`, `proximity`) and resolves the landmark via **Places API (New) Text Search** with a 50 km `locationRestriction` circle around the city centroid (falls back to legacy Geocoding), storing the canonical `landmark_name`. `_seed_requirements` is reused by the F3 structured-intake path in `api/session_manager.py`. `tool_context` is injected by ADK's `FunctionTool` at runtime. Import with `from google.adk.tools.tool_context import ToolContext`. Known trade-off: since 0/False is both "not restated this turn" and "explicit reset to Any", a follow-up can't explicitly clear an optional field back to Any — it can only be changed to a new non-default value (same accepted limitation as the pre-existing `pending_optional` fold-in).

**`check_commutes(origins, destination, mode)`** — calls Google Maps Distance Matrix API via the official `googlemaps` Python client (synchronous). Origins must be `"lat,lng"` strings, never raw addresses. One multi-origin call serves all listings.

### Session Management (`main.py`)

`InMemoryRunner` is initialized with `app_name="apartment_finder"`. A session is explicitly created via `runner.session_service.create_session(...)` before the loop; `session.id` is passed to every `run_debug` call to ensure all turns share the same session state.

### Observability (Langfuse, P3.5-1)

`apartment_finder/tracing.py` — instruments the **whole** agent tree (Manager → ResearchTeam →
Analyst/Reviewer/Summarizer, every tool call, and the Reviewer's `google_search` grounding call) in
one call: `openinference.instrumentation.google_adk.GoogleADKInstrumentor().instrument()`. This
wraps ADK's own model-dispatch layer, so it captures the LiteLLM-backed agents (Analyst,
Summarizer, Manager — all run on `LiteLlm(...)`) in the *same* trace tree as the Gemini Reviewer,
without a second, separate LiteLLM callback (the backlog originally scoped `litellm.callbacks =
["langfuse_otel"]` as a second integration point — evaluated and dropped: it would double-instrument
the same LiteLLM calls GoogleADKInstrumentor already captures, producing duplicate spans per call).
Live-verified: a real Manager turn produced one Langfuse trace with `AGENT`/`CHAIN`/`GENERATION`
observations, correct `model` field, and correct `sessionId`/`userId`/`tags` attribution.

- `tracing.init()` runs once at import time in `apartment_finder/agent.py`; it's a no-op unless
  `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY` are set. **Must run after `.env` is loaded** — the
  entrypoints (`main.py`, `api/server.py`) call `load_dotenv()` *before* importing
  `apartment_finder`/`api.session_manager` for exactly this reason (import order matters: Langfuse
  needs its env vars present before ADK's call path is patched). `adk web` loads `.env` itself
  before importing the agent module, so it needs no special handling.
- `tracing.session_scope(session_id, user_id=...)` wraps each conversation turn
  (`api/session_manager.py`'s retry loop, `main.py`'s CLI loop) so every span from that turn is
  tagged with the ADK `session_id` — multi-turn searches (including FU-1 follow-ups) group into one
  Langfuse Session instead of scattering across unrelated traces.
- The `langfuse/skills` [SKILL.md](https://github.com/langfuse/skills) is installed at
  `.claude/skills/langfuse/` (gitignored, local tooling only) — re-invoke it (docs-first: fetch
  current Langfuse docs before changing this integration, since the API has moved before — e.g. the
  LiteLLM callback name changed from `litellm.success_callback = ["langfuse"]` to
  `litellm.callbacks = ["langfuse_otel"]` since this was first scoped) if extending tracing further
  (scores, prompt management, dashboards).

### Open Item — MCP

Node.js `@modelcontextprotocol/server-google-maps` is still in `package.json` for reference. The MCP `stdio` transport was replaced because spawning a Node.js subprocess per call stripped the Windows `PATH` environment (causing silent failures) and added 2–4s of process startup overhead per `check_commutes` invocation. The `googlemaps` Python client is the current implementation. Revisit MCP if an HTTP-transport Maps MCP server becomes available, as that would restore the MCP architecture without the subprocess issues.
