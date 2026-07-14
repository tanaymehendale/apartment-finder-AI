# Test script for the apartment_finder tools.
#
# Offline tests (no API calls, no quota): budget-overflow partition logic, layout
# filter, US-state validation. Always run.
# Live tests (consume API quota): check_commutes, fetch_apartments, landmark
# resolution. Run only when keys are present and RUN_LIVE=1 is set.
import json
import os
from dotenv import load_dotenv

import apartment_finder.tools as tools
from apartment_finder.tools import (
    check_commutes,
    fetch_apartments,
    _normalize,
    _seed_requirements,
    VALID_US_STATES,
)

load_dotenv()


def _fake_listing(price, beds=1, baths=1, idx=0):
    return _normalize(
        {
            "id": f"apt-{idx}",
            "price": price,
            "address": f"{idx} Test St",
            "latitude": 30.0 + idx / 100,
            "longitude": -97.0 - idx / 100,
            "bedrooms": beds,
            "bathrooms": baths,
            "listing_source": "test",
        },
        "Austin",
        "TX",
    )


def _with_fake_pool(pool):
    """Swap the provider chain for a synthetic pool (no network)."""
    tools._PROVIDERS = [("fake", lambda c, s, mb, mba: pool)]


# ─── Offline: budget-overflow partition (P1-4) ───────────────────────────────

def test_budget_overflow_in_budget_with_stretch():
    print("\n🧪 P1-4: in-budget results + one stretch option")
    pool = [_fake_listing(p, idx=i) for i, p in enumerate([2000, 2200, 2500, 2700, 3500])]
    _with_fake_pool(pool)
    result = json.loads(fetch_apartments("Austin", "TX", 2600))
    assert isinstance(result, list), result
    in_budget = [r for r in result if not r["over_budget"]]
    stretch = [r for r in result if r["over_budget"]]
    assert len(in_budget) == 3, in_budget               # 2000, 2200, 2500
    assert len(stretch) == 1 and stretch[0]["monthly_price"] == 2700, stretch  # ≤ 2600×1.15
    print(f"   ✅ {len(in_budget)} in-budget + {len(stretch)} stretch (2700, within 15%)")


def test_budget_overflow_no_match_uses_layout_average():
    print("\n🧪 P1-4: nothing in budget → suggested_budget = layout market average")
    pool = [_fake_listing(p, idx=i) for i, p in enumerate([2000, 2200, 2500, 2700, 3500])]
    _with_fake_pool(pool)
    result = json.loads(fetch_apartments("Austin", "TX", 1500))
    assert result.get("no_match_in_budget") is True, result
    assert result["suggested_budget"] == round((2000 + 2200 + 2500 + 2700 + 3500) / 5), result
    assert all(o["over_budget"] for o in result["available_options"]), result
    print(f"   ✅ suggested_budget = ${result['suggested_budget']} (avg of the layout pool)")


def test_provider_merge_supplements_thin_pool():
    print("\n🧪 provider merge: thin first-provider pool triggers a second provider, merged")
    rentcast_pool = [_fake_listing(3200, idx=0)]  # 1 listing, over a 3000 budget → 0 in-budget
    apify_pool = [_fake_listing(p, idx=i + 1) for i, p in enumerate([2400, 2600, 2800])]
    calls = {"apify": 0}

    def fake_apify(c, s, mb, mba):
        calls["apify"] += 1
        return apify_pool

    tools._PROVIDERS = [("rentcast", lambda c, s, mb, mba: rentcast_pool), ("apify", fake_apify)]
    result = json.loads(fetch_apartments("Austin", "TX", 3000))
    assert calls["apify"] == 1, "thin RentCast pool must fall through to Apify"
    assert isinstance(result, list) and len(result) == 4, result  # 3 in-budget + 1 stretch (3200)
    in_budget = [r for r in result if not r["over_budget"]]
    assert len(in_budget) == 3, in_budget
    print(f"   ✅ RentCast alone had 0 in-budget → Apify queried, merged pool yields {len(in_budget)} in-budget")


