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
- `USAGE_STORE` — optional, `file` (default) or `firestore`. Where the RentCast/Places **monthly**
  quota counters live. `file` → `data/*_usage.json`. **Any ephemeral-filesystem host (Cloud Run)
  must set `firestore`**, or the caps silently reset to 0 on every cold start — see Deployment.
- `USAGE_FIRESTORE_COLLECTION` — optional, defaults to `apartment_finder_usage`.
- `ALLOWED_ORIGINS` — optional, comma-separated extra CORS origins (e.g. the deployed Vercel URL).
  localhost is always allowed for dev.
- `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY` / `LANGFUSE_BASE_URL` — optional (P3.5-1). When both
  keys are set, `apartment_finder/tracing.py` instruments the whole agent tree for
  [Langfuse](https://langfuse.com) tracing at import time (via `GoogleADKInstrumentor` — see
  Observability section below). Omitting them is a clean no-op; nothing else in the app depends on
  these vars. `/api/health` reports `tracing_enabled` so you can confirm at a glance.
- `OWNER_EMAIL` — optional (Phase 5, partial — replaces Phase 3.9's throwaway `ACCESS_KEY` gate).
  Single-owner Firebase Auth: when set, `api/server.py`'s `auth_gate` middleware rejects every
  route except `/api/health` unless the request carries `Authorization: Bearer <Firebase ID
  token>` whose decoded, verified email matches this value exactly (case-insensitive) **and**
  `email_verified` is true. Still single-owner access, not open registration — per-user API keys
  are a separate, deferred piece (see Phase 5 in the backlog). Unset (the local-dev default) is a
  clean no-op — every route is open, same convention as the Langfuse vars above. Verification uses
  `google-auth`'s `google.oauth2.id_token.verify_firebase_token` (lighter than the full
  `firebase-admin` SDK — only fetches Google's public certs over HTTPS, no service-account
  credential needed) with `audience=FIREBASE_PROJECT_ID`; run off the event loop via
  `asyncio.to_thread` since the underlying HTTP call is synchronous.
- `FIREBASE_PROJECT_ID` — required alongside `OWNER_EMAIL`. The Firebase/GCP project id, used as
  the JWT audience when verifying ID tokens. Same value as `NEXT_PUBLIC_FIREBASE_PROJECT_ID` below.
