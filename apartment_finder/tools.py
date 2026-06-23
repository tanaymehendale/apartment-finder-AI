import json
import os
import re
import urllib.parse
import googlemaps
import httpx
from datetime import datetime
from pathlib import Path
from google.adk.tools.tool_context import ToolContext

# ─── Path resolution anchored to this file, not os.getcwd() ──────────────────
_PROJECT_ROOT = Path(__file__).parent.parent


# ─── US state validation (50 states + DC) ────────────────────────────────────
VALID_US_STATES = {
    "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
    "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
    "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
    "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
    "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
    "DC",
}


# ─── Google Maps client (lazy-init singleton) ─────────────────────────────────
_gmaps_client = None

def _get_gmaps_client() -> googlemaps.Client:
    global _gmaps_client
    if _gmaps_client is None:
        key = os.getenv("GOOGLE_MAPS_API_KEY")
        if not key:
            raise ValueError("GOOGLE_MAPS_API_KEY is not set")
        _gmaps_client = googlemaps.Client(key=key)
    return _gmaps_client


# ─── Google Places API (New) — Text Search via httpx ─────────────────────────
# The `googlemaps` Python library targets the legacy Places endpoint and does NOT
# work with Places API (New), so we call the new endpoint directly.
# Reused by P1-2 (landmark resolution) and, later, P2-4 (category proximity search).

_PLACES_SEARCHTEXT_URL = "https://places.googleapis.com/v1/places:searchText"


def _places_text_search(
    query: str,
    center_lat: float | None = None,
    center_lng: float | None = None,
    radius_m: float = 50000.0,
    restrict: bool = False,
) -> dict | None:
    """
    Resolve a free-text place query to its canonical name + coordinates using
    Places API (New) Text Search.

    Args:
        query: e.g. "HCLTech Redmond office", "nearest Caltrain".
        center_lat/center_lng: city centroid used to bias/restrict results.
        radius_m: bias radius around the centroid (default 50 km). A tight radius
                  for landmarks keeps "HCLTech Redmond office" near Redmond rather
                  than resolving a same-named place elsewhere.
        restrict: stronger locality intent. Note: Places Text Search (New) only
                  accepts a *circle* in `locationBias` (not `locationRestriction`,
                  which requires a rectangle), so a circle is always sent as a bias;
                  `restrict` tightens the effective radius for landmark resolution.

    Returns: {"name", "lat", "lng", "address"} of the top match, or None.
    """
    key = os.getenv("GOOGLE_MAPS_API_KEY")
    if not key:
        return None

    body: dict = {"textQuery": query}
    if center_lat is not None and center_lng is not None:
        effective_radius = min(float(radius_m), 30000.0) if restrict else float(radius_m)
        body["locationBias"] = {
            "circle": {
                "center": {"latitude": center_lat, "longitude": center_lng},
                "radius": effective_radius,
            }
        }

    resp = httpx.post(
        _PLACES_SEARCHTEXT_URL,
        headers={
            "Content-Type": "application/json",
            "X-Goog-Api-Key": key,
            "X-Goog-FieldMask": "places.displayName,places.location,places.formattedAddress",
        },
        json=body,
        timeout=10.0,
    )
    resp.raise_for_status()
    places = resp.json().get("places", [])
    if not places:
        return None
    p = places[0]
    loc = p.get("location") or {}
    if "latitude" not in loc or "longitude" not in loc:
        return None
    return {
        "name": (p.get("displayName") or {}).get("text") or query,
        "lat": loc["latitude"],
        "lng": loc["longitude"],
        "address": p.get("formattedAddress"),
    }


# ─── Shared listing schema normalizer ────────────────────────────────────────
# F2: carry bedrooms/bathrooms/square_feet through, and attach listing_url +
# listing_source so the frontend can render "View listing" actions (P3-1).

def _fallback_search_url(address: str | None) -> str:
    q = urllib.parse.quote_plus(f"{address} apartment for rent" if address else "apartment for rent")
    return f"https://www.google.com/search?q={q}"