def test_provider_merge_skips_second_when_sufficient():
    print("\n🧪 provider merge: sufficient first-provider pool skips the second (cost control)")
    rentcast_pool = [_fake_listing(p, idx=i) for i, p in enumerate([2000, 2200, 2500])]
    calls = {"apify": 0}

    def fake_apify(c, s, mb, mba):
        calls["apify"] += 1
        return [_fake_listing(2100, idx=99)]

    tools._PROVIDERS = [("rentcast", lambda c, s, mb, mba: rentcast_pool), ("apify", fake_apify)]
    result = json.loads(fetch_apartments("Austin", "TX", 3000))
    assert calls["apify"] == 0, "Apify must NOT be queried when RentCast alone clears the threshold"
    assert len(result) == 3, result
    print("   ✅ 3 in-budget from RentCast alone → Apify never called")


def test_search_status_recorded_deterministically():
    print("\n🧪 fetch_apartments records `search_status` in tool_context.state (code, not prose)")
    ctx = _FakeToolContext({})
    pool_ok = [_fake_listing(p, idx=i) for i, p in enumerate([2000, 2200, 2500])]
    tools._PROVIDERS = [("fake", lambda c, s, mb, mba: pool_ok)]
    fetch_apartments("Austin", "TX", 2600, tool_context=ctx)
    assert ctx.state["search_status"] == "ok", ctx.state

    ctx2 = _FakeToolContext({})
    tools._PROVIDERS = [("fake", lambda c, s, mb, mba: pool_ok)]
    fetch_apartments("Austin", "TX", 500, tool_context=ctx2)
    assert ctx2.state["search_status"] == "no_match_in_budget", ctx2.state
    assert ctx2.state["suggested_budget"] == round((2000 + 2200 + 2500) / 3), ctx2.state

    ctx3 = _FakeToolContext({})
    tools._PROVIDERS = [("fake", lambda c, s, mb, mba: [])]
    fetch_apartments("Austin", "TX", 2600, tool_context=ctx3)
    assert ctx3.state["search_status"] == "no_results", ctx3.state
    print("   ✅ ok / no_match_in_budget (+ suggested_budget) / no_results all recorded correctly")


def test_per_person_price_single_division():
    print("\n🧪 per-person: fetch_apartments attaches a single, correctly-divided per_person_price")
    pool = [_fake_listing(4910, idx=0), _fake_listing(2000, idx=1)]
    tools._PROVIDERS = [("fake", lambda c, s, mb, mba: pool)]
    # roommates=1 → 2 occupants. Must be monthly_price / 2, computed ONCE (not re-split).
    result = json.loads(fetch_apartments("Redmond", "WA", 3600, roommates=1))
    for l in result:
        assert l["per_person_price"] == round(l["monthly_price"] / 2), l
        assert l["per_person_label"] == f"${l['per_person_price']:,.0f} per person, split 2 ways", l
    # Solo (roommates=0, the default) → no per-person split at all.
    tools._PROVIDERS = [("fake", lambda c, s, mb, mba: pool)]
    result_solo = json.loads(fetch_apartments("Redmond", "WA", 3600))
    assert all(l["per_person_price"] is None and l["per_person_label"] is None for l in result_solo), result_solo
    print(f"   ✅ $4,910/mo, 1 roommate → {result[0]['per_person_label']} (single split, label matches N)")


def test_per_person_label_matches_actual_occupant_count():
    print("\n🧪 per-person: per_person_label's 'split N ways' always matches the real occupant count")
    pool = [_fake_listing(3628, idx=0)]
    tools._PROVIDERS = [("fake", lambda c, s, mb, mba: pool)]
    # roommates=2 → 3 occupants — this is the exact case that previously mislabeled "split 2 ways".
    result = json.loads(fetch_apartments("Redmond", "WA", 4000, roommates=2))
    assert result[0]["per_person_price"] == round(3628 / 3), result
    assert result[0]["per_person_label"] == f"${round(3628 / 3):,.0f} per person, split 3 ways", result
    print(f"   ✅ roommates=2 (3 occupants) → {result[0]['per_person_label']} ('split 3 ways', not '2 ways')")


