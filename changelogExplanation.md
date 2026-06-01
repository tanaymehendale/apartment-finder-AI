# Code Change Log

_This file is auto-maintained by Claude Code. Each entry represents a batch of changes from a session._

---

## [2026-06-01 13:34] — Add API cost guardrails for RentCast and Apify providers

### Changes

| File | What Changed | Why (Plain English) |
|------|-------------|---------------------|
| `apartment_finder/tools.py` | Added `_RENTCAST_MONTHLY_LIMIT`, `_RENTCAST_MAX_PER_RUN`, `_RENTCAST_USAGE_FILE` constants; added `_rentcast_run_count` module-level counter; added `_load_rentcast_usage()` and `_save_rentcast_usage()` helpers; updated `_fetch_rentcast()` to enforce both limits before making any HTTP call | RentCast's free tier only allows 50 calls per month. Without a guardrail, a handful of test runs could exhaust the whole month's quota silently. The per-run cap (2 calls) prevents a single runaway session from burning most of the budget, while the monthly cap (50) automatically reroutes to Apify the moment that ceiling is hit — no manual monitoring needed. Usage is persisted to `data/rentcast_usage.json` so the count survives process restarts and resets itself automatically when the calendar month rolls over. |
| `apartment_finder/tools.py` | Added `_APIFY_MAX_BUDGET_USD`, `_APIFY_COST_PER_1000`, `_APIFY_MAX_ITEMS` constants; replaced hardcoded `maxItems: 5` with `safe_max_items = min(5, _APIFY_MAX_ITEMS)` in `_fetch_apify()` | The Zillow scraper actor costs $2.30 per 1,000 results. At 5 results per call this is cheap, but if `maxItems` is ever raised during development the cost could spike. The guardrail derives the maximum safe item count from the $0.20/run budget (`0.20 / 2.3 * 1000 = 86`) and enforces it at the call site, so future changes to the requested count can never accidentally exceed the budget. |
| `apartment_finder/tools.py` | Added `from datetime import datetime` import | Required by `_load_rentcast_usage()` to stamp and compare the current calendar month. |

### Decisions & Assumptions
- **Usage counter increments after a successful HTTP response**, not before. This means a failed or timed-out request doesn't consume a quota slot — only actual successful API calls are counted against the monthly limit.
- **Monthly reset is implicit**: `_load_rentcast_usage()` checks the stored month string against the current month. If they differ (new month), it returns a fresh zero-count object. No cron job or manual reset is needed.
- **Apify `maxItems` is currently 5**, which is already far below the 86-item guardrail ceiling. The guardrail is latent protection — it activates only if the requested count is ever raised.
- **Per-run RentCast counter (`_rentcast_run_count`) lives in module memory** and resets when the process restarts. This maps naturally to "one agent session = one run" since `main.py` starts a fresh process each time.

---
