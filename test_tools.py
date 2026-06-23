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


if __name__ == "__main__":
    # Offline logic tests — always safe.
    test_budget_overflow_in_budget_with_stretch()
    test_budget_overflow_no_match_uses_layout_average()
    test_layout_filter_excludes_smaller()
    test_us_state_validation()
    test_expanded_schema_persists()
    print("\n✅ All offline logic tests passed.")

    # Live tests — opt-in to avoid burning RentCast/Places/Maps quota.
    if os.getenv("RUN_LIVE") == "1":
        if not os.getenv("GOOGLE_MAPS_API_KEY"):
            print("\n⚠️  GOOGLE_MAPS_API_KEY not set — skipping live tests.")
        else:
            test_check_commutes_live()
            test_landmark_resolution_live()
            test_fetch_live = os.getenv("RENTCAST_API_KEY") or os.getenv("APIFY_API_KEY")
            if test_fetch_live:
                print("\n🧪 LIVE: fetch_apartments")
                print("   " + fetch_apartments("Austin", "TX", 2500)[:300])
    else:
        print("\nℹ️  Set RUN_LIVE=1 to also run live API tests (consumes quota).")