def test_layout_filter_excludes_smaller():
    print("\n🧪 P2-1/P1-4: min_bedrooms filter narrows the pool")
    pool = [_fake_listing(2000, beds=b, idx=i) for i, b in enumerate([1, 2, 3])]
    # Provider applies the filter; simulate by filtering in the fake provider.
    tools._PROVIDERS = [
        ("fake", lambda c, s, mb, mba: [p for p in pool if (p["bedrooms"] or 0) >= mb])
    ]
    result = json.loads(fetch_apartments("Austin", "TX", 3000, min_bedrooms=2))
    assert all(r["bedrooms"] >= 2 for r in result), result
    print(f"   ✅ {len(result)} listings, all ≥ 2 bd")


# ─── Offline: US-state validation (P1-3) ─────────────────────────────────────

def test_us_state_validation():
    print("\n🧪 P1-3: US-only state validation")
    assert "TX" in VALID_US_STATES and "DC" in VALID_US_STATES
    state = {}
    bad = _seed_requirements(state, city="Toronto", state="ON", budget=2000, landmark="CN Tower")
    assert bad.get("error") is True, bad
    assert "user_requirements" not in state, "invalid state must not persist requirements"
    print(f"   ✅ Non-US 'ON' rejected: {bad['message'][:60]}…")


def test_expanded_schema_persists():
    print("\n🧪 F1: expanded requirements schema + effective_budget (per-person)")
    state = {}
    # Skip live geocoding by neutralizing the Maps client for this offline check.
    orig = tools._get_gmaps_client
    tools._get_gmaps_client = lambda: (_ for _ in ()).throw(RuntimeError("offline"))
    try:
        ok = _seed_requirements(
            state, city="Austin", state="tx", budget=1300, landmark="UT Austin",
            roommates=1, budget_is_per_person=True, min_bedrooms=2,
        )
    finally:
        tools._get_gmaps_client = orig
    assert ok.get("ok"), ok
    reqs = json.loads(state["user_requirements"])
    assert reqs["state"] == "TX"                      # normalized upper
    assert reqs["effective_budget"] == 1300 * 2       # per-person × (roommates+1)
    assert reqs["min_bedrooms"] == 2 and reqs["roommates"] == 1
    print(f"   ✅ effective_budget = ${reqs['effective_budget']} (1300/person × 2)")


def test_roommates_default_bedrooms():
    print("\n🧪 P2-3: roommates default the bedroom floor to (roommates + 1) when unset")
    orig = tools._get_gmaps_client
    tools._get_gmaps_client = lambda: (_ for _ in ()).throw(RuntimeError("offline"))
    try:
        # 2 roommates, no explicit min_bedrooms → expect min_bedrooms = 3.
        state = {}
        _seed_requirements(state, city="Austin", state="TX", budget=3000, landmark="UT Austin", roommates=2)
        reqs = json.loads(state["user_requirements"])
        assert reqs["min_bedrooms"] == 3, reqs
        # Explicit min_bedrooms always wins over the roommate default.
        state2 = {}
        _seed_requirements(state2, city="Austin", state="TX", budget=3000, landmark="UT Austin",
                           roommates=2, min_bedrooms=1)
        reqs2 = json.loads(state2["user_requirements"])
        assert reqs2["min_bedrooms"] == 1, reqs2
        # Solo (0 roommates) leaves the filter at "Any".
        state3 = {}
        _seed_requirements(state3, city="Austin", state="TX", budget=3000, landmark="UT Austin")
        reqs3 = json.loads(state3["user_requirements"])
        assert reqs3["min_bedrooms"] == 0, reqs3
    finally:
        tools._get_gmaps_client = orig
    print("   ✅ default=3 for 2 roommates · explicit min_bedrooms=1 wins · solo stays 'Any'")


# ─── Offline: proximity (P2-4) ───────────────────────────────────────────────

class _FakeGmaps:
    def __init__(self, lat, lng, name):
        self._lat, self._lng, self._name = lat, lng, name

    def geocode(self, _query):
        return [{"geometry": {"location": {"lat": self._lat, "lng": self._lng}},
                 "formatted_address": self._name}]