def _normalize(listing: dict, city: str, state: str) -> dict:
    beds = listing.get("bedrooms") or 0
    baths = listing.get("bathrooms") or 0
    price = listing.get("price") or listing.get("monthly_price") or 0
    sqft = listing.get("square_feet") or listing.get("squareFootage")
    bed_str = "Studio" if int(beds) == 0 else f"{int(beds)} Bed"
    address = listing.get("formattedAddress") or listing.get("address")
    source = listing.get("listing_source") or "search"
    url = listing.get("listing_url") or _fallback_search_url(address)
    return {
        "id": listing.get("id") or listing.get("zpid"),
        "agent_description": f"{bed_str}, {int(baths)} Bath in {city}, {state} at ${price:.0f}/mo",
        "monthly_price": price,
        "address": address,
        "latitude": listing.get("latitude"),
        "longitude": listing.get("longitude"),
        "bedrooms": beds,
        "bathrooms": baths,
        "square_feet": sqft,
        "listing_url": url,
        "listing_source": source,
        "photos": listing.get("photos") or [],
    }


def _passes_layout(listing: dict, min_bedrooms: int, min_bathrooms: float) -> bool:
    """Min-semantics layout filter. 0 = no filter (F1: absent → 'Any').
    NOTE (deferred 2026-06-23): this is MIN semantics (≥ N), so a 2BR search
    includes 3BRs. If exact-match layout banding is ever wanted (P1-4 acceptance
    example), change the comparisons here from `<` to `!=`. See plan file P1-4 NOTE.
    """
    if min_bedrooms and (listing.get("bedrooms") or 0) < min_bedrooms:
        return False
    if min_bathrooms and (listing.get("bathrooms") or 0) < min_bathrooms:
        return False
    return True


# ─── Provider 1: RentCast API (primary) ──────────────────────────────────────
# Free tier: 50 calls/month. Guardrails: max 2 calls per run, block at 50/month.
# P1-4: fetched PRICE-UNCAPPED so fetch_apartments can partition by budget and
# compute the market average for the requested layout.

_RENTCAST_URL = "https://api.rentcast.io/v1/listings/rental/long-term"
_RENTCAST_MONTHLY_LIMIT = 50
_RENTCAST_MAX_PER_RUN = 2
_RENTCAST_POOL_SIZE = 50
_RENTCAST_USAGE_FILE = _PROJECT_ROOT / "data" / "rentcast_usage.json"

_rentcast_run_count = 0  # resets on process restart (i.e., per agent session)


def _load_rentcast_usage() -> dict:
    current_month = datetime.now().strftime("%Y-%m")
    if _RENTCAST_USAGE_FILE.exists():
        try:
            with open(_RENTCAST_USAGE_FILE) as f:
                data = json.load(f)
            if data.get("month") == current_month:
                return data
        except (json.JSONDecodeError, KeyError):
            pass
    return {"month": current_month, "count": 0}


def _save_rentcast_usage(usage: dict) -> None:
    _RENTCAST_USAGE_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(_RENTCAST_USAGE_FILE, "w") as f:
        json.dump(usage, f)


