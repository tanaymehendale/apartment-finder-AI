"use client";
import { useState, useCallback, useRef, useEffect } from "react";
import { createSession, chatStream, isSessionAlive, cancelSession, type RequirementsPayload } from "@/lib/api";
import { parseAnalystDossier, mergeSafetyReport, parseRanking, applyRanking, stripRankingMarker } from "@/lib/parseApartments";
import type { ChatMessage, AgentStatusEvent, AgentName, Apartment, LandmarkInfo, SSEEvent } from "@/lib/types";

function uid() {
  return Math.random().toString(36).slice(2);
}

const INTERMEDIATE_AGENTS = new Set(["analyst", "reviewer", "ResearchTeam", "Research Team"]);

// The backend's "this session doesn't exist" signal. It arrives as a normal SSE
// error event inside a 200 response (api/session_manager.py), so it can't be
// detected from an HTTP status — it has to be matched on the message.
const SESSION_LOST_RE = /session not found/i;

// The auth gate's 401/403 messages (lib/api.ts's chatStream), also relayed as an
// SSE error event. Matched explicitly (not just relying on it happening not to
// match SESSION_LOST_RE) so the session-recovery replay below never fires for an
// auth failure — replaying with a fresh session wouldn't help; the token itself
// is bad or the account isn't the owner.
const UNAUTHORIZED_RE = /^(not authorized|signed in as a different account)/i;

type TurnOutcome = "ok" | "session-lost" | "unauthorized" | "aborted";

const CACHE_PREFIXES = ["apt_messages_", "apt_apartments_", "apt_landmark_", "apt_roommates_"];

/**
 * Re-key a conversation's cached data from `oldId` to `newId`.
 *
 * Used when session recovery mints a fresh backend session for a conversation the
 * user is already looking at: without this, the sidebar would sprout a duplicate
 * entry for the same conversation and the old cache keys would be orphaned.
 */
function rekeySession(oldId: string, newId: string, fallbackTitle: string) {
  try {
    const sessions = JSON.parse(localStorage.getItem("apt_sessions") ?? "[]") as {
      id: string;
      title: string;
      createdAt: string;
    }[];
    const existing = sessions.find((s) => s.id === oldId);
    const next = existing
      ? sessions.map((s) => (s.id === oldId ? { ...s, id: newId } : s))
      : [{ id: newId, title: fallbackTitle.slice(0, 60), createdAt: new Date().toISOString() }, ...sessions];
    localStorage.setItem("apt_sessions", JSON.stringify(next.slice(0, 20)));

    for (const prefix of CACHE_PREFIXES) {
      const value = localStorage.getItem(`${prefix}${oldId}`);
      if (value !== null) {
        localStorage.setItem(`${prefix}${newId}`, value);
        localStorage.removeItem(`${prefix}${oldId}`);
      }
    }
  } catch {
    // localStorage unavailable/full — recovery itself still works, so don't block it.
  }
}

function buildSessionTitle(userRequirementsJson: string): string | null {
  try {
    const r = JSON.parse(userRequirementsJson);
    if (r.city && r.state && r.budget) {
      return `Apartments in ${r.city}, ${r.state} < $${Number(r.budget).toLocaleString()}`;
    }
  } catch {
    // ignore
  }
  return null;
}

