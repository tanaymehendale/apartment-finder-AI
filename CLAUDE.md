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
  (`store_requirements`) and, later, category proximity search — called directly via httpx at
  `https://places.googleapis.com/v1/places:searchText` (the `googlemaps` Python lib targets the
  legacy Places endpoint and does NOT work with Places API (New)).
- `RENTCAST_API_KEY` — RentCast listing API, free tier 50 calls/month (**at least one of these is required**)
- `APIFY_API_KEY` — Apify Zillow Scraper actor, ~$5 credit/month free tier (**at least one of these is required**)

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

**Manager** — collects 4 required fields (city, state, budget, landmark) plus optional fields (min_bedrooms, min_bathrooms, roommates, budget_is_per_person). Validates US-only state. Calls the `store_requirements` tool to write them to ADK session state, then delegates to ResearchTeam. On a `[STRUCTURED_INTAKE]` message (the F3 deterministic path), state is already seeded — it skips `store_requirements` and delegates directly. Never outputs JSON directly to the user.

**Analyst** — reads `{user_requirements}` from session state via ADK template substitution. Calls `fetch_apartments` (passing `effective_budget` + layout filters) then `check_commutes` on the full set (up to 5–6, single Distance Matrix call). Writes output to `analyst_dossier`. Emits `"STATUS: NO_RESULTS"` to short-circuit the pipeline when no listings match, and appends `NO_MATCH_IN_BUDGET: suggested_budget=<N>` when nothing is in budget (P1-4).

**Reviewer** — reads `{analyst_dossier}`. Skips all tool calls if it sees `"STATUS: NO_RESULTS"`. Otherwise calls `google_search` once per apartment to research neighborhood safety. Writes to `safety_report`.

**Summarizer** — reads `{safety_report}`. On `"STATUS: NO_RESULTS"`, tells the user to adjust criteria. Labels any `over_budget` option ("$X above budget") and only elevates one as Top Pick if clearly better; on `NO_MATCH_IN_BUDGET` states nothing was in budget and quotes the area/layout market average. Otherwise produces the final ranked recommendation.

**Session state flow:** `user_requirements` → (Analyst) → `analyst_dossier` → (Reviewer) → `safety_report` → (Summarizer)

### Tool Layer (`apartment_finder/tools.py`)

**`fetch_apartments(city, state, max_budget, min_bedrooms=0, min_bathrooms=0)`** — provider chain **RentCast → Apify** (no offline fallback). The provider pool is fetched **price-uncapped** (layout filters applied) and partitioned by budget here (P1-4). Returns one of: (a) ≤5 in-budget listings tagged `over_budget: false` + optionally 1 stretch listing ≤15% over budget tagged `over_budget: true`; (b) `{no_match_in_budget, suggested_budget, available_options}` (suggested_budget = market average for the requested layout); (c) `{count: 0}`. Each listing carries `bedrooms`, `bathrooms`, `square_feet`, `listing_url`, `listing_source` (F2). `0` for a layout filter means "Any".

**`store_requirements(city, state, budget, landmark, tool_context, min_bedrooms=0, min_bathrooms=0, roommates=0, budget_is_per_person=False)`** — validates US state, then delegates to the shared `_seed_requirements(...)` helper which persists the **expanded `user_requirements` schema** (adds `effective_budget`, `areas`, `min_bedrooms/min_bathrooms`, `roommates`, `budget_is_per_person`, `proximity`) and resolves the landmark via **Places API (New) Text Search** with a 50 km `locationRestriction` circle around the city centroid (falls back to legacy Geocoding), storing the canonical `landmark_name`. `_seed_requirements` is reused by the F3 structured-intake path in `api/session_manager.py`. `tool_context` is injected by ADK's `FunctionTool` at runtime. Import with `from google.adk.tools.tool_context import ToolContext`.

**`check_commutes(origins, destination, mode)`** — calls Google Maps Distance Matrix API via the official `googlemaps` Python client (synchronous). Origins must be `"lat,lng"` strings, never raw addresses. One multi-origin call serves all listings.

### Session Management (`main.py`)

`InMemoryRunner` is initialized with `app_name="apartment_finder"`. A session is explicitly created via `runner.session_service.create_session(...)` before the loop; `session.id` is passed to every `run_debug` call to ensure all turns share the same session state.

### Open Item — MCP

Node.js `@modelcontextprotocol/server-google-maps` is still in `package.json` for reference. The MCP `stdio` transport was replaced because spawning a Node.js subprocess per call stripped the Windows `PATH` environment (causing silent failures) and added 2–4s of process startup overhead per `check_commutes` invocation. The `googlemaps` Python client is the current implementation. Revisit MCP if an HTTP-transport Maps MCP server becomes available, as that would restore the MCP architecture without the subprocess issues.
