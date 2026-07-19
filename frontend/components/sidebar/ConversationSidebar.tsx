"use client";
import { useEffect, useState, useCallback } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { auth, firebaseEnabled } from "@/lib/firebase";
import type { ConversationSession } from "@/lib/types";

interface Props {
  isOpen: boolean;
  onToggle: () => void;
  onSelectSession: (sessionId: string) => void;
  onDeleteSession: (sessionId: string) => void;
  onNewSearch: () => void;
  currentSessionId: string | null;
}

export function ConversationSidebar({
  isOpen,
  onToggle,
  onSelectSession,
  onDeleteSession,
  onNewSearch,
  currentSessionId,
}: Props) {
  const [sessions, setSessions] = useState<ConversationSession[]>([]);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  useEffect(() => {
    if (!firebaseEnabled || !auth) return;
    return onAuthStateChanged(auth, (u) => setUserEmail(u?.email ?? null));
  }, []);

  const loadSessions = useCallback(() => {
    try {
      setSessions(JSON.parse(localStorage.getItem("apt_sessions") ?? "[]"));
    } catch {
      setSessions([]);
    }
  }, []);

  useEffect(() => {
    loadSessions();
    // Refresh sessions list whenever storage changes (e.g. new session title written by useChat)
    window.addEventListener("storage", loadSessions);
    return () => window.removeEventListener("storage", loadSessions);
  }, [loadSessions]);

  // Poll for title updates from the same tab (storage events don't fire within same tab)
  useEffect(() => {
    const interval = setInterval(loadSessions, 3000);
    return () => clearInterval(interval);
  }, [loadSessions]);

  function formatDate(iso: string) {
    const d = new Date(iso);
    const now = new Date();
    const diffMin = Math.floor((now.getTime() - d.getTime()) / 60000);
    if (diffMin < 1) return "Just now";
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffMin < 1440) return `${Math.floor(diffMin / 60)}h ago`;
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  function deleteSession(sessionId: string, e: React.MouseEvent) {
    e.stopPropagation();
    const updated = sessions.filter((s) => s.id !== sessionId);
    setSessions(updated);
    localStorage.setItem("apt_sessions", JSON.stringify(updated));
    localStorage.removeItem(`apt_messages_${sessionId}`);
    localStorage.removeItem(`apt_apartments_${sessionId}`);
    localStorage.removeItem(`apt_landmark_${sessionId}`);
    onDeleteSession(sessionId);
  }

  function clearAll() {
    sessions.forEach((s) => {
      localStorage.removeItem(`apt_messages_${s.id}`);
      localStorage.removeItem(`apt_apartments_${s.id}`);
      localStorage.removeItem(`apt_landmark_${s.id}`);
    });
    localStorage.removeItem("apt_sessions");
    setSessions([]);
    if (currentSessionId) onDeleteSession(currentSessionId);
  }

  return (
    <div
      className={[
        "flex-shrink-0 flex flex-col h-full bg-gray-900 text-white overflow-hidden",
        "transition-all duration-300 ease-in-out",
        isOpen ? "w-60" : "w-12",
      ].join(" ")}
    >
      {/* Top bar — logo + toggle */}
      <div className={["flex items-center h-14 border-b border-white/10 flex-shrink-0", isOpen ? "px-4 gap-3" : "justify-center px-0"].join(" ")}>
        <button
          onClick={onToggle}
          className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-white/10 transition-colors flex-shrink-0"
          title={isOpen ? "Collapse sidebar" : "Expand sidebar"}
        >
          <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7" />
          </svg>
        </button>
        {isOpen && (
          <span className="text-sm font-semibold text-white truncate">ApartmentFinder AI</span>
        )}
      </div>

      {isOpen && (
        <>
          {/* New search button */}
          <div className="px-3 py-3 flex-shrink-0">
            <button
              onClick={onNewSearch}
              className="w-full flex items-center gap-2 px-3 py-2.5 text-sm font-medium text-white bg-white/10 hover:bg-white/20 rounded-xl transition-colors"
            >
              <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              New search
            </button>
          </div>

          {/* Sessions label */}
          {sessions.length > 0 && (
            <p className="px-4 pb-1 text-[10px] font-semibold text-gray-500 uppercase tracking-widest flex-shrink-0">
              Recent
            </p>
          )}

          {/* Session list */}
          <div className="flex-1 overflow-y-auto">
            {sessions.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <p className="text-xs text-gray-500">No past searches yet</p>
              </div>
            ) : (
              <div className="pb-2">
                {sessions.map((session) => {
                  const isActive = currentSessionId === session.id;
                  return (
                    <div
                      key={session.id}
                      className={[
                        "group flex items-center px-2 py-0.5 mx-2 rounded-lg transition-colors cursor-pointer",
                        isActive ? "bg-white/10" : "hover:bg-white/5",
                      ].join(" ")}
                    >
                      <button
                        onClick={() => onSelectSession(session.id)}
                        className="flex flex-col flex-1 min-w-0 text-left py-2 px-1"
                      >
                        <span className={[
                          "text-xs font-medium truncate block leading-tight",
                          isActive ? "text-white" : "text-gray-300",
                        ].join(" ")}>
                          {session.title}
                        </span>
                        <span className="text-[10px] text-gray-500 mt-0.5">
                          {formatDate(session.createdAt)}
                        </span>
                      </button>
                      <button
                        onClick={(e) => deleteSession(session.id, e)}
                        title="Delete"
                        className="flex-shrink-0 w-6 h-6 rounded flex items-center justify-center opacity-0 group-hover:opacity-100 hover:text-red-400 text-gray-500 transition-all"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Footer */}
          {sessions.length > 0 && (
            <div className="px-3 py-3 border-t border-white/10 flex-shrink-0">
              <button
                onClick={clearAll}
                className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-xs text-gray-500 hover:text-red-400 hover:bg-white/5 rounded-lg transition-colors"
              >
                Clear all history
              </button>
            </div>
          )}

          {/* Account — only rendered once Firebase Auth is actually configured
              (see lib/firebase.ts's no-op-when-unset convention) */}
          {firebaseEnabled && userEmail && (
            <div className="px-3 py-3 border-t border-white/10 flex-shrink-0 flex items-center justify-between gap-2">
              <span className="text-[11px] text-gray-500 truncate" title={userEmail}>
                {userEmail}
              </span>
              <button
                onClick={() => auth && signOut(auth)}
                className="flex-shrink-0 text-xs text-gray-400 hover:text-white transition-colors"
              >
                Sign out
              </button>
            </div>
          )}
        </>
      )}

      {/* Collapsed state — just show new search icon */}
      {!isOpen && (
        <div className="flex flex-col items-center pt-3 gap-2">
          <button
            onClick={onNewSearch}
            className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
            title="New search"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}
