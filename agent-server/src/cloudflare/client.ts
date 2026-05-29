/**
 * Thin REST client over the Cloudflare API.
 *
 * Auth is a scoped account API token (not the global key). Required permissions:
 *   Workers Scripts:Edit, Workers for Platforms:Edit, D1:Edit, R2:Edit,
 *   KV:Edit, Workers Routes:Edit, Custom Hostnames:Edit
 *
 * Token + account id come from agent-server/.env — they never appear in the
 * repo, in prompts, or in logs (CF errors are sanitised before being surfaced).
 */

const CF_API_BASE = "https://api.cloudflare.com/client/v4";

export interface CloudflareConfig {
  accountId: string;
  apiToken: string;
  wfpNamespace: string;
  hostnameZone: string | null;
}

let cached: CloudflareConfig | null = null;

export function getCloudflareConfig(): CloudflareConfig {
  if (cached) return cached;

  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  const wfpNamespace = process.env.CLOUDFLARE_WFP_NAMESPACE;
  const hostnameZone = process.env.CLOUDFLARE_HOSTNAME_ZONE || null;

  if (!accountId || !apiToken || !wfpNamespace) {
    throw new Error(
      "Cloudflare deployment is not configured. Set CLOUDFLARE_ACCOUNT_ID, " +
        "CLOUDFLARE_API_TOKEN, and CLOUDFLARE_WFP_NAMESPACE in agent-server/.env.",
    );
  }

  cached = { accountId, apiToken, wfpNamespace, hostnameZone };
  return cached;
}

export function _resetCloudflareConfigForTests(): void {
  cached = null;
}

interface CloudflareErrorBody {
  errors?: Array<{ code?: number; message?: string }>;
  messages?: unknown[];
  success?: boolean;
}

export class CloudflareApiError extends Error {
  constructor(
    public status: number,
    public path: string,
    public codes: number[],
    message: string,
  ) {
    super(message);
    this.name = "CloudflareApiError";
  }
}

interface RequestInitWithBody {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  headers?: Record<string, string>;
  body?: RequestInit["body"];
  query?: Record<string, string | number | undefined>;
}

function buildUrl(path: string, query?: RequestInitWithBody["query"]): string {
  const base = path.startsWith("http") ? path : `${CF_API_BASE}${path}`;
  if (!query) return base;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined) params.set(k, String(v));
  }
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

/**
 * Low-level fetch. Returns parsed JSON for `application/json` responses and the
 * raw Response for others (used by the assets upload flow). Throws
 * CloudflareApiError on non-2xx, with the body's error codes — never the token.
 */
export async function cfFetch<T = unknown>(
  path: string,
  init: RequestInitWithBody = {},
): Promise<T> {
  const cfg = getCloudflareConfig();
  const url = buildUrl(path, init.query);

  const headers: Record<string, string> = {
    Authorization: `Bearer ${cfg.apiToken}`,
    Accept: "application/json",
    ...init.headers,
  };

  const res = await fetch(url, {
    method: init.method ?? "GET",
    headers,
    body: init.body,
  });

  const ct = res.headers.get("content-type") || "";
  const isJson = ct.includes("application/json");

  if (!res.ok) {
    let codes: number[] = [];
    let message = `Cloudflare API ${res.status} on ${init.method ?? "GET"} ${path}`;
    if (isJson) {
      try {
        const body = (await res.json()) as CloudflareErrorBody;
        if (Array.isArray(body.errors) && body.errors.length > 0) {
          codes = body.errors.map((e) => e.code ?? 0).filter((c) => c > 0);
          message += ": " + body.errors.map((e) => e.message ?? `code ${e.code}`).join("; ");
        }
      } catch {
        // ignore body parse failure
      }
    }
    throw new CloudflareApiError(res.status, path, codes, message);
  }

  if (!isJson) {
    return res as unknown as T;
  }

  const body = (await res.json()) as { result?: T; success?: boolean };
  return (body.result ?? body) as T;
}

export function accountPath(rest: string): string {
  const cfg = getCloudflareConfig();
  return `/accounts/${cfg.accountId}${rest.startsWith("/") ? rest : "/" + rest}`;
}