def test_proximity_named_offline():
    print("\n🧪 P2-4: 'named' proximity geocodes once + reports per-listing distance")
    from apartment_finder.tools import find_nearby_amenities
    orig = tools._get_gmaps_client
    # Fixed point ~ downtown Sunnyvale; two origins at different distances.
    tools._get_gmaps_client = lambda: _FakeGmaps(37.3779, -122.0310, "Sunnyvale Caltrain Station")
    try:
        out = json.loads(find_nearby_amenities(
            ["37.3688,-122.0363", "37.4419,-122.1430"], "Caltrain", "named"))
    finally:
        tools._get_gmaps_client = orig
    assert out["kind"] == "named" and len(out["results"]) == 2, out
    assert all(r and r["name"] == "Sunnyvale Caltrain Station" for r in out["results"]), out
    # Closer origin must report a smaller distance than the far one.
    d0 = float(out["results"][0]["distance_text"].split()[0])
    d1 = float(out["results"][1]["distance_text"].split()[0])
    assert d0 < d1, out
    print(f"   ✅ {out['results'][0]['distance_text']} (near) < {out['results'][1]['distance_text']} (far)")


def test_proximity_category_guardrail_offline():
    print("\n🧪 P2-4: 'category' proximity caps Places calls + caches by coords")
    from apartment_finder import tools as t
    calls = {"n": 0}

    def fake_nearest(lat, lng, query, radius_m=8000.0):
        calls["n"] += 1
        return {"name": f"Store#{calls['n']}", "lat": lat + 0.001, "lng": lng + 0.001}

    orig_nearest = t._places_category_nearest
    orig_load, orig_save = t._load_places_usage, t._save_places_usage
    orig_cap = t._PLACES_MAX_PER_RUN
    t._places_category_nearest = fake_nearest
    t._load_places_usage = lambda: {"month": "test", "count": 0}
    t._save_places_usage = lambda usage: None
    t._PLACES_CACHE.clear()
    t._PLACES_MAX_PER_RUN = 2
    try:
        # 3 distinct origins, cap = 2 → only 2 live calls, 3rd is skipped (None).
        out = json.loads(t.find_nearby_amenities(
            ["30.10,-97.10", "30.20,-97.20", "30.30,-97.30"], "Indian grocery", "category"))
        assert calls["n"] == 2, calls
        assert out["results"][2] is None, out
        # Re-querying a cached coord makes no new call.
        before = calls["n"]
        t.find_nearby_amenities(["30.10,-97.10"], "Indian grocery", "category")
        assert calls["n"] == before, "cache should prevent a repeat Places call"
    finally:
        t._places_category_nearest = orig_nearest
        t._load_places_usage, t._save_places_usage = orig_load, orig_save
        t._PLACES_MAX_PER_RUN = orig_cap
        t._PLACES_CACHE.clear()
    print(f"   ✅ cap respected (2 live calls, 3rd skipped) + coord cache hit")


def test_transit_type_mapping_offline():
    print("\n🧪 P2-4 transit: label → Places station type mapping")
    from apartment_finder.tools import _transit_type_for
    cases = {
        "Caltrain": "train_station",
        "commuter rail": "train_station",
        "bus stop": "bus_station",
        "subway": "subway_station",
        "the metro": "subway_station",
        "light rail": "light_rail_station",   # must NOT fall through to train via "rail"
        "streetcar": "light_rail_station",
        "transit": "transit_station",          # generic fallback
    }
    for label, expected in cases.items():
        got = _transit_type_for(label)
        assert got == expected, f"{label!r} → {got} (expected {expected})"
    print(f"   ✅ {len(cases)} labels mapped correctly (incl. 'light rail' not matching train)")


def test_transit_branch_offline():
    print("\n🧪 P2-4 transit: 'transit' kind uses typed Nearby Search + shares the guardrail/cache")
    from apartment_finder import tools as t
    calls = {"n": 0, "types": []}

    def fake_nearby(lat, lng, included_type, radius_m=8000.0):
        calls["n"] += 1
        calls["types"].append(included_type)
        return {"name": f"{included_type} #{calls['n']}", "lat": lat + 0.002, "lng": lng + 0.002}

    orig = t._places_nearby_transit
    orig_load, orig_save = t._load_places_usage, t._save_places_usage
    t._places_nearby_transit = fake_nearby
    t._load_places_usage = lambda: {"month": "test", "count": 0}
    t._save_places_usage = lambda usage: None
    t._PLACES_CACHE.clear()
    try:
        out = json.loads(t.find_nearby_amenities(["37.39,-122.08", "37.40,-122.09"], "Caltrain", "transit"))
        assert out["kind"] == "transit", out
        assert all(ty == "train_station" for ty in calls["types"]), calls
        assert out["results"][0]["name"].startswith("train_station"), out
        assert all(r and r["distance_text"].endswith("mi") for r in out["results"]), out
    finally:
        t._places_nearby_transit = orig
        t._load_places_usage, t._save_places_usage = orig_load, orig_save
        t._PLACES_CACHE.clear()
    print(f"   ✅ transit kind → train_station Nearby Search, distances attached")


