"use client";
import { useState } from "react";
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
  const {
    messages,
    agentStatus,
    apartments,
    isStreaming,
    landmark,
    sendMessage,
    stopStreaming,
    resetSession,
    restoreSession,
    sessionId,
  } = useChat();

  const phase: Phase =
    apartments.length > 0 ? "results" : messages.length > 0 ? "chatting" : "landing";

  function handleSelectSession(selectedSessionId: string) {
    restoreSession(selectedSessionId);
  }

  function handleDeleteSession(deletedSessionId: string) {
    if (sessionId === deletedSessionId) resetSession();
  }

  return (
    <div className="flex h-screen overflow-hidden bg-[#F8FAFC]">
      {/* Persistent sidebar */}
      <ConversationSidebar
        isOpen={sidebarOpen}
        onToggle={() => setSidebarOpen((v) => !v)}
        onSelectSession={handleSelectSession}
        onDeleteSession={handleDeleteSession}
        onNewSearch={resetSession}
        currentSessionId={sessionId}
      />

      {/* Main content area */}
      <div className="flex flex-1 overflow-hidden min-w-0">
        {/* Chat column — full width in landing/chatting, 1/3 in results */}
        <div
          className={[
            "flex flex-col overflow-hidden transition-all duration-500 ease-in-out",
            phase === "results" ? "w-1/3 min-w-[280px] border-r border-gray-100" : "w-full",
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

        {/* Map/results column — hidden until results phase, then slides in to 2/3 */}
        <div
          className={[
            "overflow-hidden transition-all duration-500 ease-in-out",
            phase === "results"
              ? "flex-1 opacity-100 translate-x-0"
              : "w-0 opacity-0 pointer-events-none",
          ].join(" ")}
        >
          {phase === "results" && (
            <ResultsPanel apartments={apartments} landmark={landmark} />
          )}
        </div>
      </div>
    </div>
  );
}