- Frontend (`NEXT_PUBLIC_*`, build-time inlined like `NEXT_PUBLIC_BACKEND_URL` — see Deployment):
  `NEXT_PUBLIC_FIREBASE_API_KEY`, `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`,
  `NEXT_PUBLIC_FIREBASE_PROJECT_ID`, `NEXT_PUBLIC_FIREBASE_APP_ID` — the Firebase Web app config
  from Firebase Console → Project Settings → Your apps (not secret; Firebase's own docs treat this
  as safe to ship client-side, since the real access boundary is the backend's token verification,
  not hiding this config). `NEXT_PUBLIC_OWNER_EMAIL` — same value as the backend's `OWNER_EMAIL`,
  used only for a fast client-side "wrong account" message in `AuthGate`; the backend check is
  always authoritative.
  - `frontend/lib/firebase.ts` initializes the Firebase app/`auth` singleton (or leaves both `null`
    when `NEXT_PUBLIC_FIREBASE_API_KEY` is unset — local dev needs zero Firebase setup).
  - `frontend/components/AuthGate.tsx` wraps the whole app (`app/layout.tsx`) and redirects a
    logged-out visitor to `/login` — UX only, not the enforcement boundary; a visitor could bypass
    this component entirely and still couldn't reach the backend without a token from the owner's
    account. It also shows a distinct "restricted to its owner" screen (with sign-out) for a
    signed-in *non*-owner account, rather than bouncing them back through the login page.
  - `frontend/app/login/page.tsx` — Google sign-in + email/password, no public sign-up UI (the
    owner provisions their own account once via Firebase Console, or auto-provisions on first
    Google sign-in).
  - `frontend/lib/api.ts`'s `authHeaders()` reads the current user's ID token
    (`getIdToken()` — auto-refreshes transparently) and returns it as an `Authorization: Bearer`
    header, merged into every backend call (including the two built outside `lib/api.ts` —
    `MapView.tsx`'s directions fetch). `chatStream` gives 401/403 their own distinct SSE error
    messages so `useChat.ts`'s dead-session recovery (`SESSION_LOST_RE`) never mistakes an auth
    failure for a lost session and retries pointlessly.
  - This whole layer (`frontend/lib/firebase.ts`, `frontend/components/AuthGate.tsx`,
    `frontend/app/login/`, the `authHeaders()` plumbing, `auth_gate` in `api/server.py`) is what
    Phase 5's future multi-user/BYO-API-key work would build on top of, not replace outright.

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
  `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY` are set. **It must never raise** — it sits on the
  import path, so an exception there means the container cannot boot *at all*. Found exactly that
  way during P3.75 container testing: a malformed `LANGFUSE_BASE_URL` made `auth_check()` throw
  `httpx.UnsupportedProtocol`, which propagated through `agent.py` → `session_manager.py` →
  `server.py` and killed uvicorn at startup. Now everything after the key check is wrapped in a
  broad `except Exception` that degrades to "tracing off". Keep it that way: observability failing
  must never take the product down. **Must run after `.env` is loaded** — the
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

### Deployment (Phase 3.75) — Cloud Run (API) + Vercel (frontend)

`Dockerfile` builds the **API only**; the Next.js frontend deploys separately to Vercel. Three
localhost assumptions break on Cloud Run, two of them silently — each has a mitigation below.

**1. Sessions are process-memory** (`api/session_manager.py` `_sessions`, a dict of
`InMemoryRunner`s). Cloud Run scales to zero, so sessions die routinely. Mitigations:
- Deploy with `--max-instances=1` so all requests reach the same instance while it's warm.
- `frontend/hooks/useChat.ts` **recovers transparently**: the backend answers an unknown session
  with `200 OK` + `{"type":"error","content":"Session not found."}` (an SSE event *inside* a 200 —
  it is NOT an HTTP error, so it can only be matched on the message: `SESSION_LOST_RE`). On that,
  `useChat` mints a fresh session and replays the message **once**, then `rekeySession()` moves the
  sidebar entry + `apt_*` cache keys onto the new id so no duplicate conversation appears.
  `restoreSession` also probes `isSessionAlive()` (`/state` → 404 when dead) before trusting a
  localStorage id. Accepted limitation: a recovered session starts with **empty agent state**, so a
  one-shot query replays perfectly but a context-dependent follow-up ("make it $3000") re-asks for
  requirements — correct degradation, and far better than the previous behavior (a *permanently
  bricked* conversation: the error was painted and `sessionIdRef` never cleared, so every retry
  re-hit the dead id forever).
- Deferred: `DatabaseSessionService` + Cloud SQL. It's a real refactor — `_sessions` stores a runner
  *per session*, so persistence means one shared runner + session-id lookups (**not** the "one
  constructor arg" swap an older note claimed).

**2. Quota counters were file-backed** → reset to 0 on every cold start, making the RentCast 50/mo
and Places 200/mo caps meaningless (and pushing spend onto Apify, which costs real money). Fixed via
the pluggable `USAGE_STORE` (`tools.py` `_load_usage`/`_save_usage`). Firestore over GCS because at
this volume (one ~33-byte doc) **both cost $0**, so it was decided on correctness: a Firestore doc
write is atomic, removing the truncate-then-write torn read that could leave a half-written file →
`JSONDecodeError` → silent reset to 0. Fail-open on a Firestore outage (logs loudly, treats as 0) —
a bookkeeping failure must never break a search that already spent the API call.
Setup: enable Firestore (Native mode); grant the Cloud Run service account `roles/datastore.user`.
`_load_*`/`_save_*` keep their exact zero-arg/one-arg signatures because `test_tools.py`
monkeypatches those module attributes — **don't change them or call them via a captured local.**

**3. SSE through Vercel's function layer is capped at 300s** — a run hitting the 429 backoff path
(35s × 3 retries on top of a full pipeline) can exceed it and die mid-stream. So production sets
`NEXT_PUBLIC_BACKEND_URL` to the **Cloud Run URL**, and the browser streams straight from Cloud Run,
bypassing Vercel functions entirely (`frontend/lib/api.ts` `STREAM_BASE` already supported this).
This **inverts** that file's older "leave it unset in production" comment, which predated the
timeout concern. Consequence: Cloud Run **must** list the Vercel origin in `ALLOWED_ORIGINS` or
every search dies at the CORS preflight. `NEXT_PUBLIC_*` is inlined at **build** time — set it in
Vercel before building, not after.

```bash
# API → Cloud Run.  min-instances=0 keeps idle cost at $0 (Cloud Run's always-free tier —
# 180k vCPU-s + 360k GiB-s + 2M req/month — is permanent, NOT the 90-day trial; measured
# cold start ≈ 2.8s import). Pre-warm before a demo with --min-instances=1, then set back to 0.
gcloud run deploy apartment-finder-api --source . --region us-central1 \
  --min-instances=0 --max-instances=1 --timeout=900 --memory=1Gi \
  --set-env-vars USAGE_STORE=firestore,ALLOWED_ORIGINS=https://<your-app>.vercel.app,\
OWNER_EMAIL=<owner's email>,FIREBASE_PROJECT_ID=<firebase project id> \
  --set-secrets GOOGLE_API_KEY=...:latest,OPENAI_API_KEY=...:latest,GOOGLE_MAPS_API_KEY=...:latest,\
RENTCAST_API_KEY=...:latest,APIFY_API_KEY=...:latest,LANGFUSE_PUBLIC_KEY=...:latest,LANGFUSE_SECRET_KEY=...:latest
```
`OWNER_EMAIL`/`FIREBASE_PROJECT_ID` are plain env vars, not secrets (Secret Manager is for the API
keys above) — an email address and a project id aren't sensitive on their own.
`--timeout=900` (not the 300s default): the 429-retry path can outlast 5 minutes.
`/api/health` reports `usage_store` and `tracing_enabled` so a misconfigured deploy is visible at a
glance rather than discovered via a surprise bill.

**Testing the image locally** (verified working — boots, `/api/health` ok, graceful SIGTERM in 1.4s
with uvicorn as PID 1 thanks to `exec` in the CMD):
```bash
docker build -t apartment-finder-api:local .
docker run --rm -e PORT=8080 -p 8080:8080 --env-file <(python -c \
  "from dotenv import dotenv_values; print('\n'.join(f'{k}={v}' for k,v in dotenv_values('.env').items() if v))") \
  apartment-finder-api:local
```
⚠️ **Do not pass `.env` straight to `--env-file`.** Docker does *not* strip quotes, so
`LANGFUSE_BASE_URL="https://..."` arrives with literal quote characters and breaks at runtime
(python-dotenv strips them, which is why it works locally). Render it through dotenv first, as above.

**Vercel:** root directory `frontend/`; set `BACKEND_URL` (used by `next.config.mjs` rewrites for
the short endpoints) **and** `NEXT_PUBLIC_BACKEND_URL` (Cloud Run URL, for the direct SSE stream),
plus the five Firebase Auth vars from the Environment Variables section above
(`NEXT_PUBLIC_FIREBASE_API_KEY`/`AUTH_DOMAIN`/`PROJECT_ID`/`APP_ID`, `NEXT_PUBLIC_OWNER_EMAIL`) —
all `NEXT_PUBLIC_*`, so they must be set before Vercel builds, same build-time-inlining caveat as
`NEXT_PUBLIC_BACKEND_URL`.

**Known gaps (deliberate, pre-existing):** the counters' read-modify-write can lose an update under
concurrency (Firestore fixes torn reads, not lost updates — a real fix needs `firestore.Increment`
and a different API shape that would break the tests' monkeypatch contract); `_sessions` never
evicts (unbounded growth → OOM, mitigated by scale-to-zero); `datetime.now()` is naive-local so the
month-rollover boundary is UTC on Cloud Run vs local on dev.

### Open Item — MCP

Node.js `@modelcontextprotocol/server-google-maps` is still in `package.json` for reference. The MCP `stdio` transport was replaced because spawning a Node.js subprocess per call stripped the Windows `PATH` environment (causing silent failures) and added 2–4s of process startup overhead per `check_commutes` invocation. The `googlemaps` Python client is the current implementation. Revisit MCP if an HTTP-transport Maps MCP server becomes available, as that would restore the MCP architecture without the subprocess issues.
