"""
FastAPI server — exposes the ADK apartment finder agent over HTTP with SSE streaming.
"""
import asyncio
import json
import os
import httpx
import polyline as polyline_codec
from dotenv import load_dotenv

# Must load .env BEFORE importing api.session_manager / apartment_finder — that
# import chain reaches apartment_finder.agent, which initializes Langfuse tracing
# (P3.5-1) at import time and needs LANGFUSE_* env vars already present.
load_dotenv()

from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response, StreamingResponse
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token
from pydantic import BaseModel
from api import session_manager
from apartment_finder import tools, tracing, user_profiles
from apartment_finder.tools import _get_gmaps_client


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    # Cloud Run SIGTERMs the instance whenever it scales to zero (min-instances=0),
    # so without this the last buffered spans — often the most interesting ones —
    # never reach Langfuse. Runs on graceful shutdown; a no-op when tracing is off.
    tracing.flush()


app = FastAPI(title="ApartmentFinder API", lifespan=lifespan)

# Phase 5 — open Firebase Auth gate. Every route except /api/health and
# /api/photo requires a Firebase ID token (`Authorization: Bearer <token>`,
# minted client-side by frontend/lib/firebase.ts) with a verified email — ANY
# verified account is accepted (no longer restricted to a single OWNER_EMAIL;
# real multi-user onboarding replaced the old single-owner gate). The verified
# claims are attached to `request.state.user` so route handlers know who's
# calling — used by session creation (to build a per-user agent tree / resolve
# BYOK keys) and the new /api/profile endpoints. /api/photo is exempted too:
# it's loaded via a plain <img src> tag, which can't carry a bearer header, and
# it only ever serves a public Street View image for coordinates already
# visible in the authenticated UI — low sensitivity, same narrow-exemption
# shape as /api/health. No-op when FIREBASE_PROJECT_ID isn't set (local dev
# needs no config), same convention as tracing.init(). Registered BEFORE
# CORSMiddleware below so CORS stays the outermost middleware and answers
# preflight OPTIONS requests itself — this gate never sees them.
_FIREBASE_PROJECT_ID = os.getenv("FIREBASE_PROJECT_ID")
_AUTH_EXEMPT_PATHS = {"/api/health", "/api/photo"}
# Module-level so the fetched Google public-cert cache persists across requests
# on a warm instance instead of being refetched every call.
_google_auth_request = google_requests.Request()


@app.middleware("http")
async def auth_gate(request: Request, call_next):
    request.state.user = None
    if _FIREBASE_PROJECT_ID and request.url.path not in _AUTH_EXEMPT_PATHS:
        authz = request.headers.get("authorization", "")
        token = authz[7:].strip() if authz.lower().startswith("bearer ") else ""
        if not token:
            return JSONResponse({"detail": "Unauthorized"}, status_code=401)
        try:
            # verify_firebase_token is sync (backed by the `requests` library) —
            # run it off the event loop so one slow cert fetch can't stall every
            # other in-flight request on this instance.
            claims = await asyncio.to_thread(
                google_id_token.verify_firebase_token,
                token,
                _google_auth_request,
                audience=_FIREBASE_PROJECT_ID,
            )
        except Exception:
            return JSONResponse({"detail": "Unauthorized"}, status_code=401)
        email = (claims.get("email") or "").lower()
        if not email or not claims.get("email_verified"):
            print(f"[auth_gate] unverified account rejected: {email or '(no email)'}")
            return JSONResponse({"detail": "Forbidden"}, status_code=403)
        request.state.user = {"uid": claims.get("user_id") or claims.get("sub"), "email": email}
    return await call_next(request)


