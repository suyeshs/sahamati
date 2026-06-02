import { authHeader } from "./auth-token";

const BASE_URL = import.meta.env.VITE_AGENT_SERVER_URL || "http://localhost:3001";

async function apiFetch<T>(path: string, options?: RequestInit & { email?: string }): Promise<T> {
  const { email, ...fetchOptions } = options || {};
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...authHeader(),
    ...(fetchOptions.headers as Record<string, string> || {}),
  };

  const url = path.includes("?")
    ? `${BASE_URL}${path}${email ? `&email=${encodeURIComponent(email)}` : ""}`
    : `${BASE_URL}${path}${email ? `?email=${encodeURIComponent(email)}` : ""}`;

  const res = await fetch(url, { ...fetchOptions, headers });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((error as any).error || res.statusText);
  }

  return res.json();
}

// --- Users ---

export async function ensureUser(email: string, name: string, picture?: string) {
  return apiFetch<{ user: User }>("/api/users/ensure", {
    method: "POST",
    body: JSON.stringify({ email, name, picture }),
  });
}

export async function getCurrentUser(email: string) {
  return apiFetch<{ user: User }>(`/api/users/me`, { email });
}

export async function listAllUsers(email: string) {
  return apiFetch<{ users: User[] }>("/api/users", { email });
}

// --- Projects ---

export async function listProjects(email: string) {
  return apiFetch<{ projects: ProjectWithDetails[] }>("/api/projects", { email });
}

export async function createProject(email: string, data: { name: string; description?: string; githubRepoUrl?: string }) {
  return apiFetch<{ project: Project }>("/api/projects", {
    method: "POST",
    email,
    body: JSON.stringify(data),
  });
}

export async function getProject(email: string, slug: string) {
  return apiFetch<{ project: ProjectWithDetails; phases: PhaseWithDocs[]; members: ProjectMember[] }>(
    `/api/projects/${slug}`,
    { email }
  );
}

export async function updateProject(email: string, slug: string, data: Partial<Project>) {
  return apiFetch<{ project: Project }>(`/api/projects/${slug}`, {
    method: "PUT",
    email,
    body: JSON.stringify(data),
  });
}

export async function archiveProject(email: string, slug: string) {
  return apiFetch<{ success: boolean }>(`/api/projects/${slug}`, {
    method: "DELETE",
    email,
  });
}

export async function deleteProject(email: string, slug: string) {
  return apiFetch<{ success: boolean }>(`/api/projects/${slug}/permanent`, {
    method: "DELETE",
    email,
    body: JSON.stringify({ confirmSlug: slug }),
  });
}

// --- Phases ---

export async function getPhases(email: string, slug: string) {
  return apiFetch<{ phases: PhaseWithDocs[] }>(`/api/projects/${slug}/phases`, { email });
}

export async function updatePhaseStatus(email: string, slug: string, phaseId: string, status: string) {
  return apiFetch<{ success: boolean }>(`/api/projects/${slug}/phases/${phaseId}`, {
    method: "PUT",
    email,
    body: JSON.stringify({ status }),
  });
}

// --- Members ---

export async function listMembers(email: string, slug: string) {
  return apiFetch<{ members: ProjectMember[] }>(`/api/projects/${slug}/members`, { email });
}

export async function addMember(email: string, slug: string, memberEmail: string, role: string = "member") {
  return apiFetch<{ success: boolean }>(`/api/projects/${slug}/members`, {
    method: "POST",
    email,
    body: JSON.stringify({ email: memberEmail, role }),
  });
}

export async function updateMemberRole(email: string, slug: string, userId: string, role: string) {
  return apiFetch<{ success: boolean }>(`/api/projects/${slug}/members/${userId}`, {
    method: "PUT",
    email,
    body: JSON.stringify({ role }),
  });
}

export async function removeMember(email: string, slug: string, userId: string) {
  return apiFetch<{ success: boolean }>(`/api/projects/${slug}/members/${userId}`, {
    method: "DELETE",
    email,
  });
}

// --- Documents ---

export async function listDocuments(email: string, slug: string, phaseId?: string) {
  const params = phaseId ? `?phaseId=${phaseId}` : "";
  return apiFetch<{ documents: DocumentWithPhase[] }>(`/api/projects/${slug}/documents${params}`, { email });
}

export async function getDocumentContent(email: string, slug: string, docId: string) {
  return apiFetch<{ document: ProjectDocument; content: string }>(
    `/api/projects/${slug}/documents/${docId}`,
    { email }
  );
}

