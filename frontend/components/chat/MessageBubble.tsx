"use client";
import ReactMarkdown from "react-markdown";
import type { ChatMessage } from "@/lib/types";
import { MarkIcon } from "@/lib/icons";

interface Props {
  message: ChatMessage;
}

export function MessageBubble({ message }: Props) {
  const isUser = message.role === "user";

  if (isUser) {
    return (
      <div className="flex justify-end px-4 py-1 animate-slide-up">
        <div className="max-w-[80%] px-4 py-2.5 bg-primary-600 text-white rounded-2xl rounded-tr-sm text-sm leading-relaxed shadow-xs">
          {message.content}
        </div>
      </div>
    );
  }

  if (!message.content) return null;

  return (
    <div className="flex justify-start px-4 py-1 animate-slide-up">
      <div className="flex gap-2.5 max-w-[90%]">
        <div className="flex-shrink-0 w-7 h-7 rounded-full bg-primary-600 flex items-center justify-center shadow-xs mt-0.5">
          <MarkIcon className="w-3.5 h-3.5 text-white" />
        </div>
        <div className="px-4 py-2.5 bg-surface border border-neutral-100 rounded-2xl rounded-tl-sm text-sm leading-relaxed text-neutral-800 shadow-xs [&_h3]:font-bold [&_h3]:text-sm [&_h3]:mt-2 [&_h3]:mb-1 [&_strong]:font-semibold [&_ul]:list-disc [&_ul]:pl-4 [&_li]:my-0.5 [&_p]:mb-1 [&_p:last-child]:mb-0">
          <ReactMarkdown>{message.content}</ReactMarkdown>
        </div>
      </div>
    </div>
  );
}