def _fetch_rentcast(city: str, state: str, min_bedrooms: int, min_bathrooms: float) -> list[dict] | None:
    global _rentcast_run_count
    api_key = os.getenv("RENTCAST_API_KEY")
    if not api_key:
        return None  # Not configured; skip

    if _rentcast_run_count >= _RENTCAST_MAX_PER_RUN:
        print(f"   ⛔ RentCast per-run limit ({_RENTCAST_MAX_PER_RUN}) reached. Switching to next provider.")
        return None

    usage = _load_rentcast_usage()
    if usage["count"] >= _RENTCAST_MONTHLY_LIMIT:
        print(f"   ⛔ RentCast monthly limit ({_RENTCAST_MONTHLY_LIMIT}) reached. Switching to Apify fallback.")
        return None

    # No maxPrice — P1-4 partitions client-side. bedrooms passed as a server-side
    # floor hint where supported; min_bathrooms filtered client-side below.
    params = {"city": city, "state": state, "status": "Active", "limit": _RENTCAST_POOL_SIZE}
    if min_bedrooms:
        params["bedrooms"] = min_bedrooms
    response = httpx.get(
        _RENTCAST_URL,
        headers={"X-Api-Key": api_key},
        params=params,
        timeout=10.0,
    )
    response.raise_for_status()

    _rentcast_run_count += 1
    usage["count"] += 1
    _save_rentcast_usage(usage)
    print(f"   📊 RentCast usage: {usage['count']}/{_RENTCAST_MONTHLY_LIMIT} this month | {_rentcast_run_count}/{_RENTCAST_MAX_PER_RUN} this run")

    listings = response.json()
    if not listings:
        return []
    normalized = []
    for l in listings:
        l = {**l, "listing_source": "rentcast"}
        n = _normalize(l, city, state)
        if _passes_layout(n, min_bedrooms, min_bathrooms):
            normalized.append(n)
    return normalized


# ─── Provider 2: Apify Zillow Scraper (secondary) ────────────────────────────
# Pricing: $2.3/1000 results. Guardrail: cap at $0.20/run → max 86 results.

_APIFY_MAX_BUDGET_USD = 0.20
_APIFY_COST_PER_1000 = 2.3
_APIFY_MAX_ITEMS = int(_APIFY_MAX_BUDGET_USD / _APIFY_COST_PER_1000 * 1000)  # = 86
_APIFY_POOL_SIZE = 30
_APIFY_ACTOR_URL = "https://api.apify.com/v2/acts/maxcopell~zillow-scraper/run-sync-get-dataset-items"


def _parse_price(val) -> float:
    """Zillow returns prices like '$2,300/mo' (string) or a number. Return the float."""
    if isinstance(val, (int, float)):
        return float(val)
    if isinstance(val, str):
        m = re.search(r"[\d,]+", val)
        if m:
            return float(m.group(0).replace(",", ""))
    return 0.0


def _build_zillow_search_url(city: str, state: str, min_bedrooms: int, min_bathrooms: float) -> str | None:
    """
    The actor requires a Zillow URL containing a `searchQueryState` (map bounds +
    filter state); a plain region URL is rejected. We derive the map bounds from the
    city's Google geocoding viewport and apply the for-rent filter (+ optional layout).
    """
    client = _get_gmaps_client()
    geo = client.geocode(f"{city}, {state}")
    if not geo:
        return None
    vp = geo[0]["geometry"].get("viewport")
    if not vp:
        return None
    ne, sw = vp["northeast"], vp["southwest"]
    filter_state: dict = {
        "fr": {"value": True},      # for rent
        "fsba": {"value": False}, "fsbo": {"value": False}, "nc": {"value": False},
        "cmsn": {"value": False}, "auc": {"value": False}, "fore": {"value": False},
        "sort": {"value": "days"},
    }
    if min_bedrooms:
        filter_state["beds"] = {"min": int(min_bedrooms)}
    if min_bathrooms:
        filter_state["baths"] = {"min": int(min_bathrooms)}
    query_state = {
        "isMapVisible": True,
        "isListVisible": True,
        "mapBounds": {"west": sw["lng"], "east": ne["lng"], "south": sw["lat"], "north": ne["lat"]},
        "filterState": filter_state,
    }
    return "https://www.zillow.com/homes/for_rent/?searchQueryState=" + urllib.parse.quote(json.dumps(query_state))


