export interface AgentRunRequest {
  prompt: string;
  agentType?: "discovery" | "requirements" | "knowledge" | "process-docs" | "orchestrator";
  sessionId?: string;
  userEmail?: string;
}

export interface AgentMessage {
  type: string;
  subtype?: string;
  content?: string;
  result?: string;
  session_id?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface GeneratedDoc {
  filename: string;
  category: string;
  path: string;
  title?: string;
  generatedBy?: string;
  date?: string;
  requiresReview?: boolean;
  confidence?: number;
}