# ─── Offline: P2-5 structured-preferences fold-in ────────────────────────────

class _FakeToolContext:
    def __init__(self, state):
        self.state = state


def test_pending_optional_foldin():
    print("\n🧪 P2-5: store_requirements folds in bridge-seeded pending_optional (incl. proximity)")
    from apartment_finder.tools import store_requirements
    orig = tools._get_gmaps_client
    tools._get_gmaps_client = lambda: (_ for _ in ()).throw(RuntimeError("offline"))
    try:
        # The bridge seeds optional prefs (cards) the LLM can't pass — esp. proximity.
        state = {
            "pending_optional": json.dumps({
                "min_bedrooms": 2,
                "roommates": 1,
                "budget_is_per_person": True,
                "proximity": [{"label": "Caltrain", "kind": "named"},
                              {"label": "Indian grocery", "kind": "category"}],
            })
        }
        ctx = _FakeToolContext(state)
        # Manager only passes the 4 required (no optional args).
        msg = store_requirements("Sunnyvale", "CA", 1500, "Google Sunnyvale", ctx)
        assert "saved" in msg.lower(), msg
        reqs = json.loads(state["user_requirements"])
        assert reqs["min_bedrooms"] == 2, reqs
        assert reqs["roommates"] == 1, reqs
        assert reqs["budget_is_per_person"] is True, reqs
        assert reqs["effective_budget"] == 1500 * 2, reqs           # per-person × 2
        assert len(reqs["proximity"]) == 2, reqs
        assert reqs["proximity"][0]["label"] == "Caltrain", reqs
    finally:
        tools._get_gmaps_client = orig
    print(f"   ✅ proximity + per-person + beds folded in; effective_budget=${reqs['effective_budget']}")


# ─── Offline: deterministic status-routing guard ─────────────────────────────
# search_status is written by fetch_apartments in code; build_fallback_recommendation
# and the reviewer/summarizer before_agent_callbacks in agent.py trust it over prose.

def test_build_fallback_recommendation_corrects_false_negative():
    print("\n🧪 status-routing: build_fallback_recommendation corrects a false NO_RESULTS bail-out")
    from apartment_finder.tools import build_fallback_recommendation

    listings = [
        {"address": "1 Test St", "monthly_price": 3100, "over_budget": True},
        {"address": "2 Test St", "monthly_price": 3050, "over_budget": True},
    ]
    state = {
        "search_status": "no_match_in_budget",
        "suggested_budget": 3075,
        "safety_report": "STATUS: NO_RESULTS",  # erroneous — real listings exist
        "analyst_dossier": json.dumps(listings) + "\n\n{\"rows\": []}",
        "user_requirements": json.dumps({"city": "Redmond", "state": "WA", "budget": 2500}),
    }
    msg = build_fallback_recommendation(state)
    assert msg is not None, "must correct when search_status disagrees with safety_report"
    assert "Redmond" in msg and "$3,075" in msg and "1 Test St" in msg, msg
    print(f"   ✅ corrected message built from state: {msg.splitlines()[0]}")


def test_build_fallback_recommendation_noop_when_consistent():
    print("\n🧪 status-routing: build_fallback_recommendation is a no-op when nothing is wrong")
    from apartment_finder.tools import build_fallback_recommendation

    # Case 1: pipeline behaved correctly (safety_report has real content, not a bail-out).
    state_ok = {
        "search_status": "ok",
        "safety_report": "Here are the listings with safety notes...",
        "analyst_dossier": json.dumps([{"address": "1 Test St", "monthly_price": 2000}]),
    }
    assert build_fallback_recommendation(state_ok) is None

    # Case 2: genuinely no results — the bail-out text is CORRECT, must not be touched.
    state_none = {"search_status": "no_results", "safety_report": "STATUS: NO_RESULTS"}
    assert build_fallback_recommendation(state_none) is None
    print("   ✅ no correction when the pipeline already behaved correctly")