def _fetch_apify(city: str, state: str, min_bedrooms: int, min_bathrooms: float) -> list[dict] | None:
    api_key = os.getenv("APIFY_API_KEY")
    if not api_key:
        return None  # Not configured; skip

    search_url = _build_zillow_search_url(city, state, min_bedrooms, min_bathrooms)
    if not search_url:
        return []

    safe_max_items = min(_APIFY_POOL_SIZE, _APIFY_MAX_ITEMS)
    # Cost guardrail is enforced at the platform level via run query params
    # (the actor's own input schema has no maxItems field).
    response = httpx.post(
        _APIFY_ACTOR_URL,
        params={"token": api_key, "maxItems": safe_max_items, "maxTotalChargeUsd": _APIFY_MAX_BUDGET_USD},
        json={"searchUrls": [{"url": search_url}], "extractionMethod": "MAP_MARKERS"},
        timeout=180.0,
    )
    if response.status_code >= 400:
        print(f"   ⚠️  Apify {response.status_code}: {response.text[:300]}")
        response.raise_for_status()

    listings = response.json()
    results = []
    for l in listings[:safe_max_items]:
        if not isinstance(l, dict) or l.get("error"):
            continue  # skip actor error/diagnostic items
        latlong = l.get("latLong") or {}
        lat = l.get("latitude") if l.get("latitude") is not None else latlong.get("latitude")
        lng = l.get("longitude") if l.get("longitude") is not None else latlong.get("longitude")
        detail = l.get("detailUrl")
        if detail and detail.startswith("/"):
            detail = f"https://www.zillow.com{detail}"
        img = l.get("imgSrc") or l.get("image")
        # zpid for individual homes; building/community markers use palsId instead.
        listing_id = l.get("zpid") or l.get("palsId") or detail
        raw = {
            "id": listing_id,
            "price": _parse_price(l.get("unformattedPrice") or l.get("price")),
            "formattedAddress": l.get("address"),
            "latitude": lat,
            "longitude": lng,
            "bedrooms": l.get("beds"),
            "bathrooms": l.get("baths"),
            "square_feet": l.get("area") or l.get("livingArea"),
            "listing_url": detail,
            "listing_source": "zillow",
            "photos": [img] if img else [],
        }
        n = _normalize(raw, city, state)
        # Require coordinates, a price, and an address (skip incomplete markers).
        if n["latitude"] is None or n["longitude"] is None or not n["monthly_price"] or not n["address"]:
            continue
        if _passes_layout(n, min_bedrooms, min_bathrooms):
            results.append(n)
    return results


# ─── Provider chain (RentCast → Apify; no offline fallback) ──────────────────

_PROVIDERS = [
    ("rentcast", _fetch_rentcast),
    ("apify",    _fetch_apify),
]


# ─── Public tools (registered with ADK agents) ───────────────────────────────

_OVER_BUDGET_FACTOR = 1.15  # stretch ceiling for over-budget options


