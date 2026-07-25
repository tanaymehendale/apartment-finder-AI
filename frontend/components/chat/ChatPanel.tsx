"use client";
import { useRef, useEffect, useState, useCallback, KeyboardEvent } from "react";
import type { ChatMessage, AgentStatusEvent } from "@/lib/types";
import type { RequirementsPayload } from "@/lib/api";
import { MessageBubble } from "./MessageBubble";
import { AgentStatus } from "./AgentStatus";
import { RequirementCards } from "./RequirementCards";
import { MarkIcon, SendIcon, StopIcon, PlusIcon, SearchIcon, BuildingIcon, ClockIcon, ShieldIcon } from "@/lib/icons";
import { US_STATES } from "@/lib/usStates";

type Phase = "landing" | "chatting" | "results";

const SUGGESTIONS = [
  "Apartments in Austin, TX under $1,500, near Tesla Gigafactory",
  "Find me a 2BR in Seattle under $2,000, near Amazon HQ",
  "Rentals in Denver, CO under $1,800, near Denver International Airport",
];

const fieldInputClass =
  "w-full bg-transparent text-sm text-neutral-900 placeholder:text-neutral-400 outline-none";

function Field({ label, className = "", children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={`flex flex-col justify-center gap-0.5 px-4 py-2.5 ${className}`}>
      <label className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">{label}</label>
      {children}
    </div>
  );
}

// Builds the human-readable chat-transcript line for a structured search —
// the backend's F3 path ignores this text entirely when all 4 required
// fields are present (see api/session_manager.py), so it only has to read
// well in the conversation, not be reparsed.
function summarizeSearch(p: RequirementsPayload): string {
  const parts = [`Apartments in ${p.city}, ${p.state}`];
  if (p.min_bedrooms) parts.push(`${p.min_bedrooms}BR`);
  parts.push(`under $${p.budget.toLocaleString()}${p.budget_is_per_person ? "/person" : ""}`);
  parts.push(`near ${p.landmark}`);
  if (p.roommates) parts.push(`${p.roommates} roommate${p.roommates > 1 ? "s" : ""}`);
  return parts.join(", ");
}

interface Props {
  phase: Phase;
  messages: ChatMessage[];
  agentStatus: AgentStatusEvent | null;
  isStreaming: boolean;
  onSend: (text: string, requirements?: RequirementsPayload) => void;
  onStop: () => void;
  onNewSearch: () => void;
}