# The browser talks to this API cross-origin for the SSE chat stream — in dev to
# bypass Next's buffering proxy, and in production because the deployed frontend
# (Vercel) points NEXT_PUBLIC_BACKEND_URL straight at Cloud Run to sidestep
# Vercel's 300s function cap (a long 429-retry run can exceed it). So the deployed
# frontend's origin MUST be allowed here or every search fails at the preflight.
# Set ALLOWED_ORIGINS to a comma-separated list, e.g.
#   ALLOWED_ORIGINS=https://apartment-finder.vercel.app
_extra_origins = [
    o.strip() for o in os.getenv("ALLOWED_ORIGINS", "").split(",") if o.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000", *_extra_origins],
    # Dev convenience only: any localhost port. Deployed origins come from
    # ALLOWED_ORIGINS above — this regex must never be widened to match them.
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1):\d+",
    allow_methods=["*"],
    allow_headers=["*"],
)


class ChatRequest(BaseModel):
    message: str
    # F3: optional structured-intake payload. When present, the bridge pre-seeds
    # session state deterministically (no LLM free-text parse of these fields).
    requirements: dict | None = None


@app.post("/api/sessions")
async def create_session(request: Request):
    user = request.state.user
    session_id = await session_manager.create_session(
        uid=user["uid"] if user else None,
        email=user["email"] if user else None,
    )
    return {"session_id": session_id}


@app.post("/api/chat/{session_id}")
async def chat(session_id: str, body: ChatRequest):
    async def event_stream():
        async for event in session_manager.stream_message(
            session_id, body.message, requirements=body.requirements
        ):
            yield f"data: {json.dumps(event)}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@app.post("/api/chat/{session_id}/cancel")
async def cancel_chat(session_id: str):
    cancelled = session_manager.cancel_session(session_id)
    if not cancelled:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"cancelled": True}


@app.get("/api/sessions/{session_id}/state")
async def get_state(session_id: str):
    state = await session_manager.get_session_state(session_id)
    if not state:
        raise HTTPException(status_code=404, detail="Session not found or empty state")
    return state


def _require_user(request: Request) -> dict:
    """Profile endpoints only make sense for an authenticated user — 401 when
    auth isn't configured at all (local dev) or the caller isn't signed in."""
    user = request.state.user
    if not user:
        raise HTTPException(status_code=401, detail="Sign in required")
    return user


class ApiKeyRequest(BaseModel):
    provider: str  # "openai" | "rentcast" | "apify"
    value: str


@app.get("/api/profile")
async def get_profile(request: Request):
    user = _require_user(request)
    return await asyncio.to_thread(user_profiles.get_profile_summary, user["uid"])


@app.post("/api/profile/keys")
async def save_profile_key(request: Request, body: ApiKeyRequest):
    user = _require_user(request)
    if body.provider not in ("openai", "rentcast", "apify"):
        raise HTTPException(status_code=400, detail="Unknown provider")
    if not body.value.strip():
        raise HTTPException(status_code=400, detail="Key value is required")
    try:
        await asyncio.to_thread(
            user_profiles.save_api_key, user["uid"], user["email"], body.provider, body.value.strip()
        )
    except RuntimeError as e:
        # PROFILE_ENCRYPTION_KEY not configured on this deploy.
        raise HTTPException(status_code=503, detail=str(e))
    return await asyncio.to_thread(user_profiles.get_profile_summary, user["uid"])


@app.delete("/api/profile/keys/{provider}")
async def delete_profile_key(request: Request, provider: str):
    user = _require_user(request)
    if provider not in ("openai", "rentcast", "apify"):
        raise HTTPException(status_code=400, detail="Unknown provider")
    await asyncio.to_thread(user_profiles.clear_api_key, user["uid"], provider)
    return await asyncio.to_thread(user_profiles.get_profile_summary, user["uid"])


