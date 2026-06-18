import { open } from "@tauri-apps/plugin-dialog";

const BASE_URL = import.meta.env.VITE_AGENT_SERVER_URL || "http://localhost:3001";

export type DocType = "brd" | "intent" | "architecture" | "security" | "story";

export const DOC_TYPES: { value: DocType; label: string }[] = [
  { value: "brd", label: "Business Requirements (BRD)" },
  { value: "intent", label: "Intent Document" },
  { value: "architecture", label: "Architecture" },
  { value: "security", label: "Security Assessment" },
  { value: "story", label: "User Story" },
];

export interface DraftInfo {
  filename: string;
  relPath: string;
  ageDays: number;
  size: number;
}

/** Open the native folder picker. Returns the chosen absolute path or null. */
export async function pickProjectFolder(): Promise<string | null> {
  const selected = await open({ directory: true, multiple: false, title: "Select project folder" });
  if (typeof selected === "string") return selected;
  return null;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || `Request failed (${res.status})`);
  return data as T;
}

export async function resolveRepo(path: string): Promise<{ repoRoot: string; draftCount: number }> {
  return postJson("/api/local/resolve", { path });
}

export async function initRepo(path: string, force = false): Promise<{ repoRoot: string; created: string[]; skipped: string[] }> {
  return postJson("/api/local/init", { path, force });
}

export async function listDrafts(path: string): Promise<{ repoRoot: string; drafts: DraftInfo[] }> {
  const res = await fetch(`${BASE_URL}/api/local/drafts?path=${encodeURIComponent(path)}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || `Request failed (${res.status})`);
  return data as { repoRoot: string; drafts: DraftInfo[] };
}

export async function publishDraft(
  path: string,
  filename?: string,
  commit = true
): Promise<{ status: string; filename?: string; publishRel?: string; committed?: boolean; sha?: string; candidates?: string[] }> {
  const res = await fetch(`${BASE_URL}/api/local/publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, filename, commit }),
  });
  return res.json();
}

export async function discardDraft(path: string, filename: string): Promise<{ status: string }> {
  return postJson("/api/local/discard", { path, filename });
}

export async function readDraft(path: string, filename: string): Promise<{ filename: string; content: string }> {
  const url = `${BASE_URL}/api/local/draft?path=${encodeURIComponent(path)}&filename=${encodeURIComponent(filename)}`;
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || `Request failed (${res.status})`);
  return data as { filename: string; content: string };
}

export interface GeneratedDraft {
  repoRoot: string;
  filename: string;
  draftRel: string;
  content: string;
}

/**
 * Generate a draft. `claude -p` buffers its output, so this is a single
 * request→response that resolves once the draft is written to docs/.drafts/.
 * Returns an AbortController-like handle plus the result promise.
 */
export function generateDraft(
  path: string,
  type: DocType,
  brief: string
): { promise: Promise<GeneratedDraft>; controller: AbortController } {
  const controller = new AbortController();
  const promise = fetch(`${BASE_URL}/api/local/doc`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, type, brief }),
    signal: controller.signal,
  }).then(async (response) => {
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error((data as { error?: string }).error || "Generation failed");
    }
    return data as GeneratedDraft;
  });
  return { promise, controller };
}
