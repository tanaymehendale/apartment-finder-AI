const BASE = "/api";

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
  proximity?: { label: string; kind: "named" | "category" }[];
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
        const res = await fetch(`${BASE}/chat/${sessionId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requirements ? { message, requirements } : { message }),
          signal: controller.signal,
        });

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