export async function createDocument(
  email: string,
  slug: string,
  data: { title: string; content: string; phaseId?: string; category?: string; filename?: string }
) {
  return apiFetch<{ document: ProjectDocument }>(`/api/projects/${slug}/documents`, {
    method: "POST",
    email,
    body: JSON.stringify(data),
  });
}

export async function deleteDocument(email: string, slug: string, docId: string) {
  return apiFetch<{ success: boolean }>(`/api/projects/${slug}/documents/${docId}`, {
    method: "DELETE",
    email,
  });
}

export async function linkGeneratedDocs(email: string, slug: string, category?: string) {
  return apiFetch<{ linked: number; documents: Array<{ filename: string; category: string; docId: string }> }>(
    `/api/projects/${slug}/documents/link-generated`,
    {
      method: "POST",
      email,
      body: JSON.stringify(category ? { category } : {}),
    }
  );
}

// --- Project-scoped Agent Run (SSE) ---

export function runProjectAgent(
  email: string,
  slug: string,
  prompt: string,
  agentType: string,
  phaseId?: string,
  onMessage?: (msg: any) => void,
  onDone?: () => void,
  onError?: (err: string) => void
): AbortController {
  const controller = new AbortController();

  fetch(`${BASE_URL}/api/projects/${slug}/agent/run?email=${encodeURIComponent(email)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeader(),
    },
    body: JSON.stringify({ prompt, agentType, phaseId }),
    signal: controller.signal,
  })
    .then(async (response) => {
      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: "Agent run failed" }));
        onError?.((err as any).error);
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) return;

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data:")) {
            try {
              const data = JSON.parse(line.slice(5).trim());
              onMessage?.(data);
            } catch {
              // skip unparseable lines
            }
          }
          if (line.startsWith("event: done")) {
            onDone?.();
          }
          if (line.startsWith("event: error")) {
            // next data line has the error
          }
        }
      }

      onDone?.();
    })
    .catch((err) => {
      if (err.name !== "AbortError") {
        onError?.(err.message);
      }
    });

  return controller;
}

// --- Sync ---

export async function triggerSync(email: string) {
  return apiFetch<{ success: boolean; pushed: number; pulled: number }>("/api/sync", {
    method: "POST",
    email,
  });
}

export async function getSyncStatus(email: string) {
  return apiFetch<{ lastSync: string | null; pendingChanges: number; cloudConfigured: boolean }>(
    "/api/sync/status",
    { email }
  );
}

// --- Two-Factor Authentication ---

export async function get2faStatus(email: string) {
  return apiFetch<{ enabled: boolean }>(`/api/2fa/status`, { email });
}

export async function setup2fa(email: string) {
  return apiFetch<{ secret: string; uri: string }>("/api/2fa/setup", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

export async function verify2fa(email: string, code: string) {
  return apiFetch<{ success: boolean; message: string }>("/api/2fa/verify", {
    method: "POST",
    body: JSON.stringify({ email, code }),
  });
}

export async function validate2fa(email: string, code: string) {
  return apiFetch<{ success: boolean }>("/api/2fa/validate", {
    method: "POST",
    body: JSON.stringify({ email, code }),
  });
}

export async function disable2fa(email: string, code: string) {
  return apiFetch<{ success: boolean; message: string }>("/api/2fa/disable", {
    method: "POST",
    body: JSON.stringify({ email, code }),
  });
}

// --- Types ---

export interface User {
  id: string;
  email: string;
  name: string;
  picture: string | null;
  role: string;
  created_at: string;
  updated_at: string;
}

export interface Project {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  status: string;
  created_by: string;
  github_repo_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectWithDetails extends Project {
  member_count: number;
  phase_count: number;
  doc_count: number;
}

export interface PhaseWithDocs {
  id: string;
  project_id: string;
  name: string;
  display_order: number;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  doc_count: number;
}

export interface ProjectMember {
  project_id: string;
  user_id: string;
  role: string;
  added_at: string;
  email?: string;
  name?: string;
  picture?: string;
}

export interface ProjectDocument {
  id: string;
  project_id: string;
  phase_id: string | null;
  title: string;
  filename: string;
  category: string;
  file_path: string;
  generated_by: string | null;
  requires_review: number;
  confidence: number | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface DocumentWithPhase extends ProjectDocument {
  phase_name?: string;
  phase_order?: number;
}