def test_reviewer_callback_skips_on_true_no_results():
    print("\n🧪 status-routing: reviewer before_agent_callback skips Gemini on a true no-results")
    from apartment_finder.agent import _reviewer_before_callback

    class _FakeCtx:
        def __init__(self, state):
            self.state = state

    ctx = _FakeCtx({"search_status": "no_results"})
    content = _reviewer_before_callback(ctx)
    assert content is not None, "must skip (return Content) on a true no-results"
    assert ctx.state["safety_report"] == "STATUS: NO_RESULTS", ctx.state

    ctx2 = _FakeCtx({"search_status": "ok"})
    assert _reviewer_before_callback(ctx2) is None, "must NOT skip when real data exists"
    print("   ✅ skips (deterministically) only for a code-verified true no-results")


def test_summarizer_callback_overrides_false_negative():
    print("\n🧪 status-routing: summarizer before_agent_callback overrides a false NO_RESULTS reply")
    from apartment_finder.agent import _summarizer_before_callback

    class _FakeCtx:
        def __init__(self, state):
            self.state = state

    listings = [{"address": "1 Test St", "monthly_price": 2000, "over_budget": False}]
    ctx = _FakeCtx({
        "search_status": "ok",
        "safety_report": "STATUS: NO_RESULTS",  # erroneous
        "analyst_dossier": json.dumps(listings),
        "user_requirements": json.dumps({"city": "Austin", "state": "TX", "budget": 2500}),
    })
    content = _summarizer_before_callback(ctx)
    assert content is not None, "must override when search_status disagrees with safety_report"
    assert "final_recommendation" in ctx.state and "1 Test St" in ctx.state["final_recommendation"]

    # Correct pipeline (no contradiction) → callback must not intervene.
    ctx2 = _FakeCtx({"search_status": "ok", "safety_report": "Looks great, safe area."})
    assert _summarizer_before_callback(ctx2) is None
    print("   ✅ overrides only the false negative; leaves a correct pipeline run untouched")


# ─── Offline: ResilientGemini Reviewer wrapper (#2 short 503 retry / #3 fallback) ─

def test_resilient_gemini_offline():
    print("\n🧪 Reviewer: ResilientGemini short-retry + flash fallback + 429 passthrough")
    import asyncio
    from pydantic import BaseModel
    from google.adk.models.base_llm import BaseLlm
    from apartment_finder.agent import ResilientGemini

    counts: dict = {}

    class _Req(BaseModel):
        x: int = 1

    class _Fake(BaseLlm):
        fail_times: int = 0
        tag: str = "p"
        err: str = "503 UNAVAILABLE overloaded"

        async def generate_content_async(self, llm_request, stream: bool = False):
            n = counts.get(self.tag, 0)
            counts[self.tag] = n + 1
            if n < self.fail_times:
                raise RuntimeError(self.err)
            yield f"OK-{self.tag}"

    async def _collect(rg):
        return [r async for r in rg.generate_content_async(_Req())]

    async def _run():
        # transient 503 once → recovers on primary, no fallback
        counts.clear()
        rg = ResilientGemini(model="m", retry_delay_s=0,
                             primary=_Fake(model="p", tag="p", fail_times=1),
                             fallback=_Fake(model="f", tag="f"))
        assert await _collect(rg) == ["OK-p"] and counts == {"p": 2}, counts
        # always 503 → 2 retries then fallback model
        counts.clear()
        rg = ResilientGemini(model="m", retry_delay_s=0,
                             primary=_Fake(model="p", tag="p", fail_times=99),
                             fallback=_Fake(model="f", tag="f"))
        assert await _collect(rg) == ["OK-f"] and counts == {"p": 3, "f": 1}, counts
        # 429 is NOT transient → propagate, no retry, no fallback
        counts.clear()
        rg = ResilientGemini(model="m", retry_delay_s=0,
                             primary=_Fake(model="p", tag="p", fail_times=9, err="429 RESOURCE_EXHAUSTED"),
                             fallback=_Fake(model="f", tag="f"))
        try:
            await _collect(rg)
            assert False, "429 must propagate"
        except RuntimeError as e:
            assert "429" in str(e)
        assert counts == {"p": 1}, counts

    asyncio.run(_run())
    print("   ✅ retry-recovers · exhausted→fallback · 429 passthrough")