def fetch_apartments(
    city: str,
    state: str,
    max_budget: float,
    min_bedrooms: int = 0,
    min_bathrooms: float = 0,
) -> str:
    """
    Finds apartments matching location, budget, and (optional) layout via a
    provider chain: RentCast API → Apify Zillow Scraper. There is no offline
    fallback — at least one provider key must be configured.

    The provider pool is fetched PRICE-UNCAPPED and partitioned by budget here so
    we can surface stretch options and compute the true market average for the
    requested layout when nothing is in budget.

    Args:
        city: Target city (e.g., 'Austin')
        state: Two-letter state abbreviation (e.g., 'TX')
        max_budget: Maximum monthly rent (effective/total budget)
        min_bedrooms: Minimum bedrooms (0 = Any)
        min_bathrooms: Minimum bathrooms (0 = Any)

    Returns one of (JSON string):
      • A list of up to 5 in-budget listings (tagged "over_budget": false), plus
        optionally 1 stretch listing ≤ 15% over budget (tagged "over_budget": true).
      • {"no_match_in_budget": true, "suggested_budget": <layout market avg>,
         "available_options": [...]} when nothing is in budget.
      • {"count": 0, "message": ...} when no listings exist at all.
    """
    if not city or not state:
        return json.dumps({"error": "City and state are required."})
    if max_budget <= 0:
        return json.dumps({"error": "Budget must be greater than 0."})

    # Reset the per-run RentCast counter at the start of every search. "Per run" means
    # one search operation (which may make ≤2 RentCast calls, e.g. multi-area later),
    # NOT the process lifetime — otherwise the long-lived FastAPI server exhausts RentCast
    # after 2 total searches. The monthly file counter still enforces the real 50/mo quota.
    global _rentcast_run_count
    _rentcast_run_count = 0

    pool: list[dict] | None = None
    source = None
    for provider_name, provider_fn in _PROVIDERS:
        try:
            results = provider_fn(city, state, min_bedrooms, min_bathrooms)
            if results is None:
                continue  # Provider not configured; try next
            if len(results) == 0:
                print(f"   ℹ️  Provider '{provider_name}' returned 0 results. Trying next.")
                continue
            pool = results
            source = provider_name
            break
        except Exception as e:
            print(f"   ⚠️  Provider '{provider_name}' failed: {e}")
            continue

    if not pool:
        return json.dumps({
            "message": f"No apartments found in {city}, {state} for the requested layout across all providers.",
            "count": 0,
        })

    print(f"   🏠 Listings retrieved from: {source} ({len(pool)} in layout pool)")

    # Partition the price-uncapped pool by the user's budget.
    in_budget = [l for l in pool if l["monthly_price"] and l["monthly_price"] <= max_budget]
    over_budget = [
        l for l in pool
        if l["monthly_price"] and max_budget < l["monthly_price"] <= max_budget * _OVER_BUDGET_FACTOR
    ]

    if in_budget:
        in_budget.sort(key=lambda l: abs(l["monthly_price"] - max_budget))
        chosen = in_budget[:5]
        for l in chosen:
            l["over_budget"] = False
        # Optionally elevate one stretch option (cheapest over-budget within 15%).
        if over_budget:
            over_budget.sort(key=lambda l: l["monthly_price"])
            stretch = dict(over_budget[0])
            stretch["over_budget"] = True
            chosen.append(stretch)
        return json.dumps(chosen)

    # Nothing in budget → report the market average for THIS layout + alternatives.
    prices = [l["monthly_price"] for l in pool if l["monthly_price"]]
    suggested = round(sum(prices) / len(prices)) if prices else max_budget
    available = sorted(pool, key=lambda l: l["monthly_price"] or 0)[:5]
    for l in available:
        l["over_budget"] = True
    return json.dumps({
        "no_match_in_budget": True,
        "suggested_budget": suggested,
        "available_options": available,
    })


# ─── Requirements seeding (shared by the LLM tool + the structured-intake path) ─

def _compute_requirements(
    *,
    city: str,
    state: str,
    budget: float,
    landmark: str,
    areas: list[dict] | None = None,
    min_bedrooms: int = 0,
    min_bathrooms: float = 0,
    roommates: int = 0,
    budget_is_per_person: bool = False,
    proximity: list[dict] | None = None,
) -> dict:
    """
    Validate the requirements, geocode the landmark, and return the session-state
    delta to persist. Pure (no writes) so callers can persist it correctly:
    the LLM tool path assigns onto ToolContext.state, the F3 structured-intake path
    appends it as an ADK event state_delta.

    Returns {"error": True, "message": ...} on a validation failure, else
    {"delta": {<state keys to set>}}.
    """
    norm_state = (state or "").strip().upper()
    if norm_state not in VALID_US_STATES:
        return {
            "error": True,
            "message": (
                f"'{state}' is not a valid US state. ApartmentFinder currently supports "
                "the 50 US states and DC only. Please provide a 2-letter US state code."
            ),
        }

    # Effective total budget for searching (P2-3 per-person economics).
    effective_budget = budget * (roommates + 1) if budget_is_per_person else budget

    requirements = {
        "city": city,
        "state": norm_state,
        "budget": budget,
        "effective_budget": effective_budget,
        "landmark": landmark,
        "areas": areas or [{"city": city, "state": norm_state}],
        "min_bedrooms": int(min_bedrooms or 0),
        "min_bathrooms": float(min_bathrooms or 0),
        "roommates": int(roommates or 0),
        "budget_is_per_person": bool(budget_is_per_person),
        "proximity": proximity or [],
    }
    delta = {"user_requirements": json.dumps(requirements)}

    # Resolve the landmark to coordinates via Places API (New) Text Search, biased
    # to a circle around the city centroid so "HCLTech Redmond office" resolves to
    # the office — not the Redmond city centroid or a same-named place elsewhere.
    # Falls back to legacy Geocoding only if Places returns nothing.
    try:
        client = _get_gmaps_client()
        c_lat = c_lng = None
        centroid = client.geocode(f"{city}, {norm_state}")
        if centroid:
            cl = centroid[0]["geometry"]["location"]
            c_lat, c_lng = cl["lat"], cl["lng"]

        place = _places_text_search(landmark, c_lat, c_lng, restrict=True)
        if not place:
            geo = client.geocode(f"{landmark}, {city}, {norm_state}")
            if geo:
                loc = geo[0]["geometry"]["location"]
                place = {"name": landmark, "lat": loc["lat"], "lng": loc["lng"]}

        if place:
            delta["landmark_lat"] = place["lat"]
            delta["landmark_lng"] = place["lng"]
            delta["landmark_name"] = place["name"]
            print(f"   📍 Landmark resolved: '{landmark}' → {place['name']} ({place['lat']:.4f}, {place['lng']:.4f})")
    except Exception as e:
        print(f"   ⚠️  Landmark geocoding failed: {e}")

    return {"delta": delta}


