"use client";
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { ConversationSidebar } from "@/components/sidebar/ConversationSidebar";
import { useChat } from "@/hooks/useChat";

// Dynamically import ResultsPanel (contains Leaflet which needs no SSR)
const ResultsPanel = dynamic(
  () => import("@/components/results/ResultsPanel").then((m) => m.ResultsPanel),
  { ssr: false }
);

type Phase = "landing" | "chatting" | "results";

export function AppShell() {
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Desktop-primary, but the sidebar shouldn't eat half a phone screen —
  // collapse it by default below the md breakpoint. A useEffect (not a lazy
  // useState initializer) so the server-rendered/hydration-time value stays
  // `true` and this only adjusts after mount, avoiding a hydration mismatch.
  useEffect(() => {
    if (window.innerWidth < 768) setSidebarOpen(false);
  }, []);

  const {
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
    sessionId,
  } = useChat();

  // P4-3: once the pipeline has moved past the Manager (i.e. a real search is
  // running, not just an intake clarifying question), open the results pane
  // immediately with a skeleton state instead of leaving it blank until the
  // first listing arrives.
  const pipelineRunning = isStreaming && !!agentStatus && agentStatus.agent !== "Manager";
  const phase: Phase =
    apartments.length > 0 || pipelineRunning
      ? "results"
      : messages.length > 0
        ? "chatting"
        : "landing";

  function handleSelectSession(selectedSessionId: string) {
    restoreSession(selectedSessionId);
  }

  function handleDeleteSession(deletedSessionId: string) {
    if (sessionId === deletedSessionId) resetSession();
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Persistent sidebar */}
      <ConversationSidebar
        isOpen={sidebarOpen}
        onToggle={() => setSidebarOpen((v) => !v)}
        onSelectSession={handleSelectSession}
        onDeleteSession={handleDeleteSession}
        onNewSearch={resetSession}
        currentSessionId={sessionId}
      />

      {/* Main content area — side-by-side on md+ once results exist; stacked
          (chat on top, results below) on narrow viewports instead of forcing
          a min-width that would push results off-screen. */}
      <div
        className={[
          "flex flex-1 overflow-hidden min-w-0",
          phase === "results" ? "flex-col md:flex-row" : "flex-row",
        ].join(" ")}
      >
        {/* Chat column — full width in landing/chatting, 1/3 (md+) in results */}
        <div
          className={[
            "flex flex-col overflow-hidden transition-all duration-500 ease-in-out",
            phase === "results"
              ? "h-1/2 md:h-auto md:w-1/3 md:min-w-[280px] border-b md:border-b-0 md:border-r border-neutral-100"
              : "w-full",
          ].join(" ")}
        >
          <ChatPanel
            phase={phase}
            messages={messages}
            agentStatus={agentStatus}
            isStreaming={isStreaming}
            onSend={sendMessage}
            onStop={stopStreaming}
            onNewSearch={resetSession}
          />
        </div>

        {/* Map/results column — hidden until results phase, then slides in */}
        <div
          className={[
            "overflow-hidden transition-all duration-500 ease-in-out",
            phase === "results"
              ? "flex-1 opacity-100 translate-x-0"
              : "w-0 h-0 opacity-0 pointer-events-none",
          ].join(" ")}
        >
          {phase === "results" && (
            <ResultsPanel
              apartments={apartments}
              landmark={landmark}
              roommates={roommates}
              isLoading={apartments.length === 0 && pipelineRunning}
            />
          )}
        </div>
      </div>
    </div>
  );
}
