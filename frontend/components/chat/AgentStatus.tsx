"use client";
import { useEffect, useState } from "react";
import type { AgentStatusEvent } from "@/lib/types";

const PIPELINE = ["Manager", "Analyst", "Reviewer", "Summarizer"] as const;

const PHRASES: Record<string, string[]> = {
  Manager: [
    "Reviewing your requirements…",
    "Parsing your request…",
    "Checking what you need…",
    "Getting your details ready…",
  ],
  "Research Team": [
    "Kicking off the research pipeline…",
    "Coordinating the team…",
    "Spinning up agents…",
  ],
  Analyst: [
    "Scanning rental listings…",
    "Fetching apartments in your area…",
    "Calculating commute times…",
    "Comparing prices to your budget…",
    "Running Distance Matrix API…",
    "Narrowing down the best options…",
    "Checking availability…",
    "Crunching the numbers…",
  ],
  Reviewer: [
    "Researching neighborhood safety…",
    "Checking local reviews…",
    "Looking up area reputation…",
    "Digging into community feedback…",
    "Searching for resident experiences…",
    "Assessing quality of life…",
    "Reading between the lines…",
  ],
  Summarizer: [
    "Weighing price vs. commute vs. safety…",
    "Drafting your recommendation…",
    "Ranking your top picks…",
    "Putting the final report together…",
    "Highlighting the best value…",
    "Almost done…",
  ],
  waiting: [
    "Rate limited — waiting for reset…",
    "API quota reached, retrying soon…",
    "Pausing for rate limit window…",
    "Will retry automatically…",
  ],
};

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function getActiveIndex(agent: string): number {
  if (agent === "Research Team") return 1; // maps to Analyst
  const idx = PIPELINE.indexOf(agent as typeof PIPELINE[number]);
  return idx === -1 ? 0 : idx;
}

interface Props {
  status: AgentStatusEvent | null;
  isStreaming: boolean;
}

export function AgentStatus({ status, isStreaming }: Props) {
  const [spinnerIdx, setSpinnerIdx] = useState(0);
  const [phraseIdx, setPhraseIdx] = useState(0);
  const [visible, setVisible] = useState(true);

  const agent = status?.agent ?? "Manager";
  const isWaiting = status?.step === "waiting";
  const phraseKey = isWaiting ? "waiting" : agent;
  const phrases = PHRASES[phraseKey] ?? PHRASES.Manager;
  const activeIdx = getActiveIndex(agent);

  // Reset phrase when agent or waiting state changes
  useEffect(() => {
    setPhraseIdx(0);
    setVisible(true);
  }, [agent, isWaiting]);

  // Spinner — 80 ms per frame
  useEffect(() => {
    if (!isStreaming) return;
    const id = setInterval(
      () => setSpinnerIdx((i) => (i + 1) % SPINNER_FRAMES.length),
      80,
    );
    return () => clearInterval(id);
  }, [isStreaming]);

  // Phrase cycling with fade-out → swap → fade-in
  useEffect(() => {
    if (!isStreaming) return;
    const id = setInterval(() => {
      setVisible(false);
      setTimeout(() => {
        setPhraseIdx((i) => (i + 1) % phrases.length);
        setVisible(true);
      }, 250);
    }, 2800);
    return () => clearInterval(id);
  }, [isStreaming, phrases.length]);

  if (!isStreaming && !status) return null;

  return (
    <div className="mx-4 mb-3 px-1 space-y-1.5 select-none">
      {PIPELINE.map((name, i) => {
        // Only render completed and active stages — hide upcoming ones
        if (i > activeIdx) return null;

        const isDone = i < activeIdx;
        const isActive = i === activeIdx;

        return (
          <div key={name}>
            <div className="flex items-center gap-2">
              <span
                className={`w-4 font-mono text-xs leading-none ${
                  isDone ? "text-green-500" : "text-primary"
                }`}
                aria-hidden
              >
                {isDone ? "✓" : SPINNER_FRAMES[spinnerIdx]}
              </span>
              <span
                className={`text-xs ${
                  isDone
                    ? "text-gray-400"
                    : "text-gray-700 font-medium"
                }`}
              >
                {name}
              </span>
            </div>

            {isActive && (
              <div className="ml-6 mt-0.5">
                <span
                  className="text-xs text-muted transition-opacity duration-[250ms]"
                  style={{ opacity: visible ? 1 : 0 }}
                >
                  {phrases[phraseIdx]}
                </span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
