import pandas as pd
import json
import os
import googlemaps
import httpx
from pathlib import Path
from google.adk.tools.tool_context import ToolContext

# ─── Path resolution anchored to this file, not os.getcwd() ──────────────────
_PROJECT_ROOT = Path(__file__).parent.parent
_DATA_PATH = _PROJECT_ROOT / "data" / "apartments_cleaned.csv"

# ─── Lazy-load local CSV (tertiary fallback only) ────────────────────────────
_local_df = None

def _get_local_df() -> pd.DataFrame:
    global _local_df
    if _local_df is None:
        try:
            _local_df = pd.read_csv(_DATA_PATH)
            _local_df['city'] = _local_df['city'].astype(str)
            _local_df['state'] = _local_df['state'].astype(str)
            print(f"📂 Local CSV loaded: {len(_local_df)} listings available.")
        except FileNotFoundError:
            print(f"⚠️  Local CSV not found at {_DATA_PATH}. Run preprocessing.py to generate it.")
            _local_df = pd.DataFrame()
    return _local_df


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


# ─── Shared listing schema normalizer ────────────────────────────────────────

def _normalize(listing: dict, city: str, state: str) -> dict:
    beds = listing.get("bedrooms") or 0
    baths = listing.get("bathrooms") or 0
    price = listing.get("price") or listing.get("monthly_price") or 0
    bed_str = "Studio" if int(beds) == 0 else f"{int(beds)} Bed"
    return {
        "id": listing.get("id") or listing.get("zpid"),
        "agent_description": f"{bed_str}, {int(baths)} Bath in {city}, {state} at ${price:.0f}/mo",
        "monthly_price": price,
        "address": listing.get("formattedAddress") or listing.get("address"),
        "latitude": listing.get("latitude"),
        "longitude": listing.get("longitude"),
    }


# ─── Provider 1: RentCast API (primary) ──────────────────────────────────────
# Free tier: 50 calls/month. Set RENTCAST_API_KEY in .env.

_RENTCAST_URL = "https://api.rentcast.io/v1/listings/rental/long-term"

def _fetch_rentcast(city: str, state: str, max_budget: float) -> list[dict] | None:
    api_key = os.getenv("RENTCAST_API_KEY")
    if not api_key:
        return None  # Not configured; skip
    response = httpx.get(
        _RENTCAST_URL,
        headers={"X-Api-Key": api_key},
        params={"city": city, "state": state, "maxPrice": int(max_budget), "status": "Active", "limit": 5},
        timeout=10.0
    )
    response.raise_for_status()
    listings = response.json()
    return [_normalize(l, city, state) for l in listings[:5]] if listings else []


# ─── Provider 2: Apify Zillow Scraper (secondary) ────────────────────────────
# Free tier: ~$5 platform credit/month. Set APIFY_API_KEY in .env.

def _fetch_apify(city: str, state: str, max_budget: float) -> list[dict] | None:
    api_key = os.getenv("APIFY_API_KEY")
    if not api_key:
        return None  # Not configured; skip
    response = httpx.post(
        "https://api.apify.com/v2/acts/maxcopell~zillow-scraper/run-sync-get-dataset-items",
        headers={"Authorization": f"Bearer {api_key}"},
        json={
            "searchType": "cityState",
            "city": city,
            "state": state,
            "maxPrice": int(max_budget),
            "maxItems": 5,
            "status": "forRent",
        },
        timeout=90.0,
    )
    response.raise_for_status()
    listings = response.json()
    results = []
    for l in listings[:5]:
        addr = l.get("address")
        raw = {
            "id": l.get("zpid"),
            "price": l.get("price"),
            "formattedAddress": addr.get("streetAddress") if isinstance(addr, dict) else addr,
            "latitude": l.get("latitude"),
            "longitude": l.get("longitude"),
            "bedrooms": l.get("bedrooms"),
            "bathrooms": l.get("bathrooms"),
        }
        results.append(_normalize(raw, city, state))
    return results


# ─── Provider 3: Local CSV (tertiary / offline fallback) ─────────────────────
# Always available; data may be stale. No API key required.

def _fetch_local_csv(city: str, state: str, max_budget: float) -> list[dict] | None:
    local_df = _get_local_df()
    if local_df.empty:
        return None
    matches = local_df[
        (local_df['city'].str.lower() == city.lower().strip()) &
        (local_df['state'].str.lower() == state.lower().strip()) &
        (local_df['monthly_price'] <= max_budget)
    ].copy()
    if matches.empty:
        return []
    # Deduplicate city-centroid coordinates so commute results are meaningful
    matches = matches.drop_duplicates(subset=['latitude', 'longitude'])
    # Sort by closest price to budget (best value first)
    matches['_price_diff'] = abs(matches['monthly_price'] - max_budget)
    matches = matches.sort_values('_price_diff').head(5)
    results = json.loads(
        matches[['id', 'agent_description', 'monthly_price', 'address', 'city', 'state', 'latitude', 'longitude']]
        .to_json(orient="records")
    )
    for r in results:
        r["data_warning"] = "Static dataset — listings may be stale."
    return results


# ─── Provider chain ───────────────────────────────────────────────────────────

_PROVIDERS = [
    ("rentcast", _fetch_rentcast),
    ("apify",    _fetch_apify),
    ("local_csv", _fetch_local_csv),
]


# ─── Public tools (registered with ADK agents) ───────────────────────────────

def fetch_apartments(city: str, state: str, max_budget: float) -> str:
    """
    Finds apartments matching location and budget via a provider chain:
    RentCast API → Apify Zillow Scraper → Local CSV fallback.

    Args:
        city: Target city (e.g., 'Austin')
        state: Two-letter state abbreviation (e.g., 'TX')
        max_budget: Maximum monthly rent

    Returns:
        JSON string of up to 5 matching apartments, each with id, agent_description,
        monthly_price, address, latitude, and longitude.
    """
    if not city or not state:
        return json.dumps({"error": "City and state are required."})
    if max_budget <= 0:
        return json.dumps({"error": "Budget must be greater than 0."})

    for provider_name, provider_fn in _PROVIDERS:
        try:
            results = provider_fn(city, state, max_budget)
            if results is None:
                continue  # Provider not configured; try next
            if len(results) == 0:
                return json.dumps({
                    "message": f"No apartments found in {city}, {state} under ${max_budget}.",
                    "count": 0
                })
            print(f"   🏠 Listings retrieved from: {provider_name}")
            return json.dumps(results)
        except Exception as e:
            print(f"   ⚠️  Provider '{provider_name}' failed: {e}")
            continue

    return json.dumps({"error": "All listing providers unavailable.", "count": 0})


def store_requirements(
    city: str,
    state: str,
    budget: float,
    landmark: str,
    tool_context: ToolContext,
) -> str:
    """
    Saves the user's housing requirements to session state so the Research Team can access them.
    Call this before delegating to ResearchTeam.
    """
    tool_context.state["user_requirements"] = json.dumps({
        "city": city,
        "state": state,
        "budget": budget,
        "landmark": landmark,
    })
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