@app.post("/api/profile/keys/test")
async def test_profile_key(request: Request, body: ApiKeyRequest):
    """Cheap live validation of a key before it's saved, so a typo surfaces
    immediately instead of mid-search. RentCast has no free "whoami" endpoint,
    so its test spends one of the user's own RentCast calls — noted in the
    response message."""
    _require_user(request)
    value = body.value.strip()
    if not value:
        return {"valid": False, "message": "Key is required."}

    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            if body.provider == "openai":
                resp = await client.get(
                    "https://api.openai.com/v1/models",
                    headers={"Authorization": f"Bearer {value}"},
                )
                valid = resp.status_code == 200
                message = "Key is valid." if valid else "OpenAI rejected this key."
            elif body.provider == "apify":
                resp = await client.get(
                    "https://api.apify.com/v2/users/me", params={"token": value}
                )
                valid = resp.status_code == 200
                message = "Key is valid." if valid else "Apify rejected this key."
            elif body.provider == "rentcast":
                resp = await client.get(
                    "https://api.rentcast.io/v1/listings/rental/long-term",
                    headers={"X-Api-Key": value},
                    params={"city": "Austin", "state": "TX", "limit": 1},
                )
                valid = resp.status_code == 200
                message = (
                    "Key is valid (this test used one of your RentCast calls)."
                    if valid else "RentCast rejected this key."
                )
            else:
                raise HTTPException(status_code=400, detail="Unknown provider")
        except httpx.HTTPError:
            valid, message = False, "Couldn't reach the provider to validate this key."
    return {"valid": valid, "message": message}


@app.get("/api/directions")
async def get_directions(
    origin: str = Query(..., description="lat,lng of origin"),
    destination: str = Query(..., description="lat,lng of destination"),
    mode: str = Query("driving", description="driving|transit|walking"),
):
    try:
        client = _get_gmaps_client()
        routes = client.directions(origin, destination, mode=mode)
        if not routes:
            raise HTTPException(status_code=404, detail="No route found")
        encoded = routes[0]["overview_polyline"]["points"]
        points = polyline_codec.decode(encoded)  # returns [(lat, lng), ...]
        return {"points": [[lat, lng] for lat, lng in points]}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


_STREETVIEW_URL = "https://maps.googleapis.com/maps/api/streetview"


@app.get("/api/photo")
async def get_photo(
    lat: float = Query(..., description="Listing latitude"),
    lng: float = Query(..., description="Listing longitude"),
):
    """
    Real-time listing photo fallback (RentCast/Apify rarely provide one): a
    Street View image of the listing's own coordinates, proxied server-side so
    GOOGLE_MAPS_API_KEY never reaches the browser (this route is called via a
    plain <img src>, which can't send the app's auth header — see the
    auth_gate exemption above). `return_error_code=true` makes Google 4xx
    instead of returning its generic "no imagery" placeholder image, so we can
    404 and let the frontend fall back to its own icon placeholder.
    """
    key = os.getenv("GOOGLE_MAPS_API_KEY")
    if not key:
        raise HTTPException(status_code=404, detail="No imagery")
    try:
        resp = httpx.get(
            _STREETVIEW_URL,
            params={
                "size": "640x400",
                "location": f"{lat},{lng}",
                "fov": 90,
                "return_error_code": "true",
                "key": key,
            },
            timeout=10.0,
        )
    except httpx.HTTPError:
        raise HTTPException(status_code=404, detail="No imagery")
    if resp.status_code != 200:
        raise HTTPException(status_code=404, detail="No imagery")
    return Response(
        content=resp.content,
        media_type=resp.headers.get("content-type", "image/jpeg"),
        headers={"Cache-Control": "public, max-age=86400"},
    )


@app.get("/api/health")
async def health():
    missing = [k for k in ["GOOGLE_API_KEY", "GOOGLE_MAPS_API_KEY", "OPENAI_API_KEY"] if not os.getenv(k)]
    # P1-1: no offline CSV fallback — at least one listing provider key is required.
    provider = (
        "rentcast" if os.getenv("RENTCAST_API_KEY")
        else "apify" if os.getenv("APIFY_API_KEY")
        else None
    )
    if provider is None:
        missing.append("RENTCAST_API_KEY|APIFY_API_KEY")
    return {
        "status": "ok" if not missing else "degraded",
        "missing_keys": missing,
        "listing_provider": provider,
        "tracing_enabled": tracing.enabled,
        # P3.75-2: "file" on an ephemeral filesystem (Cloud Run) means the monthly
        # quota caps silently reset on every scale-to-zero. Surfaced here so a
        # misconfigured deploy is visible at a glance rather than discovered via
        # a surprise Apify bill.
        "usage_store": tools._USAGE_STORE,
    }
