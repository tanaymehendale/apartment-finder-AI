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

### Data preprocessing (only needed for local CSV fallback)
```bash
pip install kagglehub           # Not in requirements.txt — only needed for preprocessing
python preprocessing.py         # Downloads from Kaggle, cleans, saves to data/apartments_cleaned.csv
```

### Tests
```bash
python test_tools.py           # Tests check_commutes and fetch_apartments directly
python test_mcp.py             # Validates Google Maps MCP connectivity (legacy; MCP no longer used in main path)
```

## Environment Variables

`.env` requires:
- `GOOGLE_API_KEY` — Gemini API key (required)
- `GOOGLE_MAPS_API_KEY` — Google Maps Distance Matrix API key (required)
- `RENTCAST_API_KEY` — RentCast listing API, free tier 50 calls/month (optional but recommended)
- `APIFY_API_KEY` — Apify Zillow Scraper actor, ~$5 credit/month free tier (optional)

If neither `RENTCAST_API_KEY` nor `APIFY_API_KEY` is set, the system falls back to the local CSV. Run `preprocessing.py` once to generate it.

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

**Manager** — collects 4 required fields (city, state, budget, landmark). Calls the `store_requirements` tool to write them to ADK session state, then delegates to ResearchTeam. Never outputs JSON directly to the user.

**Analyst** — reads `{user_requirements}` from session state via ADK template substitution. Calls `fetch_apartments` then `check_commutes`. Writes output to `analyst_dossier` session state key. Emits `"STATUS: NO_RESULTS"` sentinel to short-circuit the pipeline when no listings match.

**Reviewer** — reads `{analyst_dossier}`. Skips all tool calls if it sees `"STATUS: NO_RESULTS"`. Otherwise calls `google_search` once per apartment to research neighborhood safety. Writes to `safety_report`.

**Summarizer** — reads `{safety_report}`. On `"STATUS: NO_RESULTS"`, tells the user to adjust criteria. Otherwise produces the final ranked recommendation.

**Session state flow:** `user_requirements` → (Analyst) → `analyst_dossier` → (Reviewer) → `safety_report` → (Summarizer)

### Tool Layer (`apartment_finder/tools.py`)

**`fetch_apartments(city, state, max_budget)`** — provider chain with automatic fallback:
1. **RentCast API** (primary): real-time listings, accurate per-listing coordinates
2. **Apify Zillow Scraper** (secondary): cloud scraper actor, higher volume
3. **Local CSV** (tertiary): the 100K Kaggle dataset; always available offline; results include a `data_warning` field noting staleness

**`store_requirements(city, state, budget, landmark, tool_context)`** — writes to ADK `ToolContext.state["user_requirements"]` before Manager delegates. The `tool_context` parameter is injected automatically by ADK's `FunctionTool` at runtime and is hidden from the LLM's function declaration. Import with `from google.adk.tools.tool_context import ToolContext`.

**`check_commutes(origins, destination, mode)`** — calls Google Maps Distance Matrix API via the official `googlemaps` Python client (synchronous). Origins must be `"lat,lng"` strings, never raw addresses.

### Session Management (`main.py`)

`InMemoryRunner` is initialized with `app_name="apartment_finder"`. A session is explicitly created via `runner.session_service.create_session(...)` before the loop; `session.id` is passed to every `run_debug` call to ensure all turns share the same session state.

### Data

`data/apartments_cleaned.csv` — 100K US rental listings. Used only as the tertiary fallback. The primary path uses live APIs that return accurate per-listing coordinates (no city-centroid duplication issue).

### Open Item — MCP

Node.js `@modelcontextprotocol/server-google-maps` is still in `package.json` for reference. The MCP `stdio` transport was replaced because spawning a Node.js subprocess per call stripped the Windows `PATH` environment (causing silent failures) and added 2–4s of process startup overhead per `check_commutes` invocation. The `googlemaps` Python client is the current implementation. Revisit MCP if an HTTP-transport Maps MCP server becomes available, as that would restore the MCP architecture without the subprocess issues.