# ─── Live tests (consume quota) ──────────────────────────────────────────────

def test_check_commutes_live():
    print("\n🧪 LIVE: check_commutes")
    result = check_commutes(
        origins=["30.2672,-97.7431", "30.2422,-97.7552"],
        destination="Austin-Bergstrom International Airport, Austin, TX",
        mode="driving",
    )
    print("   " + result[:200])


def test_landmark_resolution_live():
    print("\n🧪 LIVE P1-2: landmark resolves to the office, not the city centroid")
    state = {}
    _seed_requirements(state, city="Redmond", state="WA", budget=3000, landmark="HCLTech Redmond office")
    print(f"   landmark_name={state.get('landmark_name')} @ "
          f"{state.get('landmark_lat')},{state.get('landmark_lng')}")


def test_proximity_category_live():
    print("\n🧪 LIVE P2-4: nearest 'Indian grocery' to a Sunnyvale, CA point (Places New)")
    from apartment_finder.tools import find_nearby_amenities
    out = json.loads(find_nearby_amenities(["37.3688,-122.0363"], "Indian grocery", "category"))
    print("   " + json.dumps(out))
    r = out["results"][0]
    assert r and r.get("name") and r.get("distance_text"), out
    print(f"   ✅ nearest: {r['name']} ({r['distance_text']})")


def test_transit_category_live():
    print("\n🧪 LIVE P2-4 transit: nearest Caltrain station to a Sunnyvale, CA point (Places Nearby)")
    from apartment_finder.tools import find_nearby_amenities
    out = json.loads(find_nearby_amenities(["37.3688,-122.0363"], "Caltrain", "transit"))
    print("   " + json.dumps(out))
    r = out["results"][0]
    assert r and r.get("name") and r.get("distance_text"), out
    print(f"   ✅ nearest station: {r['name']} ({r['distance_text']})")


if __name__ == "__main__":
    # Offline logic tests — always safe.
    test_budget_overflow_in_budget_with_stretch()
    test_budget_overflow_no_match_uses_layout_average()
    test_provider_merge_supplements_thin_pool()
    test_provider_merge_skips_second_when_sufficient()
    test_search_status_recorded_deterministically()
    test_per_person_price_single_division()
    test_per_person_label_matches_actual_occupant_count()
    test_layout_filter_excludes_smaller()
    test_us_state_validation()
    test_expanded_schema_persists()
    test_roommates_default_bedrooms()
    test_proximity_named_offline()
    test_proximity_category_guardrail_offline()
    test_transit_type_mapping_offline()
    test_transit_branch_offline()
    test_pending_optional_foldin()
    test_build_fallback_recommendation_corrects_false_negative()
    test_build_fallback_recommendation_noop_when_consistent()
    test_reviewer_callback_skips_on_true_no_results()
    test_summarizer_callback_overrides_false_negative()
    test_resilient_gemini_offline()
    print("\n✅ All offline logic tests passed.")

    # Live tests — opt-in to avoid burning RentCast/Places/Maps quota.
    if os.getenv("RUN_LIVE") == "1":
        if not os.getenv("GOOGLE_MAPS_API_KEY"):
            print("\n⚠️  GOOGLE_MAPS_API_KEY not set — skipping live tests.")
        else:
            test_check_commutes_live()
            test_landmark_resolution_live()
            test_proximity_category_live()
            test_transit_category_live()
            test_fetch_live = os.getenv("RENTCAST_API_KEY") or os.getenv("APIFY_API_KEY")
            if test_fetch_live:
                print("\n🧪 LIVE: fetch_apartments")
                print("   " + fetch_apartments("Austin", "TX", 2500)[:300])
    else:
        print("\nℹ️  Set RUN_LIVE=1 to also run live API tests (consumes quota).")
