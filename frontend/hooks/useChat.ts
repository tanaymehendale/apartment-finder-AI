"use client";
import { useState, useCallback, useRef } from "react";
import { createSession, chatStream } from "@/lib/api";
import { parseAnalystDossier, mergeSafetyReport } from "@/lib/parseApartments";
import type { ChatMessage, AgentStatusEvent, Apartment, SSEEvent } from "@/lib/types";

function uid() {
  return Math.random().toString(36).slice(2);
}

export function useChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [agentStatus, setAgentStatus] = useState<AgentStatusEvent | null>(null);
  const [apartments, setApartments] = useState<Apartment[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const sessionIdRef = useRef<string | null>(null);

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
        // Persist to localStorage for sidebar
        const sessions = JSON.parse(localStorage.getItem("apt_sessions") ?? "[]");
        sessions.unshift({ id: sessionIdRef.current, title: userText.slice(0, 60), createdAt: new Date().toISOString() });
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
          } else if (event.type === "token") {
            // Show tokens from the final-answer agents (manager = multi-turn Q&A, summarizer = final report)
            const isFinalAgent =
              event.author === "summarizer" || event.author === "manager";
            if (isFinalAgent) {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMsgId
                    ? { ...m, content: m.content + event.content }
                    : m
                )
              );
            }
          } else if (event.type === "error") {
            // Replace the placeholder assistant message with the error
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsgId
                  ? { ...m, content: `⚠️ ${event.content}`, role: "assistant" }
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
      // Drop the placeholder message if it never received any content
      setMessages((prev) =>
        prev.filter((m) => m.id !== assistantMsgId || m.content.length > 0)
      );
    }
  }, [isStreaming]);

  const resetSession = useCallback(() => {
    sessionIdRef.current = null;
    setMessages([]);
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
    sessionId: sessionIdRef.current,
  };
}
