"""
FastAPI server — exposes the ADK apartment finder agent over HTTP with SSE streaming.
"""
import json
import os
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from api import session_manager

load_dotenv()

app = FastAPI(title="ApartmentFinder API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class ChatRequest(BaseModel):
    message: str


@app.post("/api/sessions")
async def create_session():
    session_id = await session_manager.create_session()
    return {"session_id": session_id}


@app.post("/api/chat/{session_id}")
async def chat(session_id: str, body: ChatRequest):
    async def event_stream():
        async for event in session_manager.stream_message(session_id, body.message):
            yield f"data: {json.dumps(event)}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@app.get("/api/sessions/{session_id}/state")
async def get_state(session_id: str):
    state = await session_manager.get_session_state(session_id)
    if not state:
        raise HTTPException(status_code=404, detail="Session not found or empty state")
    return state


@app.get("/api/health")
async def health():
    missing = [k for k in ["GOOGLE_API_KEY", "GOOGLE_MAPS_API_KEY"] if not os.getenv(k)]
    return {
        "status": "ok" if not missing else "degraded",
        "missing_keys": missing,
        "listing_provider": (
            "rentcast" if os.getenv("RENTCAST_API_KEY")
            else "apify" if os.getenv("APIFY_API_KEY")
            else "local_csv"
        ),
    }
