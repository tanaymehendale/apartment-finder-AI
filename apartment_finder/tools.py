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


# ─── Usage-counter storage backend (P3.75-2) ─────────────────────────────────
# The RentCast/Places monthly guardrails need a counter that survives a process
# restart. On a local dev box a JSON file under data/ does that fine. On Cloud Run
# the filesystem is ephemeral AND per-instance, and the service scales to zero — so
# a file-backed counter silently resets to 0 several times a day and the monthly
# caps stop capping anything (the guardrail becomes theater, and the fallback
# provider — Apify — costs real money).
#
# So the backend is pluggable, defaulting to today's exact file behavior:
#   USAGE_STORE=file       (default) → data/<kind>_usage.json. Dev, CLI, tests.
#   USAGE_STORE=firestore            → one doc per kind. Cloud Run.
# The stored shape is identical either way: {"month": "2026-07", "count": 12}.
#
# Firestore (not GCS) because at this volume — a single ~33-byte document — both
# cost $0, so the choice is on correctness: a Firestore document write is atomic,
# which removes the truncate-then-write torn-read that can currently read a
# half-written file, hit JSONDecodeError, and silently reset the count to 0.
_USAGE_STORE = os.getenv("USAGE_STORE", "file").strip().lower()
_USAGE_FIRESTORE_COLLECTION = os.getenv("USAGE_FIRESTORE_COLLECTION", "apartment_finder_usage")
_firestore_client = None


def _get_firestore_client():
    global _firestore_client
    if _firestore_client is None:
        from google.cloud import firestore  # imported lazily: only needed on Cloud Run
        _firestore_client = firestore.Client()
    return _firestore_client


def _load_usage(kind: str, usage_file: Path) -> dict:
    """
    Read a monthly usage counter. Returns {"month": "%Y-%m", "count": int}.

    A month rollover is implicit: we stamp the CURRENT month and only trust a
    stored count whose month matches. Anything else (new month, missing record,
    corrupt JSON, backend unreachable) yields a fresh zeroed counter — fail-open,
    matching the pre-existing missing-file semantics. `kind` is "rentcast"/"places".
    """
    current_month = datetime.now().strftime("%Y-%m")
    if _USAGE_STORE == "firestore":
        try:
            snap = _get_firestore_client().collection(
                _USAGE_FIRESTORE_COLLECTION
            ).document(kind).get()
            data = snap.to_dict() if snap.exists else None
            if data and data.get("month") == current_month:
                return {"month": current_month, "count": int(data.get("count", 0))}
        except Exception as e:
            # Loud: a silently-zeroed counter is exactly the failure this exists to prevent.
            print(f"   ⚠️  Firestore usage read failed for '{kind}' ({e}). Treating as 0 this call.")
        return {"month": current_month, "count": 0}

    if usage_file.exists():
        try:
            with open(usage_file) as f:
                data = json.load(f)
            if data.get("month") == current_month:
                return data
        except (json.JSONDecodeError, KeyError):
            pass
    return {"month": current_month, "count": 0}


def _save_usage(kind: str, usage: dict, usage_file: Path) -> None:
    """Persist a monthly usage counter. Never raises — a counter write must not
    break a search that already spent the API call."""
    if _USAGE_STORE == "firestore":
        try:
            _get_firestore_client().collection(
                _USAGE_FIRESTORE_COLLECTION
            ).document(kind).set({"month": usage["month"], "count": int(usage["count"])})
        except Exception as e:
            print(f"   ⚠️  Firestore usage write failed for '{kind}' ({e}). Count not persisted.")
        return

    try:
        usage_file.parent.mkdir(parents=True, exist_ok=True)
        with open(usage_file, "w") as f:
            json.dump(usage, f)
    except OSError as e:
        print(f"   ⚠️  Usage file write failed for '{kind}' ({e}). Count not persisted.")


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
_PLACES_SEARCHNEARBY_URL = "https://places.googleapis.com/v1/places:searchNearby"


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


