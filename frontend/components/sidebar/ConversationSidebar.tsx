"use client";
import { useEffect, useState } from "react";
import type { ConversationSession } from "@/lib/types";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSelectSession: (sessionId: string) => void;
  onNewSearch: () => void;
  currentSessionId: string | null;
}

export function ConversationSidebar({ isOpen, onClose, onSelectSession, onNewSearch, currentSessionId }: Props) {
  const [sessions, setSessions] = useState<ConversationSession[]>([]);

  useEffect(() => {
    if (isOpen) {
      const stored = JSON.parse(localStorage.getItem("apt_sessions") ?? "[]");
      setSessions(stored);
    }
  }, [isOpen]);

  function formatDate(iso: string) {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return "Just now";
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffMin < 1440) return `${Math.floor(diffMin / 60)}h ago`;
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  return (
    <>
      {/* Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/20 backdrop-blur-sm z-40 lg:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar panel */}
      <div
        className={`
          fixed left-0 top-0 bottom-0 w-72 bg-white border-r border-gray-100 z-50 flex flex-col shadow-xl
          transition-transform duration-300 ease-out
          ${isOpen ? "translate-x-0" : "-translate-x-full"}
        `}
      >
        <div className="flex items-center justify-between px-4 py-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-900">Search history</h2>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg hover:bg-gray-100 flex items-center justify-center transition-colors"
          >
            <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* New search button */}
        <div className="px-3 py-3 border-b border-gray-50">
          <button
            onClick={() => { onNewSearch(); onClose(); }}
            className="w-full flex items-center gap-2 px-3 py-2.5 text-sm font-medium text-white bg-primary hover:bg-primary-700 rounded-xl transition-colors shadow-sm"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            New search
          </button>
        </div>

        {/* Session list */}
        <div className="flex-1 overflow-y-auto py-2">
          {sessions.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <p className="text-xs text-gray-400">No past searches yet</p>
            </div>
          ) : (
            sessions.map((session) => (
              <button
                key={session.id}
                onClick={() => { onSelectSession(session.id); onClose(); }}
                className={`w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors group ${
                  currentSessionId === session.id ? "bg-primary-50" : ""
                }`}
              >
                <div className="flex items-start gap-2">
                  <div className={`mt-0.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                    currentSessionId === session.id ? "bg-primary" : "bg-gray-300 group-hover:bg-gray-400"
                  }`} />
                  <div className="min-w-0 flex-1">
                    <p className={`text-xs font-medium truncate ${
                      currentSessionId === session.id ? "text-primary" : "text-gray-700"
                    }`}>
                      {session.title}
                    </p>
                    <p className="text-[10px] text-gray-400 mt-0.5">
                      {formatDate(session.createdAt)}
                    </p>
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </>
  );
}
