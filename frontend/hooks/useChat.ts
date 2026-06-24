"use client";
import { useState, useCallback, useRef, useEffect } from "react";
import { createSession, chatStream, type RequirementsPayload } from "@/lib/api";
import { parseAnalystDossier, mergeSafetyReport, parseRanking, applyRanking, stripRankingMarker } from "@/lib/parseApartments";
import type { ChatMessage, AgentStatusEvent, AgentName, Apartment, LandmarkInfo, SSEEvent } from "@/lib/types";

function uid() {
  return Math.random().toString(36).slice(2);
}

const INTERMEDIATE_AGENTS = new Set(["analyst", "reviewer", "ResearchTeam", "Research Team"]);

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
        await fetch(`/api/chat/${sessionIdRef.current}/cancel`, { method: "POST" });
      } catch {
        // best-effort
      }
    }
  }, []);

  const sendMessage = useCallback(async (userText: string, requirements?: RequirementsPayload) => {
    if (isStreaming || !userText.trim()) return;

    const userMsg: ChatMessage = {
      id: uid(),
      role: "user",
      content: userText.trim(),
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setIsStreaming(true);
    setAgentStatus(null);

    if (!sessionIdRef.current) {
      try {
        sessionIdRef.current = await createSession();
        const sessions = JSON.parse(localStorage.getItem("apt_sessions") ?? "[]");
        sessions.unshift({
          id: sessionIdRef.current,
          title: userText.slice(0, 60),
          createdAt: new Date().toISOString(),
        });
        localStorage.setItem("apt_sessions", JSON.stringify(sessions.slice(0, 20)));
      } catch {
        setIsStreaming(false);
        return;
      }
    }

    const assistantMsgId = uid();
    setMessages((prev) => [
      ...prev,
      { id: assistantMsgId, role: "assistant", content: "", timestamp: new Date() },
    ]);

    const abortController = new AbortController();
    abortRef.current = abortController;

    // Only forward a structured payload if it actually carries optional fields;
    // an empty object means "plain free-text search" (skip the structured path).
    const reqs = requirements && Object.keys(requirements).length > 0 ? requirements : undefined;
    const stream = chatStream(sessionIdRef.current!, userText.trim(), abortController.signal, reqs);
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let analystDossier = "";
    let safetyReport = "";
    let receivedContent = false;
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
      setIsStreaming(false);
      setAgentStatus(null);
      abortRef.current = null;
      if (!receivedContent && !abortController.signal.aborted) {
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
    }
  }, [isStreaming]);

  const resetSession = useCallback(() => {
    sessionIdRef.current = null;
    setMessages([]);
    setApartments([]);
    setAgentStatus(null);
    setIsStreaming(false);
    setLandmark(null);
    setRoommates(0);
  }, []);

  const restoreSession = useCallback((sessionId: string) => {
    sessionIdRef.current = sessionId;

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
