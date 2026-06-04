"use client";
import { useState, useCallback, useRef, useEffect } from "react";
import { createSession, chatStream } from "@/lib/api";
import { parseAnalystDossier, mergeSafetyReport } from "@/lib/parseApartments";
import type { ChatMessage, AgentStatusEvent, AgentName, Apartment, SSEEvent } from "@/lib/types";

function uid() {
  return Math.random().toString(36).slice(2);
}

// Tokens from these agents are intermediate and not shown to the user
const INTERMEDIATE_AGENTS = new Set(["analyst", "reviewer", "ResearchTeam", "Research Team"]);

export function useChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [agentStatus, setAgentStatus] = useState<AgentStatusEvent | null>(null);
  const [apartments, setApartments] = useState<Apartment[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const sessionIdRef = useRef<string | null>(null);

  // Persist messages to localStorage whenever they change (keyed by session ID)
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

  const sendMessage = useCallback(async (userText: string) => {
    if (isStreaming || !userText.trim()) return;

    // Add user message
    const userMsg: ChatMessage = {
      id: uid(),
      role: "user",
      content: userText.trim(),
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setIsStreaming(true);
    setAgentStatus(null);

    // Create session on first message
    if (!sessionIdRef.current) {
      try {
        sessionIdRef.current = await createSession();
        // Persist session metadata to localStorage for sidebar
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

    // Placeholder assistant message
    const assistantMsgId = uid();
    setMessages((prev) => [
      ...prev,
      { id: assistantMsgId, role: "assistant", content: "", timestamp: new Date() },
    ]);

    const stream = chatStream(sessionIdRef.current!, userText.trim());
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let analystDossier = "";
    let safetyReport = "";
    let receivedContent = false;

    try {
      while (true) {
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
            // Show tokens from any agent except known intermediate ones.
            // Using an exclusion list so unknown/empty authors also show through.
            const isIntermediate = INTERMEDIATE_AGENTS.has(event.author ?? "");
            if (!isIntermediate && event.content) {
              receivedContent = true;
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMsgId
                    ? { ...m, content: m.content + event.content }
                    : m
                )
              );
            }
          } else if (event.type === "error") {
            receivedContent = true;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsgId
                  ? { ...m, content: `⚠️ ${event.content}` }
                  : m
              )
            );
          } else if (event.type === "state") {
            analystDossier = event.analyst_dossier;
            safetyReport = event.safety_report;
            const { apartments: parsed } = parseAnalystDossier(analystDossier);
            const withSafety = mergeSafetyReport(parsed, safetyReport);
            setApartments(withSafety);
          } else if (event.type === "done") {
            setAgentStatus(null);
          }
        }
      }
    } finally {
      setIsStreaming(false);
      setAgentStatus(null);
      // If the stream ended without any content (silent pipeline failure), show a fallback
      // so the user knows something went wrong rather than seeing a blank disappear.
      if (!receivedContent) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId
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
    setApartments([]);
    setAgentStatus(null);
    setIsStreaming(false);
  }, []);

  return {
    messages,
    agentStatus,
    apartments,
    isStreaming,
    sendMessage,
    resetSession,
    restoreSession,
    sessionId: sessionIdRef.current,
  };
}