def _seed_requirements(state_dict, **kwargs) -> dict:
    """
    Convenience wrapper: compute the delta and assign each key onto a state object
    (ToolContext.state in the LLM path, or a plain dict in tests). Returns
    {"error", "message"} on failure, else {"ok": True}.
    Not for the F3 bridge path — see _compute_requirements + append_event there,
    because InMemorySessionService.get_session returns a copy (in-place writes are lost).
    """
    result = _compute_requirements(**kwargs)
    if result.get("error"):
        return result
    for key, value in result["delta"].items():
        state_dict[key] = value
    return {"ok": True}


def store_requirements(
    city: str,
    state: str,
    budget: float,
    landmark: str,
    tool_context: ToolContext,
    min_bedrooms: int = 0,
    min_bathrooms: float = 0,
    roommates: int = 0,
    budget_is_per_person: bool = False,
) -> str:
    """
    Saves the user's housing requirements to session state so the Research Team can
    access them. Call this before delegating to ResearchTeam.

    Required: city, state (2-letter US code), budget, landmark.
    Optional (default 0/False = 'Any', no filter): min_bedrooms, min_bathrooms,
    roommates, budget_is_per_person.
    """
    result = _seed_requirements(
        tool_context.state,
        city=city,
        state=state,
        budget=budget,
        landmark=landmark,
        min_bedrooms=min_bedrooms,
        min_bathrooms=min_bathrooms,
        roommates=roommates,
        budget_is_per_person=budget_is_per_person,
    )
    if result.get("error"):
        return result["message"]
    return "Requirements saved. Proceeding to research."


def check_commutes(origins: list[str], destination: str, mode: str = "driving") -> str:
    """
    Calculates distances and commute times from multiple origins to a single destination.

    Args:
        origins: List of "lat,lng" strings (e.g., ["30.26,-97.74", "30.50,-97.60"]).
                 Always use latitude/longitude coordinates — never raw addresses.
        destination: Target landmark or address with city and state appended
                     (e.g., "Tesla Gigafactory, Austin, TX")
        mode: Transport mode — "driving", "transit", or "walking" (default: "driving")

    Returns:
        JSON string with distance and duration for each origin-destination pair.
    """
    if not origins:
        return json.dumps({"error": True, "code": "NO_ORIGINS", "message": "No origins provided."})
    try:
        client = _get_gmaps_client()
        result = client.distance_matrix(
            origins=origins,
            destinations=[destination],
            mode=mode,
        )
        return json.dumps(result, separators=(',', ':'))
    except Exception as e:
        return json.dumps({"error": True, "code": "MAPS_API_ERROR", "message": str(e)})