export function useChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [agentStatus, setAgentStatus] = useState<AgentStatusEvent | null>(null);
  const [apartments, setApartments] = useState<Apartment[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [landmark, setLandmark] = useState<LandmarkInfo | null>(null);
  // P2-3: number of additional roommates (0 = living solo). Drives the per-person
  // rent split shown on each card.
  const [roommates, setRoommates] = useState<number>(0);
  const sessionIdRef = useRef<string | null>(null);
  // A restored session id that the backend has since forgotten. Kept so the next
  // ensureSession() can re-key its sidebar entry/cache onto the fresh id instead
  // of leaving a duplicate conversation behind.
  const staleSessionIdRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const id = sessionIdRef.current;
    if (!id || messages.length === 0) return;
    try {
      localStorage.setItem(
        `apt_messages_${id}`,
        JSON.stringify(messages.map((m) => ({ ...m, timestamp: m.timestamp.toISOString() })))
      );
    } catch {
      // ignore storage quota errors
    }
  }, [messages]);

  useEffect(() => {
    const id = sessionIdRef.current;
    if (!id || apartments.length === 0) return;
    try {
      localStorage.setItem(`apt_apartments_${id}`, JSON.stringify(apartments));
    } catch {
      // ignore storage quota errors
    }
  }, [apartments]);

  useEffect(() => {
    const id = sessionIdRef.current;
    if (!id || !landmark) return;
    try {
      localStorage.setItem(`apt_landmark_${id}`, JSON.stringify(landmark));
    } catch {
      // ignore
    }
  }, [landmark]);

  useEffect(() => {
    const id = sessionIdRef.current;
    if (!id || roommates === 0) return;
    try {
      localStorage.setItem(`apt_roommates_${id}`, String(roommates));
    } catch {
      // ignore
    }
  }, [roommates]);

  const stopStreaming = useCallback(async () => {
    abortRef.current?.abort();
    setIsStreaming(false);
    setAgentStatus(null);
    if (sessionIdRef.current) {
      try {
        await cancelSession(sessionIdRef.current);
      } catch {
        // best-effort
      }
    }
  }, []);

  // SESSION RECOVERY (P3.75-1)
  //
  // The backend keeps sessions in process memory, and Cloud Run scales to zero —
  // so a session id cached in localStorage routinely refers to one the backend has
  // never heard of. Previously that bricked the conversation permanently: the error
  // was painted into the bubble, sessionIdRef was never cleared, and every retry
  // re-hit the same dead id. Now a lost session is re-created transparently.
  //
  // `replacesId` is the dead session being recovered, if any — its sidebar entry
  // and cache are re-keyed onto the new id rather than leaving a duplicate behind.
  // Returns the live session id, or null if the backend is unreachable.
  const ensureSession = useCallback(
    async (titleSeed: string, replacesId?: string): Promise<string | null> => {
      if (sessionIdRef.current) return sessionIdRef.current;
      // A restored-but-dead session (detected by restoreSession's probe) is
      // recovered here too, not just one that dies mid-conversation.
      const supersedes = replacesId ?? staleSessionIdRef.current ?? undefined;
      try {
        const id = await createSession();
        sessionIdRef.current = id;
        staleSessionIdRef.current = null;
        if (supersedes) {
          rekeySession(supersedes, id, titleSeed);
        } else {
          const sessions = JSON.parse(localStorage.getItem("apt_sessions") ?? "[]");
          sessions.unshift({
            id,
            title: titleSeed.slice(0, 60),
            createdAt: new Date().toISOString(),
          });
          localStorage.setItem("apt_sessions", JSON.stringify(sessions.slice(0, 20)));
        }
        return id;
      } catch {
        return null;
      }
    },
    [],
  );

  const sendMessage = useCallback(async (userText: string, requirements?: RequirementsPayload) => {
    if (isStreaming || !userText.trim()) return;

    const text = userText.trim();
    const userMsg: ChatMessage = {
      id: uid(),
      role: "user",
      content: text,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setIsStreaming(true);
    setAgentStatus(null);

    const assistantMsgId = uid();
    setMessages((prev) => [
      ...prev,
      { id: assistantMsgId, role: "assistant", content: "", timestamp: new Date() },
    ]);

    // Only forward a structured payload if it actually carries optional fields;
    // an empty object means "plain free-text search" (skip the structured path).
    const reqs = requirements && Object.keys(requirements).length > 0 ? requirements : undefined;

    // Run one turn against `sessionId`. Returns "session-lost" when the backend
    // has no such session so the caller can transparently re-create and replay —
    // see the SESSION RECOVERY note above `ensureSession`.
    const runTurn = async (sessionId: string): Promise<TurnOutcome> => {
      const abortController = new AbortController();
      abortRef.current = abortController;

      const stream = chatStream(sessionId, text, abortController.signal, reqs);
      const reader = stream.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let analystDossier = "";
      let safetyReport = "";
      let receivedContent = false;
      let sessionLost = false;
      let unauthorized = false;
      let currentBubbleId = assistantMsgId;
      let currentBubbleAuthor: string | null = null;
      let currentRaw = ""; // unstripped accumulator for the current bubble (to hide the RANKING marker)

      try {
        while (true) {
          if (abortController.signal.aborted) break;
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const jsonStr = line.slice(6).trim();
            if (!jsonStr) continue;

            let event: SSEEvent;
            try {
              event = JSON.parse(jsonStr);
            } catch {
              continue;
            }

            if (event.type === "status") {
              setAgentStatus({ agent: event.agent, step: event.step });
            } else if (event.type === "waiting") {
              setAgentStatus({ agent: event.agent as AgentName, step: "waiting" });
            } else if (event.type === "token") {
              const isIntermediate = INTERMEDIATE_AGENTS.has(event.author ?? "");
              if (!isIntermediate && event.content) {
                receivedContent = true;
                const tokenAuthor = event.author ?? "";

                if (tokenAuthor !== currentBubbleAuthor) {
                  if (currentBubbleAuthor !== null) {
                    const newId = uid();
                    currentBubbleId = newId;
                    setMessages((prev) => [
                      ...prev,
                      { id: newId, role: "assistant", content: "", timestamp: new Date() },
                    ]);
                  }
                  currentBubbleAuthor = tokenAuthor;
                  currentRaw = "";
                }

                currentRaw += event.content;
                const display = stripRankingMarker(currentRaw);
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === currentBubbleId ? { ...m, content: display } : m
                  )
                );
              }
            } else if (event.type === "error") {
              // A dead session is recoverable — don't paint it, let the caller
              // replay on a fresh one. Any other error is real; show it.
              if (SESSION_LOST_RE.test(event.content ?? "")) {
                sessionLost = true;
                continue;
              }
              if (UNAUTHORIZED_RE.test(event.content ?? "")) {
                unauthorized = true;
              }
              receivedContent = true;
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === currentBubbleId
                    ? { ...m, content: `⚠️ ${event.content}` }
                    : m
                )
              );
            } else if (event.type === "state") {
              analystDossier = event.analyst_dossier;
              safetyReport = event.safety_report;
              const { apartments: parsed } = parseAnalystDossier(analystDossier);
              const withSafety = mergeSafetyReport(parsed, safetyReport);
              // Reorder cards/pins to follow the Summarizer's reasoned ranking (its
              // hidden RANKING marker), so chat, cards, and map agree on the Top Pick.
              const ranking = parseRanking(event.final_recommendation ?? "");
              setApartments(applyRanking(withSafety, ranking));

              // Extract landmark
              if (event.landmark_lat != null && event.landmark_lng != null) {
                setLandmark({
                  name: event.landmark_name ?? "",
                  lat: event.landmark_lat,
                  lng: event.landmark_lng,
                });
              }

              // P2-3: extract roommate count for per-person rent display
              if (event.user_requirements) {
                try {
                  const r = JSON.parse(event.user_requirements);
                  setRoommates(Number(r.roommates) || 0);
                } catch {
                  // ignore
                }
              }

              // Update session title from user_requirements
              if (event.user_requirements && sessionIdRef.current) {
                const title = buildSessionTitle(event.user_requirements);
                if (title) {
                  const sessions = JSON.parse(localStorage.getItem("apt_sessions") ?? "[]");
                  const updated = sessions.map((s: { id: string; title: string; createdAt: string }) =>
                    s.id === sessionIdRef.current ? { ...s, title } : s
                  );
                  localStorage.setItem("apt_sessions", JSON.stringify(updated));
                }
              }
            } else if (event.type === "done") {
              setAgentStatus(null);
            }
          }
        }
      } finally {
        abortRef.current = null;
      }

      if (abortController.signal.aborted) return "aborted";
      if (sessionLost) return "session-lost";
      if (unauthorized) return "unauthorized";
      if (!receivedContent) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === currentBubbleId
              ? {
                  ...m,
                  content:
                    "⚠️ No response received. The pipeline may be rate-limited or encountered an error. Please wait a moment and try again.",
                }
              : m
          )
        );
      }
      return "ok";
    };

    const paint = (content: string) =>
      setMessages((prev) =>
        prev.map((m) => (m.id === assistantMsgId ? { ...m, content } : m))
      );

    try {
      let sessionId = await ensureSession(text);
      if (!sessionId) {
        paint("⚠️ Couldn't reach the agent server to start a session. Please try again in a moment.");
        return;
      }

      let outcome = await runTurn(sessionId);

      // SESSION RECOVERY: the backend lost this session (Cloud Run scaled to zero
      // or redeployed — its sessions live in process memory). Mint a fresh one and
      // replay ONCE, silently. Bounded to a single retry so a genuinely broken
      // backend surfaces an error instead of looping.
      if (outcome === "session-lost") {
        const deadId = sessionIdRef.current;
        sessionIdRef.current = null;
        const fresh = await ensureSession(text, deadId ?? undefined);
        outcome = fresh ? await runTurn(fresh) : "session-lost";
      }

      if (outcome === "session-lost") {
        paint(
          "⚠️ Your previous session expired and I couldn't start a new one. Please reload and try again."
        );
      }
    } finally {
      setIsStreaming(false);
      setAgentStatus(null);
      abortRef.current = null;
    }
  }, [isStreaming, ensureSession]);

  const resetSession = useCallback(() => {
    sessionIdRef.current = null;
    staleSessionIdRef.current = null; // starting fresh — nothing to re-key onto
    setMessages([]);
    setApartments([]);
    setAgentStatus(null);
    setIsStreaming(false);
    setLandmark(null);
    setRoommates(0);
  }, []);

  const restoreSession = useCallback((sessionId: string) => {
    sessionIdRef.current = sessionId;

    // The stored id is a *display cache key* first and a live backend handle only
    // maybe — the backend may have scaled to zero since. Probe it in the
    // background; if it's dead, drop the ref (keeping the restored transcript on
    // screen) so the next message transparently starts a fresh session instead of
    // erroring. Fire-and-forget: never block rendering the conversation on it.
    void isSessionAlive(sessionId).then((alive) => {
      if (!alive && sessionIdRef.current === sessionId) {
        sessionIdRef.current = null;
        staleSessionIdRef.current = sessionId;
      }
    });

    const stored = localStorage.getItem(`apt_messages_${sessionId}`);
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as (Omit<ChatMessage, "timestamp"> & { timestamp: string })[];
        setMessages(parsed.map((m) => ({ ...m, timestamp: new Date(m.timestamp) })));
      } catch {
        setMessages([]);
      }
    } else {
      setMessages([]);
    }

    const storedApts = localStorage.getItem(`apt_apartments_${sessionId}`);
    if (storedApts) {
      try {
        setApartments(JSON.parse(storedApts));
      } catch {
        setApartments([]);
      }
    } else {
      setApartments([]);
    }

    const storedLandmark = localStorage.getItem(`apt_landmark_${sessionId}`);
    if (storedLandmark) {
      try {
        setLandmark(JSON.parse(storedLandmark));
      } catch {
        setLandmark(null);
      }
    } else {
      setLandmark(null);
    }

    const storedRoommates = localStorage.getItem(`apt_roommates_${sessionId}`);
    setRoommates(storedRoommates ? Number(storedRoommates) || 0 : 0);

    setAgentStatus(null);
    setIsStreaming(false);
  }, []);

  return {
    messages,
    agentStatus,
    apartments,
    isStreaming,
    landmark,
    roommates,
    sendMessage,
    stopStreaming,
    resetSession,
    restoreSession,
    sessionId: sessionIdRef.current,
  };
}
