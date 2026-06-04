export interface Apartment {
  id: string;
  agent_description: string;
  monthly_price: number;
  address: string;
  latitude: number;
  longitude: number;
  bedrooms?: number;
  bathrooms?: number;
  square_feet?: number;
  data_warning?: string;
  commute?: CommuteInfo;
  safety_summary?: string;
}

export interface CommuteInfo {
  duration_text: string;
  distance_text: string;
  duration_seconds: number;
}

export type AgentName = "Manager" | "Analyst" | "Reviewer" | "Summarizer" | "Research Team";

export interface AgentStatusEvent {
  agent: AgentName;
  step: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

export interface ConversationSession {
  id: string;
  title: string;
  createdAt: string;
}

export type SSEEvent =
  | { type: "token"; content: string; author: string }
  | { type: "status"; agent: AgentName; step: string }
  | { type: "waiting"; seconds: number; agent: string }
  | { type: "state"; analyst_dossier: string; safety_report: string }
  | { type: "done" }
  | { type: "error"; content: string };
