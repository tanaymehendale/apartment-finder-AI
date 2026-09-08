import type { NextRequest } from "next/server";

// SSE streaming proxy for the agent pipeline.
//
// Next.js `rewrites()` buffer streaming (text/event-stream) responses, so live
// agent status/token events don't reach the browser until the whole pipeline
// finishes — the UI looks frozen on "Manager / Parsing…". A route handler that
// returns the upstream ReadableStream pipes each event through immediately.
//
// Only the chat endpoint needs this; everything else (/api/sessions, /state,
// /directions, /health, /chat/:id/cancel) stays on the rewrite in next.config.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BACKEND = process.env.BACKEND_URL ?? "http://127.0.0.1:8000";

export async function POST(
  req: NextRequest,
  { params }: { params: { sessionId: string } },
) {
  const body = await req.text(); // small JSON: { message, requirements? }

  let upstream: Response;
  try {
    upstream = await fetch(`${BACKEND}/api/chat/${params.sessionId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: req.signal, // forward client abort (Stop button) to the backend
    });
  } catch {
    return new Response(
      `data: ${JSON.stringify({ type: "error", content: "Could not reach the agent server. Is the backend (uvicorn :8000) running?" })}\n\n` +
        `data: ${JSON.stringify({ type: "done" })}\n\n`,
      { status: 200, headers: { "Content-Type": "text/event-stream" } },
    );
  }

  // Pass the upstream SSE stream straight through, unbuffered.
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
