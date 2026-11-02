export interface AgentRunRequest {
  prompt: string;
  agentType?: "discovery" | "requirements" | "knowledge" | "process-docs" | "evernote" | "security" | "video" | "orchestrator" | "openclaw";
  openclawAgent?: string;
  sessionId?: string;
  userEmail?: string;
}

// OpenClaw agent types
export interface OpenClawAgentSummary {
  name: string;
  displayName: string;
  description: string;
  llmProvider: string;
  llmModel: string;
  skillCount: number;
  lastModified: string;
}

export interface OpenClawAgentConfig {
  name: string;
  soul: string;
  tools: string;
  identity: string;
  heartbeat?: string;
  llmProvider: string;
  llmModel: string;
  skills: string[];
}

export interface NewOpenClawAgentRequest {
  name: string;
  displayName: string;
  description: string;
  soul: string;
  tools: string;
  identity: string;
  llmProvider: string;
  llmModel: string;
}

export interface UpdateOpenClawAgentRequest {
  soul?: string;
  tools?: string;
  identity?: string;
  heartbeat?: string;
  llmProvider?: string;
  llmModel?: string;
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

// Project-centric types
export interface ProjectCreateRequest {
  name: string;
  description?: string;
  githubRepoUrl?: string;
}

export interface ProjectAgentRunRequest {
  prompt: string;
  agentType?: "discovery" | "requirements" | "knowledge" | "process-docs" | "evernote" | "security" | "video";
  phaseId?: string;
}

export type GlobalRole = "admin" | "tech-lead" | "developer" | "marketing" | "management" | "viewer";
export type ProjectRole = "owner" | "lead" | "member" | "viewer";
export type PhaseStatus = "not-started" | "in-progress" | "completed" | "skipped";
export type ProjectStatus = "active" | "on-hold" | "completed" | "archived";

// --- Deployments (Cloudflare Workers for Platforms) ---

export type DeploymentSourceType = "git" | "tarball";
export type DeploymentBindingType = "d1" | "r2" | "kv";
export type DeploymentStatus =
  | "pending"
  | "building"
  | "uploading"
  | "live"
  | "failed"
  | "torn_down";

export interface Deployment {
  id: string;
  project_id: string;
  created_by: string;
  source_type: DeploymentSourceType;
  source_ref: string;
  script_name: string;
  dispatch_namespace: string;
  custom_hostname: string | null;
  status: DeploymentStatus;
  failure_reason: string | null;
  created_at: string;
  promoted_at: string | null;
  torn_down_at: string | null;
}

export interface DeploymentBinding {
  deployment_id: string;
  binding_name: string;
  binding_type: DeploymentBindingType;
  resource_id: string;
}

export interface DeploymentEvent {
  id: number;
  deployment_id: string;
  ts: string;
  level: "info" | "warn" | "error";
  message: string;
}

export interface DeploymentCreateRequest {
  source:
    | { type: "git"; repoUrl: string; ref?: string }
    | { type: "tarball"; url: string; sha256?: string };
}

// --- Agent registry (validated, versioned; replaces filesystem soul agents) ---

export type AgentKind = "user" | "built_in";
export type AgentStatus = "active" | "archived";
export type AgentModel = "sonnet" | "haiku" | "opus";

export interface Agent {
  id: string;
  name: string;
  display_name: string;
  kind: AgentKind;
  status: AgentStatus;
  current_revision_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface AgentRevision {
  id: string;
  agent_id: string;
  revision: number;
  display_name: string;
  description: string;
  system_prompt: string;
  tools: string; // JSON array of tool names
  model: AgentModel;
  max_turns: number;
  llm_provider: string;
  content_hash: string;
  change_reason: string | null;
  created_by: string | null;
  created_at: string;
}

export interface AgentSummary {
  name: string;
  display_name: string;
  kind: AgentKind;
  status: AgentStatus;
  model: AgentModel;
  revision: number;
  description: string;
  tool_count: number;
  updated_at: string;
}

// Hono context variable types for middleware
/* eslint-disable @typescript-eslint/no-explicit-any */
export interface AppVariables {
  user: any;
  userId: string;
  userEmail: string;
  userRole: string;
  project: any;
  projectId: string;
  memberRole: string | undefined;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export type AppEnv = {
  Variables: AppVariables;
};
