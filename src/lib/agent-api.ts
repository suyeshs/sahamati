import { authHeader, handleAuthFailure } from "./auth-token";

const AGENT_SERVER_URL =
  import.meta.env.VITE_AGENT_SERVER_URL ?? "http://localhost:3001";

// All agent/openclaw/docs routes require a verified session token. This wrapper
// attaches the bearer header to every request; callers pass a server-relative path.
// A 401 tears the session down via handleAuthFailure.
function authedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${AGENT_SERVER_URL}${path}`, {
    ...init,
    headers: { ...(init.headers as Record<string, string> | undefined), ...authHeader() },
  }).then(handleAuthFailure);
}

export type AgentType = "discovery" | "requirements" | "knowledge" | "process-docs" | "evernote" | "security" | "owasp" | "vapt" | "video" | "orchestrator" | "openclaw";

export interface GitHubFileRef {
  owner: string;
  repo: string;
  branch: string;
  path: string;
  type: "file" | "dir";
  name: string;
}

export interface AgentRunOptions {
  prompt: string;
  agentType?: AgentType;
  openclawAgent?: string;
  sessionId?: string;
  userEmail?: string;
  githubFiles?: GitHubFileRef[];
}

export interface AgentEvent {
  id: string;
  event: string;
  data: unknown;
}

export function runAgent(
  options: AgentRunOptions,
  callbacks: {
    onMessage: (data: unknown) => void;
    onDone: () => void;
    onError: (error: string) => void;
  }
): AbortController {
  const controller = new AbortController();

  authedFetch(`/api/agent/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(options),
    signal: controller.signal,
  })
    .then(async (response) => {
      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: "Request failed" }));
        callbacks.onError((err as { error: string }).error ?? "Request failed");
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        callbacks.onError("No response stream");
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Parse SSE events from buffer
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        let currentEvent = "message";
        for (const line of lines) {
          if (line.startsWith("event:")) {
            currentEvent = line.slice(6).trim();
          } else if (line.startsWith("data:")) {
            const dataStr = line.slice(5).trim();
            if (!dataStr) continue;

            try {
              const data = JSON.parse(dataStr);

              if (currentEvent === "done") {
                callbacks.onDone();
                return;
              } else if (currentEvent === "error") {
                callbacks.onError(
                  (data as { error: string }).error ?? "Agent error"
                );
                return;
              } else {
                callbacks.onMessage(data);
              }
            } catch {
              // Skip non-JSON lines
            }
          }
        }
      }

      callbacks.onDone();
    })
    .catch((err) => {
      if (err instanceof DOMException && err.name === "AbortError") return;
      callbacks.onError(String(err));
    });

  return controller;
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

export async function listGeneratedDocs(): Promise<GeneratedDoc[]> {
  const res = await authedFetch(`/api/docs/generated`);
  const data = (await res.json()) as { docs: GeneratedDoc[] };
  return data.docs;
}

export async function getGeneratedDoc(
  category: string,
  filename: string
): Promise<{ content: string; path: string }> {
  const res = await authedFetch(
    `/api/docs/generated/${category}/${filename}`
  );
  return res.json();
}

export async function checkHealth(): Promise<{ status: string; agents: string[] }> {
  const res = await fetch(`${AGENT_SERVER_URL}/health`);
  return res.json();
}

// ---- OpenClaw Agent API ----

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

export async function listOpenClawAgents(): Promise<OpenClawAgentSummary[]> {
  const res = await authedFetch(`/api/openclaw/agents`);
  const data = (await res.json()) as { agents: OpenClawAgentSummary[] };
  return data.agents;
}

export async function getOpenClawAgent(name: string): Promise<OpenClawAgentConfig> {
  const res = await authedFetch(`/api/openclaw/agents/${encodeURIComponent(name)}`);
  if (!res.ok) throw new Error("Agent not found");
  const data = (await res.json()) as { agent: OpenClawAgentConfig };
  return data.agent;
}

export async function createOpenClawAgent(req: NewOpenClawAgentRequest): Promise<OpenClawAgentConfig> {
  const res = await authedFetch(`/api/openclaw/agents`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    const err = (await res.json()) as { error: string };
    throw new Error(err.error);
  }
  const data = (await res.json()) as { agent: OpenClawAgentConfig };
  return data.agent;
}

export async function updateOpenClawAgent(
  name: string,
  updates: Partial<Pick<OpenClawAgentConfig, "soul" | "tools" | "identity" | "heartbeat" | "llmProvider" | "llmModel">>
): Promise<OpenClawAgentConfig> {
  const res = await authedFetch(`/api/openclaw/agents/${encodeURIComponent(name)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new Error("Failed to update agent");
  const data = (await res.json()) as { agent: OpenClawAgentConfig };
  return data.agent;
}

export async function deleteOpenClawAgent(name: string): Promise<void> {
  const res = await authedFetch(`/api/openclaw/agents/${encodeURIComponent(name)}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Failed to delete agent");
}

// ---- OpenClaw Skills API ----

export interface SkillInfo {
  filename: string;
  name: string;
  description: string;
}

export interface ClawHubSkill {
  id: string;
  name: string;
  description: string;
  author: string;
  downloads: number;
  tags: string[];
}

export async function listAgentSkills(agentName: string): Promise<SkillInfo[]> {
  const res = await authedFetch(`/api/openclaw/agents/${encodeURIComponent(agentName)}/skills`);
  const data = (await res.json()) as { skills: SkillInfo[] };
  return data.skills;
}

export async function installSkillFromClawHub(agentName: string, clawHubId: string): Promise<void> {
  const res = await authedFetch(`/api/openclaw/agents/${encodeURIComponent(agentName)}/skills`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clawHubId }),
  });
  if (!res.ok) throw new Error("Failed to install skill");
}

export async function installCustomSkill(agentName: string, filename: string, content: string): Promise<void> {
  const res = await authedFetch(`/api/openclaw/agents/${encodeURIComponent(agentName)}/skills`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename, content }),
  });
  if (!res.ok) throw new Error("Failed to install skill");
}

export async function getSkillContent(agentName: string, filename: string): Promise<string> {
  const res = await authedFetch(
    `/api/openclaw/agents/${encodeURIComponent(agentName)}/skills/${encodeURIComponent(filename)}`
  );
  if (!res.ok) throw new Error("Failed to load skill content");
  const data = (await res.json()) as { content: string };
  return data.content;
}

export async function updateSkillContent(agentName: string, filename: string, content: string): Promise<void> {
  const res = await authedFetch(
    `/api/openclaw/agents/${encodeURIComponent(agentName)}/skills/${encodeURIComponent(filename)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    }
  );
  if (!res.ok) throw new Error("Failed to update skill");
}

export async function removeAgentSkill(agentName: string, filename: string): Promise<void> {
  const res = await authedFetch(
    `/api/openclaw/agents/${encodeURIComponent(agentName)}/skills/${encodeURIComponent(filename)}`,
    { method: "DELETE" }
  );
  if (!res.ok) throw new Error("Failed to remove skill");
}

export async function searchClawHubSkills(query: string): Promise<ClawHubSkill[]> {
  const res = await authedFetch(`/api/openclaw/skills/search?q=${encodeURIComponent(query)}`);
  const data = (await res.json()) as { skills: ClawHubSkill[] };
  return data.skills;
}
