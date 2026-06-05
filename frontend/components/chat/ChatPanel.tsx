"use client";
import { useRef, useEffect, useState, KeyboardEvent } from "react";
import type { ChatMessage, AgentStatusEvent } from "@/lib/types";
import { MessageBubble } from "./MessageBubble";
import { AgentStatus } from "./AgentStatus";

type Phase = "landing" | "chatting" | "results";

const SUGGESTIONS = [
  "Apartments in Austin, TX under $1,500, near Tesla Gigafactory",
  "Find me a 2BR in Seattle under $2,000, near Amazon HQ",
  "Rentals in Denver, CO under $1,800, near Denver International Airport",
];

interface Props {
  phase: Phase;
  messages: ChatMessage[];
  agentStatus: AgentStatusEvent | null;
  isStreaming: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
  onNewSearch: () => void;
}

export function ChatPanel({ phase, messages, agentStatus, isStreaming, onSend, onStop, onNewSearch }: Props) {
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function handleSubmit() {
    const text = input.trim();
    if (!text || isStreaming) return;
    setInput("");
    onSend(text);
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  }

  function handleKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  function handleTextareaChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value);
    const ta = e.target;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 160) + "px";
  }

  // ── Landing phase ─────────────────────────────────────────────────────────
  if (phase === "landing") {
    return (
      <div className="flex flex-col items-center justify-center h-full px-6 bg-[#F8FAFC]">
        <div className="w-full max-w-2xl flex flex-col items-center gap-8">
          {/* Brand */}
          <div className="flex flex-col items-center gap-3 text-center">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary to-accent flex items-center justify-center shadow-lg">
              <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                  d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
              </svg>
            </div>
            <div>
              <h1 className="text-3xl font-bold text-gray-900 tracking-tight">ApartmentFinder AI</h1>
              <p className="text-sm text-muted mt-1">Find your next home — powered by Gemini 2.5 Flash</p>
            </div>
          </div>

          {/* Input area */}
          <div className="w-full">
            <div className="flex items-end gap-3 bg-white border border-gray-200 rounded-3xl px-5 py-4 shadow-md focus-within:border-primary focus-within:ring-4 focus-within:ring-primary/10 transition-all">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={handleTextareaChange}
                onKeyDown={handleKey}
                placeholder="Tell me where you want to live, your budget, and a commute landmark…"
                rows={2}
                className="flex-1 resize-none bg-transparent text-sm text-gray-900 placeholder:text-gray-400 outline-none leading-relaxed"
                style={{ minHeight: "48px", maxHeight: "160px" }}
              />
              <button
                onClick={handleSubmit}
                disabled={!input.trim()}
                className="flex-shrink-0 w-10 h-10 rounded-2xl bg-primary text-white flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed hover:bg-primary-700 transition-colors shadow-sm"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              </button>
            </div>
            <p className="text-[11px] text-muted/60 text-center mt-2">Enter to send · Shift+Enter for new line</p>
          </div>

          {/* Suggestion chips */}
          <div className="w-full flex flex-col gap-2">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => onSend(s)}
                className="w-full text-left px-4 py-3 text-sm text-gray-600 bg-white border border-gray-200 rounded-2xl hover:border-primary hover:text-primary hover:bg-primary-50 transition-all shadow-sm"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ── Chatting / results phase ───────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-white">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-primary to-accent flex items-center justify-center shadow-sm">
            <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
            </svg>
          </div>
          <span className="text-sm font-semibold text-gray-900">ApartmentFinder AI</span>
        </div>
        <button
          onClick={onNewSearch}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 hover:text-primary hover:bg-primary-50 rounded-lg transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          New search
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto py-4 space-y-1">
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        <div ref={bottomRef} />
      </div>

      <AgentStatus status={agentStatus} isStreaming={isStreaming} />

      {/* Input */}
      <div className="px-4 py-3 border-t border-gray-100 bg-white">
        <div className="flex items-end gap-2 bg-gray-50 border border-gray-200 rounded-2xl px-4 py-2.5 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/10 transition-all">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleTextareaChange}
            onKeyDown={handleKey}
            placeholder="Describe what you're looking for…"
            rows={1}
            disabled={isStreaming}
            className="flex-1 resize-none bg-transparent text-sm text-gray-900 placeholder:text-gray-400 outline-none leading-relaxed disabled:opacity-50"
            style={{ minHeight: "24px", maxHeight: "160px" }}
          />
          {isStreaming ? (
            <button
              onClick={onStop}
              className="flex-shrink-0 w-8 h-8 rounded-xl bg-red-500 text-white flex items-center justify-center hover:bg-red-600 transition-colors shadow-sm"
              title="Stop"
            >
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={!input.trim()}
              className="flex-shrink-0 w-8 h-8 rounded-xl bg-primary text-white flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed hover:bg-primary-700 transition-colors shadow-sm"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </button>
          )}
        </div>
        <p className="text-[11px] text-muted/60 text-center mt-2">
          Enter to send · Shift+Enter for new line
        </p>
      </div>
    </div>
  );
}