def _places_category_nearest(lat: float, lng: float, query: str, radius_m: float = 8000.0) -> dict | None:
    """
    P2-4: find the NEAREST place matching a free-text category (e.g. "Indian grocery")
    to a given point, using Places API (New) Text Search with rankPreference=DISTANCE
    and a locationBias circle. Returns {"name", "lat", "lng"} of the closest match, or None.
    Each successful call is one billable Places request — guardrailed by the caller.
    """
    key = os.getenv("GOOGLE_MAPS_API_KEY")
    if not key:
        return None
    body = {
        "textQuery": query,
        "rankPreference": "DISTANCE",
        "locationBias": {
            "circle": {"center": {"latitude": lat, "longitude": lng}, "radius": float(radius_m)}
        },
        "maxResultCount": 1,
    }
    resp = httpx.post(
        _PLACES_SEARCHTEXT_URL,
        headers={
            "Content-Type": "application/json",
            "X-Goog-Api-Key": key,
            "X-Goog-FieldMask": "places.displayName,places.location",
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
    }


# ─── P2-4 transit (Tier 1): nearest transit STATION by Google Places type ─────
# Free-text "Caltrain"/"bus stop" geocodes to an area centroid, not a station, so for
# transit we use Places (New) Nearby Search constrained to a station *type* and ranked by
# DISTANCE. This returns the actual nearest station's name + coords (nationwide, no GTFS).

# Ordered keyword → Places station type. Order matters: "light rail" must be checked
# before "rail" so it isn't swallowed by the train rule.
_TRANSIT_TYPE_RULES = [
    (("bus",), "bus_station"),
    (("subway", "metro", "underground"), "subway_station"),
    (("light rail", "lightrail", "tram", "streetcar", "trolley"), "light_rail_station"),
    (("train", "rail", "caltrain", "amtrak", "commuter", "railway"), "train_station"),
]


def _transit_type_for(label: str) -> str:
    """Map a free-text transit label to a Google Places (New) station type."""
    l = (label or "").lower()
    for keys, station_type in _TRANSIT_TYPE_RULES:
        if any(k in l for k in keys):
            return station_type
    return "transit_station"  # generic: any stop/station


def _places_nearby_transit(lat: float, lng: float, included_type: str, radius_m: float = 8000.0) -> dict | None:
    """
    Nearest transit station of a given type to a point, via Places (New) Nearby Search.
    NOTE: searchNearby requires `locationRestriction` (a circle) — unlike Text Search,
    which only accepts a circle in `locationBias`. Returns {"name","lat","lng"} or None.
    """
    key = os.getenv("GOOGLE_MAPS_API_KEY")
    if not key:
        return None
    body = {
        "includedTypes": [included_type],
        "maxResultCount": 1,
        "rankPreference": "DISTANCE",
        "locationRestriction": {
            "circle": {"center": {"latitude": lat, "longitude": lng}, "radius": float(radius_m)}
        },
    }
    resp = httpx.post(
        _PLACES_SEARCHNEARBY_URL,
        headers={
            "Content-Type": "application/json",
            "X-Goog-Api-Key": key,
            "X-Goog-FieldMask": "places.displayName,places.location",
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
        "name": (p.get("displayName") or {}).get("text") or included_type.replace("_", " "),
        "lat": loc["latitude"],
        "lng": loc["longitude"],
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
    # Thin delegate — kept as a zero-arg module-level function because tests
    # monkeypatch this exact name (see test_tools.py) and the storage backend is
    # selected inside _load_usage.
    return _load_usage("rentcast", _RENTCAST_USAGE_FILE)


def _save_rentcast_usage(usage: dict) -> None:
    _save_usage("rentcast", usage, _RENTCAST_USAGE_FILE)


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


def _dedupe_pool(pool: list[dict]) -> list[dict]:
    """Dedupe a multi-provider pool by rounded coordinates (falls back to address
    when coordinates are missing). First occurrence wins, so earlier providers in
    `_PROVIDERS` (RentCast) take priority over later ones (Apify) on overlap."""
    seen: set = set()
    deduped = []
    for l in pool:
        lat, lng = l.get("latitude"), l.get("longitude")
        key = (round(lat, 4), round(lng, 4)) if lat is not None and lng is not None else l.get("address")
        if key in seen:
            continue
        seen.add(key)
        deduped.append(l)
    return deduped


# ─── Public tools (registered with ADK agents) ───────────────────────────────

_OVER_BUDGET_FACTOR = 1.15  # stretch ceiling for over-budget options

# Minimum in-budget listings we want before we stop querying further providers.
# Below this, a single thin/sparse provider pool (RentCast's free tier is known to
# have patchy coverage) isn't given the final say — we also query the next provider
# and merge, so a broader source (e.g. Apify/Zillow) gets a fair shot at supplying
# in-budget options RentCast alone didn't have. Only triggers on the searches that
# would otherwise come back thin/empty; a search that already has enough in-budget
# results after the first provider costs nothing extra.
_MIN_IN_BUDGET_TARGET = 3


def _attach_per_person_price(listings: list[dict], roommates: int) -> None:
    """Deterministic, code-computed per-person rent (monthly_price ÷ (roommates+1)),
    attached in-place so the Analyst/Summarizer relay a ready-made number instead of
    doing the arithmetic (and formatting) themselves in prose — an LLM asked to state
    "monthly_price ÷ (roommates+1)" inline in a longer writeup can (and did, in
    production) apply the split a second time to its own already-divided figure.

    Also attaches `per_person_label`, the FULLY FORMATTED "split N ways" phrase — a
    prior fix gave the Summarizer just the number and told it to write "split N ways"
    itself, and it copied the literal "2 ways" from the prompt's example regardless of
    the real occupant count. Giving it the whole phrase pre-built leaves nothing left
    to get wrong.

    roommates=0 means solo, so no per-person split applies (fields are None)."""
    if roommates <= 0:
        for l in listings:
            l["per_person_price"] = None
            l["per_person_label"] = None
        return
    occupants = roommates + 1
    for l in listings:
        price = l.get("monthly_price")
        per_person = round(price / occupants) if price else None
        l["per_person_price"] = per_person
        l["per_person_label"] = (
            f"${per_person:,.0f} per person, split {occupants} ways" if per_person is not None else None
        )


def fetch_apartments(
    city: str,
    state: str,
    max_budget: float,
    min_bedrooms: int = 0,
    min_bathrooms: float = 0,
    roommates: int = 0,
    tool_context: ToolContext | None = None,
) -> str:
    """
    Finds apartments matching location, budget, and (optional) layout via a
    provider chain: RentCast API → Apify Zillow Scraper. There is no offline
    fallback — at least one provider key must be configured.

    The provider pool is fetched PRICE-UNCAPPED and partitioned by budget here so
    we can surface stretch options and compute the true market average for the
    requested layout when nothing is in budget. If the first provider with results
    doesn't clear `_MIN_IN_BUDGET_TARGET` in-budget listings, the next provider is
    also queried and the pools are merged (deduped) before partitioning — this
    guards against a single thin provider (RentCast's free tier especially) silently
    under-representing what's actually on the market.

    Args:
        city: Target city (e.g., 'Austin')
        state: Two-letter state abbreviation (e.g., 'TX')
        max_budget: Maximum monthly rent (effective/total budget)
        min_bedrooms: Minimum bedrooms (0 = Any)
        min_bathrooms: Minimum bathrooms (0 = Any)
        roommates: additional occupants beyond the user (0 = solo). Used ONLY to
            attach a precomputed `per_person_price`/`per_person_label` per listing —
            never affects which listings are chosen (that's driven by `max_budget`,
            which the caller already adjusts for per-person budgets via `effective_budget`).
        tool_context: injected by ADK; used to deterministically record the search
            outcome (`search_status`) in session state so downstream agents don't
            have to infer "did we find anything" purely from prose (see agent.py).

    Returns one of (JSON string):
      • A list of up to 5 in-budget listings (tagged "over_budget": false), plus
        optionally 1 stretch listing ≤ 15% over budget (tagged "over_budget": true).
        Each listing includes `per_person_price`/`per_person_label` (both null if roommates=0).
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

    pool: list[dict] = []
    sources_used: list[str] = []
    for provider_name, provider_fn in _PROVIDERS:
        try:
            results = provider_fn(city, state, min_bedrooms, min_bathrooms)
        except Exception as e:
            print(f"   ⚠️  Provider '{provider_name}' failed: {e}")
            continue
        if results is None:
            continue  # Provider not configured; try next
        if len(results) == 0:
            print(f"   ℹ️  Provider '{provider_name}' returned 0 results. Trying next.")
            continue

        pool = _dedupe_pool(pool + results)
        sources_used.append(provider_name)
        in_budget_so_far = sum(1 for l in pool if l["monthly_price"] and l["monthly_price"] <= max_budget)
        print(f"   🏠 '{provider_name}' contributed {len(results)} listings "
              f"({len(pool)} pooled, {in_budget_so_far} in-budget so far)")

        if in_budget_so_far >= _MIN_IN_BUDGET_TARGET:
            break  # enough in-budget options; stop querying further providers (cost control)
        # else: thin/no in-budget results so far — also try the next provider

    if not pool:
        if tool_context is not None:
            tool_context.state["search_status"] = "no_results"
        return json.dumps({
            "message": f"No apartments found in {city}, {state} for the requested layout across all providers.",
            "count": 0,
        })

    print(f"   🏠 Combined pool from {', '.join(sources_used)}: {len(pool)} listings")

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
        _attach_per_person_price(chosen, roommates)
        if tool_context is not None:
            tool_context.state["search_status"] = "ok"
        return json.dumps(chosen)

    # Nothing in budget → report the market average for THIS layout + alternatives.
    prices = [l["monthly_price"] for l in pool if l["monthly_price"]]
    suggested = round(sum(prices) / len(prices)) if prices else max_budget
    available = sorted(pool, key=lambda l: l["monthly_price"] or 0)[:5]
    for l in available:
        l["over_budget"] = True
    _attach_per_person_price(available, roommates)
    if tool_context is not None:
        tool_context.state["search_status"] = "no_match_in_budget"
        tool_context.state["suggested_budget"] = suggested
    return json.dumps({
        "no_match_in_budget": True,
        "suggested_budget": suggested,
        "available_options": available,
    })


# ─── Deterministic safety net for the Reviewer/Summarizer status routing ─────
# `search_status` (written above, in code, at the moment fetch_apartments computes
# the real outcome) is the ground truth. The Reviewer/Summarizer chain is supposed
# to relay it correctly via prose markers, but that's LLM instruction-following
# across two more hops — if it ever collapses a real result into a false
# "STATUS: NO_RESULTS", these helpers let agent.py rebuild a correct reply from
# state directly instead of showing the user a false negative. See agent.py's
# `_summarizer_before_callback`.

def _looks_like_erroneous_no_results(safety_report: str) -> bool:
    return (safety_report or "").strip().upper().startswith("STATUS: NO_RESULTS")


def extract_leading_json_array(text: str) -> list[dict] | None:
    """Parse the JSON array the Analyst is instructed to emit as the first thing
    in its dossier (ANALYST_PROMPT STEP 1), ignoring any trailing commute/prose
    text. Returns None if the dossier doesn't start with a JSON array."""
    if not text:
        return None
    decoder = json.JSONDecoder()
    try:
        obj, _ = decoder.raw_decode(text.strip())
    except (json.JSONDecodeError, ValueError):
        return None
    return obj if isinstance(obj, list) else None


def build_fallback_recommendation(state) -> str | None:
    """
    Deterministic correction: if `search_status` (set by fetch_apartments) says
    listings exist but the safety_report the Reviewer produced looks like the
    erroneous NO_RESULTS bail-out, rebuild a correct message from analyst_dossier
    directly — no LLM call needed. Returns None when no correction is needed
    (either the pipeline behaved correctly, or there's nothing to fall back to).
    """
    search_status = state.get("search_status")
    if search_status not in ("ok", "no_match_in_budget"):
        return None  # genuinely no results, or status was never recorded

    if not _looks_like_erroneous_no_results(state.get("safety_report", "")):
        return None  # pipeline behaved correctly; nothing to fix

    listings = extract_leading_json_array(state.get("analyst_dossier", "")) or []
    if not listings:
        return None  # nothing to fall back to; let the normal error path handle it

    try:
        reqs = json.loads(state.get("user_requirements") or "{}")
    except json.JSONDecodeError:
        reqs = {}
    city = reqs.get("city", "your area")
    req_state = reqs.get("state", "")
    budget = reqs.get("budget")

    if search_status == "no_match_in_budget":
        suggested = state.get("suggested_budget")
        budget_str = f"${budget:,.0f}/mo" if budget else "your budget"
        header = f"Nothing was available within {budget_str} for this search in {city}, {req_state}."
        if suggested:
            header += f" The typical market rate for this layout is about ${suggested:,.0f}/mo."
        header += " Here are the closest available options:"
    else:
        header = f"I found {len(listings)} option(s) in {city}, {req_state} — see the listings and map for details."

    lines = [header]
    for l in listings:
        price = l.get("monthly_price")
        addr = l.get("address") or ""
        tag = " (over budget)" if l.get("over_budget") else ""
        per_person = f" ({l['per_person_label']})" if l.get("per_person_label") else ""
        lines.append(f"- {addr} — ${price:,.0f}/mo{per_person}{tag}" if price else f"- {addr}{tag}")
    return "\n".join(lines)


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
    roommates = int(roommates or 0)
    effective_budget = budget * (roommates + 1) if budget_is_per_person else budget

    # P2-3: when the user has roommates but didn't specify a layout, default the
    # bedroom floor to one room per occupant (roommates + 1). Explicit min_bedrooms
    # always wins; 0 roommates leaves the filter at "Any".
    eff_min_bedrooms = int(min_bedrooms or 0)
    if roommates > 0 and eff_min_bedrooms == 0:
        eff_min_bedrooms = roommates + 1

    requirements = {
        "city": city,
        "state": norm_state,
        "budget": budget,
        "effective_budget": effective_budget,
        "landmark": landmark,
        "areas": areas or [{"city": city, "state": norm_state}],
        "min_bedrooms": eff_min_bedrooms,
        "min_bathrooms": float(min_bathrooms or 0),
        "roommates": roommates,
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
    city: str | None = None,
    state: str | None = None,
    budget: float | None = None,
    landmark: str | None = None,
    tool_context: ToolContext = None,
    min_bedrooms: int = 0,
    min_bathrooms: float = 0,
    roommates: int = 0,
    budget_is_per_person: bool = False,
) -> str:
    """
    Saves the user's housing requirements to session state so the Research Team can
    access them. Call this before delegating to ResearchTeam.

    Required (on the FIRST search of a conversation): city, state (2-letter US code),
    budget, landmark. Optional (default 0/False = 'Any', no filter): min_bedrooms,
    min_bathrooms, roommates, budget_is_per_person.

    FU-1 (follow-up searches): if requirements were already saved earlier in this
    conversation and the user changes only some of them (e.g. "make it $3000"), you
    may omit any field that didn't change — every field left unset here is carried
    forward from the previously saved requirements automatically. Only fields the
    user is actively restating/changing need to be passed.
    """
    prev: dict = {}
    prev_raw = tool_context.state.get("user_requirements")
    if prev_raw:
        try:
            prev = json.loads(prev_raw) if isinstance(prev_raw, str) else dict(prev_raw)
        except (json.JSONDecodeError, TypeError, ValueError):
            prev = {}

    # FU-1: a follow-up call may omit unchanged required fields — fall back to the
    # previous search's values so a one-field change ("make it $3000") doesn't force
    # the Manager to perfectly recall/restate everything else from the conversation.
    city = city or prev.get("city")
    state = state or prev.get("state")
    budget = budget if budget is not None else prev.get("budget")
    landmark = landmark or prev.get("landmark")
    if not (city and state and budget is not None and landmark):
        return (
            "Missing required information: city, state, budget, and landmark are "
            "all needed to search. Please ask the user for the missing field(s)."
        )

    # P2-5: fold in optional preferences the F3 bridge seeded from the RequirementCards
    # UI (`pending_optional`). The LLM only parses the 4 required fields from free text;
    # structured optional fields — especially `proximity`, which the LLM can't reliably
    # pass as a nested list — are applied here deterministically. An explicit non-default
    # value supplied by the LLM (because the user restated it in text) wins over the card,
    # which in turn wins over the previous search's value (FU-1 carry-forward). Note this
    # means an explicit reset to "Any" (0/False) can't be distinguished from "not restated
    # this turn" — same accepted trade-off as the pending_optional fold-in above.
    pending: dict = {}
    raw = tool_context.state.get("pending_optional")
    if raw:
        try:
            pending = json.loads(raw) if isinstance(raw, str) else dict(raw)
        except (json.JSONDecodeError, TypeError, ValueError):
            pending = {}

    min_bedrooms = (
        int(min_bedrooms or 0) or int(pending.get("min_bedrooms") or 0) or int(prev.get("min_bedrooms") or 0)
    )
    min_bathrooms = (
        float(min_bathrooms or 0) or float(pending.get("min_bathrooms") or 0) or float(prev.get("min_bathrooms") or 0)
    )
    roommates = (
        int(roommates or 0) or int(pending.get("roommates") or 0) or int(prev.get("roommates") or 0)
    )
    budget_is_per_person = (
        bool(budget_is_per_person) or bool(pending.get("budget_is_per_person")) or bool(prev.get("budget_is_per_person"))
    )
    proximity = pending.get("proximity") or prev.get("proximity") or []

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
        proximity=proximity,
    )
    if result.get("error"):
        return result["message"]
    return "Requirements saved. Proceeding to research."


# ─── P2-4: Proximity to transit + amenities (guardrailed Places usage) ───────
# Mirrors the RentCast/Apify guardrail pattern: per-run cap + monthly counter in
# data/places_usage.json + an in-process cache keyed on rounded coords + query, so
# nearby listings don't each spend a separate Places call. Runs only for the
# already-displayed listings (the Analyst passes their lat/lng as origins).

_PLACES_USAGE_FILE = _PROJECT_ROOT / "data" / "places_usage.json"
_PLACES_MONTHLY_LIMIT = 200     # Text Search (New) calls per month
_PLACES_MAX_PER_RUN = 25        # ≤ ~5 listings × ~5 category queries per search
_PLACES_CACHE: dict[str, dict | None] = {}  # "rlat,rlng|query" → nearest match (or None)
_places_run_count = 0           # reset at the start of every find_nearby_amenities batch


def _load_places_usage() -> dict:
    # See _load_rentcast_usage — same delegate pattern, same monkeypatch contract.
    return _load_usage("places", _PLACES_USAGE_FILE)


def _save_places_usage(usage: dict) -> None:
    _save_usage("places", usage, _PLACES_USAGE_FILE)


def _haversine_miles(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    from math import radians, sin, cos, asin, sqrt
    dlat = radians(lat2 - lat1)
    dlng = radians(lng2 - lng1)
    a = sin(dlat / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlng / 2) ** 2
    return 3958.8 * 2 * asin(sqrt(a))  # Earth radius in miles


def _distance_text(miles: float) -> str:
    return f"{miles:.1f} mi" if miles < 10 else f"{round(miles)} mi"


def _parse_origin(origin: str) -> tuple[float, float] | None:
    try:
        lat_s, lng_s = origin.split(",")
        return float(lat_s.strip()), float(lng_s.strip())
    except (ValueError, AttributeError):
        return None


def find_nearby_amenities(origins: list[str], label: str, kind: str = "category") -> str:
    """
    For each listing origin, find the nearest amenity matching `label` and its distance.
    Call this once per proximity preference in user_requirements["proximity"], passing the
    SAME origins list you used for check_commutes (so results line up with the listings).

    Args:
        origins: List of "lat,lng" strings for the displayed listings (e.g. ["37.39,-122.08", ...]).
        label: The amenity to locate, e.g. "Caltrain"/"bus stop" (transit), "Indian grocery" (category).
        kind: "transit"  → nearest transit STATION via Places (New) Nearby Search constrained to the
                           matching station type (train/bus/subway/light-rail), ranked by distance.
                           Use this for transit (trains, buses, subway, Caltrain, BART, etc.).
              "category" → Places (New) Text Search near EACH listing for the nearest match
                           (e.g. grocery, gym, park). Both are guardrailed: per-run cap + monthly
                           counter + coord cache.
              "named"    → resolve `label` ONCE via free geocoding to a fixed point, then report each
                           listing's straight-line distance to it (use only for a specific named place).

    Returns JSON string:
      {"label": str, "kind": str, "results": [{"origin","name","distance_text"} | null per origin]}
    """
    global _places_run_count
    if not origins:
        return json.dumps({"label": label, "kind": kind, "results": []})
    if kind not in ("named", "transit", "category"):
        kind = "category"

    # ── Named: one free geocode to a fixed point, then haversine per listing ──
    if kind == "named":
        try:
            client = _get_gmaps_client()
            geo = client.geocode(label)
            if not geo:
                return json.dumps({"label": label, "kind": kind, "results": [], "error": "not_found"})
            loc = geo[0]["geometry"]["location"]
            name = geo[0].get("formatted_address", label)
            results = []
            for origin in origins:
                pt = _parse_origin(origin)
                if not pt:
                    results.append(None)
                    continue
                miles = _haversine_miles(pt[0], pt[1], loc["lat"], loc["lng"])
                results.append({"origin": origin, "name": name, "distance_text": _distance_text(miles)})
            return json.dumps({"label": label, "kind": kind, "results": results})
        except Exception as e:
            return json.dumps({"label": label, "kind": kind, "results": [], "error": str(e)})

    # ── Category / transit: nearest Places match per listing, guardrailed + cached ──
    # Both spend Places calls; they differ only in the per-origin resolver + cache namespace.
    if kind == "transit":
        included_type = _transit_type_for(label)
        resolver = lambda lat, lng: _places_nearby_transit(lat, lng, included_type)  # noqa: E731
        cache_label = f"transit:{included_type}"
    else:
        resolver = lambda lat, lng: _places_category_nearest(lat, lng, label)  # noqa: E731
        cache_label = label.lower()

    _places_run_count = 0
    usage = _load_places_usage()
    results = []
    for origin in origins:
        pt = _parse_origin(origin)
        if not pt:
            results.append(None)
            continue
        lat, lng = pt
        cache_key = f"{round(lat, 3)},{round(lng, 3)}|{cache_label}"
        if cache_key in _PLACES_CACHE:
            match = _PLACES_CACHE[cache_key]
        elif _places_run_count >= _PLACES_MAX_PER_RUN or usage["count"] >= _PLACES_MONTHLY_LIMIT:
            print(f"   ⛔ Places guardrail hit (run {_places_run_count}/{_PLACES_MAX_PER_RUN}, "
                  f"month {usage['count']}/{_PLACES_MONTHLY_LIMIT}). Skipping remaining '{label}' lookups.")
            results.append(None)
            continue
        else:
            try:
                match = resolver(lat, lng)
            except Exception as e:
                print(f"   ⚠️  Places lookup failed for '{label}' near {origin}: {e}")
                match = None
            _PLACES_CACHE[cache_key] = match
            _places_run_count += 1
            usage["count"] += 1
        if match:
            miles = _haversine_miles(lat, lng, match["lat"], match["lng"])
            results.append({"origin": origin, "name": match["name"], "distance_text": _distance_text(miles)})
        else:
            results.append(None)
    _save_places_usage(usage)
    print(f"   📊 Places usage: {usage['count']}/{_PLACES_MONTHLY_LIMIT} this month "
          f"({_places_run_count} new calls for '{label}')")
    return json.dumps({"label": label, "kind": kind, "results": results})


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
