"use client";
import { useState } from "react";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { ResultsPanel } from "@/components/results/ResultsPanel";
import { ConversationSidebar } from "@/components/sidebar/ConversationSidebar";
import { useChat } from "@/hooks/useChat";

export function AppShell() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { messages, agentStatus, apartments, isStreaming, sendMessage, resetSession, sessionId } = useChat();

  function handleSelectSession(_sessionId: string) {
    // Session restoration: currently just resets — full restore would require
    // fetching historical messages from the backend (future enhancement).
    resetSession();
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Sidebar history button — always visible */}
      <button
        onClick={() => setSidebarOpen(true)}
        className="fixed top-4 left-4 z-30 w-9 h-9 bg-white border border-gray-200 rounded-xl shadow-sm flex items-center justify-center hover:border-primary hover:text-primary transition-colors"
        aria-label="Search history"
      >
        <svg className="w-4 h-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7" />
        </svg>
      </button>

      {/* Conversation sidebar */}
      <ConversationSidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onSelectSession={handleSelectSession}
        onNewSearch={resetSession}
        currentSessionId={sessionId}
      />

      {/* Main two-column layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left — Chat (38%) */}
        <div className="w-[38%] min-w-[320px] flex flex-col border-r border-gray-100 overflow-hidden">
          <ChatPanel
            messages={messages}
            agentStatus={agentStatus}
            isStreaming={isStreaming}
            onSend={sendMessage}
            onNewSearch={resetSession}
          />
        </div>

        {/* Right — Results (62%) */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <ResultsPanel apartments={apartments} />
        </div>
      </div>
    </div>
  );
}
