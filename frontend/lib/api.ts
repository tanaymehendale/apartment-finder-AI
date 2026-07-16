const BASE = "/api";

// SSE streaming bypass. Next.js (both the dev `rewrites()` proxy AND App-Router route
// handlers) BUFFERS `text/event-stream` responses in dev — so the agent pipeline looks
// frozen on "Manager" until it finishes, then dumps everything at once. Pointing the chat
// stream straight at the FastAPI backend (CORS-enabled) bypasses Next and streams live.
//
// Set NEXT_PUBLIC_BACKEND_URL in BOTH dev and production:
//   dev  → http://127.0.0.1:8000 (frontend/.env.local)
//   prod → the Cloud Run URL (set in Vercel's env vars)
// Production used to leave this unset and fall back to the same-origin route handler,
// but that routes the stream through a Vercel function, which is capped at 300s — and a
// run that hits the 429 backoff path (35s x 3 retries on top of a full pipeline) can
// exceed it and die mid-stream. Going straight to Cloud Run has no such cap; the
// tradeoff is that Cloud Run must allow the Vercel origin via ALLOWED_ORIGINS.
// NOTE: NEXT_PUBLIC_* is inlined at BUILD time — it must be set before Vercel builds,
// not after, or the bundle ships with the wrong value baked in.
const STREAM_BASE = process.env.NEXT_PUBLIC_BACKEND_URL ?? "";

export async function createSession(): Promise<string> {
  const res = await fetch(`${BASE}/sessions`, { method: "POST" });
  if (!res.ok) throw new Error("Failed to create session");
  const data = await res.json();
  return data.session_id as string;
}

export async function fetchSessionState(sessionId: string): Promise<Record<string, string>> {
  const res = await fetch(`${BASE}/sessions/${sessionId}/state`);
  if (!res.ok) return {};
  return res.json();
}

/**
 * Is this session id still live on the backend?
 *
 * Session ids are cached in localStorage, but the backend keeps sessions in
 * process memory and Cloud Run scales to zero — so a stored id routinely refers
 * to a session the backend has never heard of. `/state` 404s for those, which
 * fetchSessionState maps to {}. Used before adopting a stored id so we cache the
 * *conversation* without pretending its backend handle is still valid.
 */
export async function isSessionAlive(sessionId: string): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/sessions/${sessionId}/state`);
    return res.ok;
  } catch {
    return false; // backend unreachable — treat as dead; a retry will re-probe
  }
}

// F3: structured-intake payload built by the RequirementCards UI (P2-5).
export interface RequirementsPayload {
  city: string;
  state: string;
  budget: number;
  landmark: string;
  min_bedrooms?: number;
  min_bathrooms?: number;
  roommates?: number;
  budget_is_per_person?: boolean;
  areas?: { city: string; state: string }[];
  proximity?: { label: string; kind: "named" | "category" | "transit" }[];
}

export function chatStream(
  sessionId: string,
  message: string,
  signal?: AbortSignal,
  requirements?: RequirementsPayload,
): ReadableStream<Uint8Array> {
  const controller = new AbortController();
  // Forward external abort signal into the internal controller
  signal?.addEventListener("abort", () => controller.abort());

  return new ReadableStream({
    async start(streamController) {
      try {
        const res = await fetch(`${STREAM_BASE}${BASE}/chat/${sessionId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requirements ? { message, requirements } : { message }),
          signal: controller.signal,
        });

        // A non-2xx (e.g. 404 for an expired session, 502 from a cold-starting
        // backend) has a body too, and piping it through raw would surface as
        // unparseable garbage — or silently as nothing at all. Convert it into a
        // well-formed SSE error+done pair so useChat's handler (and its session
        // recovery) sees a real event instead of a malformed stream.
        if (!res.ok) {
          const detail = await res.text().catch(() => "");
          const content =
            res.status === 404
              ? "Session not found."
              : `Backend returned ${res.status}. ${detail.slice(0, 200)}`.trim();
          const encoder = new TextEncoder();
          streamController.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: "error", content })}\n\n`),
          );
          streamController.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: "done" })}\n\n`),
          );
          streamController.close();
          return;
        }

        if (!res.body) {
          streamController.close();
          return;
        }

        const reader = res.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          streamController.enqueue(value);
        }
        streamController.close();
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          streamController.error(err);
        }
      }
    },
    cancel() {
      controller.abort();
    },
  });
}
