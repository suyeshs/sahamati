/**
 * Gmail REST API operations used by the mail-e MCP server. Read-only by
 * design — the OAuth scope is gmail.readonly and no mutating endpoint is
 * wrapped here.
 *
 * Environment (agent-server/.env):
 *   GMAIL_CLIENT_ID      — Google Cloud OAuth client ID (Desktop app type)
 *   GMAIL_CLIENT_SECRET  — matching client secret
 *   GMAIL_REFRESH_TOKEN  — obtained once via `bun run scripts/gmail-auth.ts`
 *
 * Config is checked lazily so the agent-server can start (and the agent can
 * explain setup steps) when Gmail isn't configured yet.
 */

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

// Headers the triage agent needs to classify a message without reading the body.
const METADATA_HEADERS = ["From", "To", "Cc", "Subject", "Date", "List-Id", "Reply-To"];

const MAX_BODY_CHARS = 20_000;

export function gmailConfigured(): boolean {
  return Boolean(
    process.env.GMAIL_CLIENT_ID &&
    process.env.GMAIL_CLIENT_SECRET &&
    process.env.GMAIL_REFRESH_TOKEN,
  );
}

let _accessToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (_accessToken && Date.now() < _accessToken.expiresAt) return _accessToken.token;

  if (!gmailConfigured()) {
    throw new Error(
      "Gmail is not configured. Set GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, and GMAIL_REFRESH_TOKEN in agent-server/.env (run scripts/gmail-auth.ts to obtain the refresh token).",
    );
  }

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GMAIL_CLIENT_ID!,
      client_secret: process.env.GMAIL_CLIENT_SECRET!,
      refresh_token: process.env.GMAIL_REFRESH_TOKEN!,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gmail token refresh failed (${res.status}): ${body.slice(0, 300)}`);
  }
  const data = (await res.json()) as { access_token: string; expires_in: number };
  _accessToken = {
    token: data.access_token,
    // Refresh a minute early so in-flight calls never race expiry.
    expiresAt: Date.now() + (data.expires_in - 60) * 1000,
  };
  return _accessToken.token;
}

async function api<T>(path: string, params?: Record<string, string | string[]>): Promise<T> {
  const url = new URL(`${API_BASE}${path}`);
  for (const [key, value] of Object.entries(params ?? {})) {
    for (const v of Array.isArray(value) ? value : [value]) url.searchParams.append(key, v);
  }
  const token = await getAccessToken();
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gmail API ${path} failed (${res.status}): ${body.slice(0, 300)}`);
  }
  return res.json() as Promise<T>;
}

// --- Gmail API payload shapes (only the fields we read) ---

interface GmailHeader { name: string; value: string }
interface GmailPart {
  mimeType?: string;
  body?: { data?: string; size?: number };
  parts?: GmailPart[];
}
interface GmailMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: GmailPart & { headers?: GmailHeader[] };
}

function headerMap(headers: GmailHeader[] | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const h of headers ?? []) out[h.name.toLowerCase()] = h.value;
  return out;
}

function decodeBody(data: string): string {
  return Buffer.from(data, "base64url").toString("utf-8");
}

function stripHtml(html: string): string {
  return html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Prefer text/plain anywhere in the MIME tree; fall back to stripped text/html.
function extractBody(part: GmailPart | undefined): string {
  if (!part) return "";
  const findByType = (p: GmailPart, type: string): string | null => {
    if (p.mimeType === type && p.body?.data) return decodeBody(p.body.data);
    for (const child of p.parts ?? []) {
      const found = findByType(child, type);
      if (found) return found;
    }
    return null;
  };
  const plain = findByType(part, "text/plain");
  if (plain) return plain;
  const html = findByType(part, "text/html");
  if (html) return stripHtml(html);
  return "";
}

export interface MessageSummary {
  id: string;
  threadId: string;
  date: string;
  from: string;
  to: string;
  cc: string;
  subject: string;
  listId: string | null;
  labels: string[];
  snippet: string;
}

export async function getProfile(): Promise<{ emailAddress: string; messagesTotal: number }> {
  return api("/profile");
}

/**
 * Search messages with Gmail query grammar (e.g. "in:inbox newer_than:7d",
 * "label:X to:me"). Returns header-level summaries — enough to triage without
 * pulling bodies.
 */
export async function searchMessages(query: string, maxResults = 25): Promise<MessageSummary[]> {
  const capped = Math.min(Math.max(maxResults, 1), 50);
  const list = await api<{ messages?: { id: string }[] }>("/messages", {
    q: query,
    maxResults: String(capped),
  });
  const ids = (list.messages ?? []).map((m) => m.id);

  const summaries = await Promise.all(
    ids.map(async (id) => {
      const msg = await api<GmailMessage>(`/messages/${id}`, {
        format: "metadata",
        metadataHeaders: METADATA_HEADERS,
      });
      const h = headerMap(msg.payload?.headers);
      return {
        id: msg.id,
        threadId: msg.threadId,
        date: h["date"] ?? "",
        from: h["from"] ?? "",
        to: h["to"] ?? "",
        cc: h["cc"] ?? "",
        subject: h["subject"] ?? "(no subject)",
        listId: h["list-id"] ?? null,
        labels: msg.labelIds ?? [],
        snippet: msg.snippet ?? "",
      } satisfies MessageSummary;
    }),
  );
  return summaries;
}

export async function getMessage(id: string): Promise<MessageSummary & { body: string }> {
  const msg = await api<GmailMessage>(`/messages/${id}`, { format: "full" });
  const h = headerMap(msg.payload?.headers);
  let body = extractBody(msg.payload);
  if (body.length > MAX_BODY_CHARS) {
    body = body.slice(0, MAX_BODY_CHARS) + "\n\n[... truncated]";
  }
  return {
    id: msg.id,
    threadId: msg.threadId,
    date: h["date"] ?? "",
    from: h["from"] ?? "",
    to: h["to"] ?? "",
    cc: h["cc"] ?? "",
    subject: h["subject"] ?? "(no subject)",
    listId: h["list-id"] ?? null,
    labels: msg.labelIds ?? [],
    snippet: msg.snippet ?? "",
    body,
  };
}
