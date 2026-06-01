"use client";
import type { AgentStatusEvent, AgentName } from "@/lib/types";

const PIPELINE: { agent: AgentName; label: string; icon: string }[] = [
  { agent: "Manager",   label: "Requirements", icon: "📋" },
  { agent: "Analyst",   label: "Listings",     icon: "🏠" },
  { agent: "Reviewer",  label: "Safety",        icon: "🛡️" },
  { agent: "Summarizer",label: "Summary",       icon: "✨" },
];

// Maps every possible author name to its pipeline step
const AGENT_TO_STEP: Record<string, AgentName> = {
  Manager:        "Manager",
  manager:        "Manager",
  Analyst:        "Analyst",
  analyst:        "Analyst",
  Reviewer:       "Reviewer",
  reviewer:       "Reviewer",
  Summarizer:     "Summarizer",
  summarizer:     "Summarizer",
  "Research Team": "Analyst",
  ResearchTeam:   "Analyst",
};

interface Props {
  status: AgentStatusEvent | null;
  isStreaming: boolean;
}

export function AgentStatus({ status, isStreaming }: Props) {
  if (!isStreaming && !status) return null;

  const activeAgent: AgentName =
    status ? (AGENT_TO_STEP[status.agent] ?? "Manager") : "Manager";
  const activeIndex = PIPELINE.findIndex((s) => s.agent === activeAgent);
  const stepLabel = status?.step ?? "Starting…";

  return (
    <div className="mx-4 mb-3 p-3 bg-white border border-blue-100 rounded-2xl shadow-sm animate-fade-in">
      {/* Step label */}
      <div className="flex items-center gap-2 mb-2.5">
        <span className="flex gap-0.5">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="inline-block w-1.5 h-1.5 rounded-full bg-primary animate-pulse-dot"
              style={{ animationDelay: `${i * 0.18}s` }}
            />
          ))}
        </span>
        <span className="text-xs font-medium text-primary">{stepLabel}</span>
      </div>

      {/* Pipeline steps */}
      <div className="flex items-center gap-0">
        {PIPELINE.map((step, i) => {
          const isDone = i < activeIndex;
          const isActive = i === activeIndex;
          const isPending = i > activeIndex;

          return (
            <div key={step.agent} className="flex items-center flex-1 min-w-0">
              {/* Step node */}
              <div className="flex flex-col items-center flex-shrink-0">
                <div
                  className={`
                    w-7 h-7 rounded-full flex items-center justify-center text-sm transition-all duration-300
                    ${isDone  ? "bg-green-100 text-green-600 ring-2 ring-green-200" : ""}
                    ${isActive ? "bg-primary text-white ring-2 ring-primary/20 shadow-md scale-110" : ""}
                    ${isPending ? "bg-gray-100 text-gray-400" : ""}
                  `}
                >
                  {isDone ? (
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    <span className="text-[13px] leading-none">{step.icon}</span>
                  )}
                </div>
                <span className={`text-[9px] mt-1 font-medium text-center leading-none ${
                  isActive ? "text-primary" : isDone ? "text-green-600" : "text-gray-400"
                }`}>
                  {step.label}
                </span>
              </div>

              {/* Connector line */}
              {i < PIPELINE.length - 1 && (
                <div className="flex-1 mx-1 mb-3">
                  <div className="h-0.5 w-full rounded-full overflow-hidden bg-gray-100">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        isDone ? "bg-green-400 w-full" : "bg-gray-200 w-0"
                      }`}
                    />
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