export function ChatPanel({ phase, messages, agentStatus, isStreaming, onSend, onStop, onNewSearch }: Props) {
  const [input, setInput] = useState("");
  // P2-5: optional-only requirements payload from the RequirementCards panel (landing).
  const [reqPayload, setReqPayload] = useState<Partial<RequirementsPayload>>({});
  // Structured search bar (leads the landing page — see the P4-3 critique
  // pass; free text below remains a fully-supported secondary path).
  const [city, setCity] = useState("");
  const [stateVal, setStateVal] = useState("");
  const [budget, setBudget] = useState("");
  const [landmark, setLandmark] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleReqChange = useCallback((p: Partial<RequirementsPayload>) => setReqPayload(p), []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function handleSubmit() {
    const text = input.trim();
    if (!text || isStreaming) return;
    setInput("");
    // On landing, carry the optional RequirementCards selections; elsewhere they don't apply.
    onSend(text, phase === "landing" ? (reqPayload as RequirementsPayload) : undefined);
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  }

  const budgetNum = Number(budget);
  const canSearch =
    !isStreaming && city.trim() !== "" && stateVal !== "" && budget !== "" && budgetNum > 0 && landmark.trim() !== "";

  function handleStructuredSearch() {
    if (!canSearch) return;
    const payload: RequirementsPayload = {
      city: city.trim(),
      state: stateVal,
      budget: budgetNum,
      landmark: landmark.trim(),
      ...reqPayload,
    };
    onSend(summarizeSearch(payload), payload);
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
      <div className="flex flex-col items-center h-full overflow-y-auto px-6 py-10 bg-background">
        <div className="w-full max-w-3xl flex flex-col items-center gap-7">
          {/* Brand lockup */}
          <div className="flex items-center gap-2 text-neutral-400">
            <MarkIcon className="w-4 h-4" />
            <span className="text-xs font-semibold tracking-wide uppercase">ApartmentFinder AI</span>
          </div>

          {/* Hero */}
          <div className="flex flex-col items-center gap-2 text-center animate-reveal">
            <h1 className="font-display font-bold text-3xl text-neutral-900 tracking-tight">
              Search apartments, backed by real data
            </h1>
            <p className="text-base text-neutral-500 max-w-lg leading-relaxed">
              Real listings, live commute times, and AI-researched neighborhood safety —
              compared and ranked for you in one search.
            </p>
          </div>

          {/* Capability strip — sets expectations before the form; a search
              tool needs to demonstrate it has real inventory/data, not just
              accept a prompt. */}
          <div
            className="w-full flex flex-wrap items-center justify-center gap-x-6 gap-y-1.5 text-xs font-medium text-neutral-500 animate-reveal"
            style={{ animationDelay: "60ms" }}
          >
            <span className="inline-flex items-center gap-1.5">
              <BuildingIcon className="w-3.5 h-3.5 text-primary-600" /> Real listings from Zillow &amp; RentCast
            </span>
            <span className="inline-flex items-center gap-1.5">
              <ClockIcon className="w-3.5 h-3.5 text-primary-600" /> Live commute times
            </span>
            <span className="inline-flex items-center gap-1.5">
              <ShieldIcon className="w-3.5 h-3.5 text-primary-600" /> AI-researched safety
            </span>
          </div>

          {/* Structured search bar — the primary path (F3 structured intake,
              already supported end-to-end by the backend). */}
          <div className="w-full animate-reveal" style={{ animationDelay: "110ms" }}>
            <div className="flex flex-col md:flex-row items-stretch bg-surface border border-neutral-200 rounded-2xl shadow-md overflow-hidden divide-y md:divide-y-0 md:divide-x divide-neutral-100 focus-within:border-primary-400 transition-colors">
              <Field label="City" className="md:flex-[1.3]">
                <input
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder="Austin"
                  aria-label="City"
                  className={fieldInputClass}
                />
              </Field>
              <Field label="State" className="md:flex-[0.85]">
                <select
                  value={stateVal}
                  onChange={(e) => setStateVal(e.target.value)}
                  aria-label="State"
                  className={fieldInputClass}
                >
                  <option value="" disabled>State</option>
                  {US_STATES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </Field>
              <Field label="Budget / mo" className="md:flex-1">
                <div className="flex items-center">
                  <span className="text-neutral-400 text-sm">$</span>
                  <input
                    type="number"
                    min={100}
                    step={50}
                    value={budget}
                    onChange={(e) => setBudget(e.target.value)}
                    placeholder="1,500"
                    aria-label="Monthly budget"
                    className={fieldInputClass}
                  />
                </div>
              </Field>
              <Field label="Near" className="md:flex-[1.3]">
                <input
                  value={landmark}
                  onChange={(e) => setLandmark(e.target.value)}
                  placeholder="Tesla Gigafactory"
                  aria-label="Commute landmark"
                  className={fieldInputClass}
                />
              </Field>
              <div className="p-2 flex items-center">
                <button
                  onClick={handleStructuredSearch}
                  disabled={!canSearch}
                  className="w-full md:w-auto h-full flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-primary-600 text-white text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-primary-700 active:scale-95 transition-all"
                >
                  <SearchIcon className="w-4 h-4" />
                  Search
                </button>
              </div>
            </div>
          </div>

          {/* Optional refinement cards (P2-5) — always visible, not hidden
              behind a click, so first-time visitors can see what's available. */}
          <div className="w-full animate-reveal" style={{ animationDelay: "160ms" }}>
            <RequirementCards onChange={handleReqChange} />
          </div>

          {/* Divider to the secondary, free-text path */}
          <div className="w-full flex items-center gap-3 animate-reveal" style={{ animationDelay: "200ms" }}>
            <div className="flex-1 h-px bg-neutral-200" />
            <span className="text-xs font-medium text-neutral-400 uppercase tracking-wide whitespace-nowrap">
              or describe it in your own words
            </span>
            <div className="flex-1 h-px bg-neutral-200" />
          </div>

          {/* Free-text input — always visible secondary path (not toggle-revealed) */}
          <div className="w-full animate-reveal" style={{ animationDelay: "240ms" }}>
            <div className="flex items-end gap-3 bg-surface border border-neutral-200 rounded-2xl px-4 py-3 shadow-xs focus-within:border-primary-400 focus-within:ring-2 focus-within:ring-primary-100 transition-all">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={handleTextareaChange}
                onKeyDown={handleKey}
                placeholder="e.g. 2BR in Austin under $1,500, near Tesla Gigafactory, 1 roommate…"
                rows={1}
                aria-label="Describe the apartment you're looking for"
                className="flex-1 resize-none bg-transparent text-sm text-neutral-900 placeholder:text-neutral-400 outline-none leading-relaxed"
                style={{ minHeight: "24px", maxHeight: "140px" }}
              />
              <button
                onClick={handleSubmit}
                disabled={!input.trim()}
                aria-label="Send message"
                className="flex-shrink-0 w-9 h-9 rounded-xl bg-neutral-800 text-white flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed hover:bg-neutral-900 active:scale-95 transition-all shadow-xs"
              >
                <SendIcon className="w-4 h-4" />
              </button>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2 mt-3">
              <span className="text-xs text-neutral-400">Try:</span>
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => onSend(s, reqPayload as RequirementsPayload)}
                  className="text-xs text-neutral-500 bg-neutral-50 border border-neutral-100 rounded-full px-3 py-1 hover:border-primary-300 hover:text-primary-700 hover:bg-primary-50 transition-all"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Chatting / results phase ───────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-100 bg-surface">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-primary-600 flex items-center justify-center shadow-xs">
            <MarkIcon className="w-3.5 h-3.5 text-white" />
          </div>
          <span className="text-sm font-semibold text-neutral-900 font-display">ApartmentFinder AI</span>
        </div>
        <button
          onClick={onNewSearch}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-neutral-600 hover:text-primary-700 hover:bg-primary-50 rounded-lg transition-colors"
        >
          <PlusIcon className="w-3.5 h-3.5" />
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
      <div className="px-4 py-3 border-t border-neutral-100 bg-surface">
        <div className="flex items-end gap-2 bg-neutral-50 border border-neutral-200 rounded-2xl px-4 py-2.5 focus-within:border-primary-400 focus-within:ring-2 focus-within:ring-primary-100 transition-all">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleTextareaChange}
            onKeyDown={handleKey}
            placeholder="Describe what you're looking for…"
            rows={1}
            disabled={isStreaming}
            aria-label="Continue the conversation"
            className="flex-1 resize-none bg-transparent text-sm text-neutral-900 placeholder:text-neutral-400 outline-none leading-relaxed disabled:opacity-50"
            style={{ minHeight: "24px", maxHeight: "160px" }}
          />
          {isStreaming ? (
            <button
              onClick={onStop}
              aria-label="Stop generating"
              className="flex-shrink-0 w-8 h-8 rounded-xl bg-danger-600 text-white flex items-center justify-center hover:bg-danger-700 active:scale-95 transition-all shadow-xs"
              title="Stop"
            >
              <StopIcon className="w-3.5 h-3.5" />
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={!input.trim()}
              aria-label="Send message"
              className="flex-shrink-0 w-8 h-8 rounded-xl bg-primary-600 text-white flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed hover:bg-primary-700 active:scale-95 transition-all shadow-xs"
            >
              <SendIcon className="w-4 h-4" />
            </button>
          )}
        </div>
        <p className="text-xs text-neutral-400 text-center mt-2">
          Enter to send · Shift+Enter for new line
        </p>
      </div>
    </div>
  );
}
