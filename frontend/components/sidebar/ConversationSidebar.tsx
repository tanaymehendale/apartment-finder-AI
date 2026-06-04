"use client";
import { useEffect, useState } from "react";
import type { ConversationSession } from "@/lib/types";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSelectSession: (sessionId: string) => void;
  onDeleteSession: (sessionId: string) => void;
  onNewSearch: () => void;
  currentSessionId: string | null;
}

export function ConversationSidebar({
  isOpen,
  onClose,
  onSelectSession,
  onDeleteSession,
  onNewSearch,
  currentSessionId,
}: Props) {
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

  function deleteSession(sessionId: string, e: React.MouseEvent) {
    e.stopPropagation();

    // Remove from session index
    const updated = sessions.filter((s) => s.id !== sessionId);
    setSessions(updated);
    localStorage.setItem("apt_sessions", JSON.stringify(updated));

    // Remove the stored messages for this session
    localStorage.removeItem(`apt_messages_${sessionId}`);

    // Notify parent if the active session was deleted
    onDeleteSession(sessionId);
  }

  function clearAll() {
    sessions.forEach((s) => localStorage.removeItem(`apt_messages_${s.id}`));
    localStorage.removeItem("apt_sessions");
    setSessions([]);
    // If any session was active, reset it
    if (currentSessionId) onDeleteSession(currentSessionId);
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
            sessions.map((session) => {
              const isActive = currentSessionId === session.id;
              return (
                <div
                  key={session.id}
                  className={`group flex items-center px-3 py-2.5 hover:bg-gray-50 transition-colors ${
                    isActive ? "bg-primary-50" : ""
                  }`}
                >
                  {/* Select area */}
                  <button
                    onClick={() => { onSelectSession(session.id); onClose(); }}
                    className="flex items-start gap-2 flex-1 min-w-0 text-left"
                  >
                    <div className={`mt-1 w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                      isActive ? "bg-primary" : "bg-gray-300 group-hover:bg-gray-400"
                    }`} />
                    <div className="min-w-0 flex-1">
                      <p className={`text-xs font-medium truncate ${
                        isActive ? "text-primary" : "text-gray-700"
                      }`}>
                        {session.title}
                      </p>
                      <p className="text-[10px] text-gray-400 mt-0.5">
                        {formatDate(session.createdAt)}
                      </p>
                    </div>
                  </button>

                  {/* Delete button — visible on hover */}
                  <button
                    onClick={(e) => deleteSession(session.id, e)}
                    title="Delete this search"
                    className="ml-1 flex-shrink-0 w-6 h-6 rounded-md flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-red-50 hover:text-red-500 text-gray-400 transition-all"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              );
            })
          )}
        </div>

        {/* Footer — clear all */}
        {sessions.length > 0 && (
          <div className="px-3 py-3 border-t border-gray-100">
            <button
              onClick={clearAll}
              className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-xs text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              Clear all history
            </button>
          </div>
        )}
      </div>
    </>
  );
}
