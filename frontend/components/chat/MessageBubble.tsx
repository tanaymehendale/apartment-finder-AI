"use client";
import type { ChatMessage } from "@/lib/types";

interface Props {
  message: ChatMessage;
}

export function MessageBubble({ message }: Props) {
  const isUser = message.role === "user";

  if (isUser) {
    return (
      <div className="flex justify-end px-4 py-1 animate-slide-up">
        <div className="max-w-[80%] px-4 py-2.5 bg-primary text-white rounded-2xl rounded-tr-sm text-sm leading-relaxed shadow-sm">
          {message.content}
        </div>
      </div>
    );
  }

  if (!message.content) return null;

  return (
    <div className="flex justify-start px-4 py-1 animate-slide-up">
      <div className="flex gap-2.5 max-w-[90%]">
        <div className="flex-shrink-0 w-7 h-7 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center shadow-sm mt-0.5">
          <svg className="w-3.5 h-3.5 text-white" fill="currentColor" viewBox="0 0 20 20">
            <path d="M10 2a8 8 0 100 16A8 8 0 0010 2zm0 14a6 6 0 110-12 6 6 0 010 12z" />
            <path d="M10 6a1 1 0 011 1v3.586l2.707 2.707a1 1 0 01-1.414 1.414l-3-3A1 1 0 019 11V7a1 1 0 011-1z" />
          </svg>
        </div>
        <div className="px-4 py-2.5 bg-white border border-gray-100 rounded-2xl rounded-tl-sm text-sm leading-relaxed text-gray-800 shadow-sm whitespace-pre-wrap">
          {message.content}
        </div>
      </div>
    </div>
  );
}
