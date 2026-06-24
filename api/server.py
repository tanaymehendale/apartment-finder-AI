"""
FastAPI server — exposes the ADK apartment finder agent over HTTP with SSE streaming.
"""
import json
import os
import polyline as polyline_codec
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from api import session_manager
from apartment_finder.tools import _get_gmaps_client

load_dotenv()

app = FastAPI(title="ApartmentFinder API")

app.add_middleware(
    CORSMiddleware,
    # Allow the dev frontend to hit the backend directly (any localhost port) so the
    # SSE chat stream can bypass Next's buffering proxy. Tighten for production.
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
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
async def create_session():
    session_id = await session_manager.create_session()
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


@app.get("/api/health")
async def health():
    missing = [k for k in ["GOOGLE_API_KEY", "GOOGLE_MAPS_API_KEY"] if not os.getenv(k)]
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
    }
