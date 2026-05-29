// Sahamati KMS client — TypeScript port of clients/python/kms_client.py.
// Used at startup to pull application secrets from the central KMS so they
// never sit in .env or on disk. Same wire contract as the Python client used
// by saans-v2.

export class KMSClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KMSClientError";
  }
}

interface KMSKeySummary {
  key_id: string;
  key_type: string;
  status: string;
  app_name?: string;
  description?: string;
  created_at?: string;
  rotated_at?: string | null;
  expires_at?: string | null;
  kms_key_version?: string;
  created_by?: string;
}

export interface KMSKeyWithSecret {
  key_id: string;
  app_name: string;
  key_type: string;
  secret: string;
  created_at: string;
  expires_at?: string | null;
}

export interface KMSRotateResponse {
  old_key_id: string;
  new_key_id: string;
  new_secret: string;
  grace_period_ends: string;
}

export interface KMSServiceTokenMetadata {
  token_id: string;
  app_name: string;
  description: string;
  created_by: string;
  created_at: string;
  last_used_at: string | null;
  status: string;
}

export interface KMSServiceTokenResponse {
  token_id: string;
  token: string;
  app_name: string;
  description: string;
  created_by: string;
  created_at: string;
}

export interface KMSClientOptions {
  baseUrl: string;
  authToken: string;
  timeoutMs?: number;
}

export class KMSClient {
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;
  private readonly timeoutMs: number;

  constructor(options: KMSClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.headers = {
      Authorization: `Bearer ${options.authToken}`,
      Accept: "application/json",
    };
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  async getSecret(keyId: string): Promise<string> {
    const resp = await this.request(`/api/keys/${encodeURIComponent(keyId)}`);
    if (resp.status === 404) {
      throw new KMSClientError(`Key ${keyId} not found or revoked`);
    }
    if (!resp.ok) {
      throw new KMSClientError(`KMS error ${resp.status}: ${await resp.text()}`);
    }
    const body = (await resp.json()) as { secret?: string };
    if (typeof body.secret !== "string") {
      throw new KMSClientError(`KMS response missing 'secret' field for key ${keyId}`);
    }
    return body.secret;
  }

  async getActiveSecret(appName: string, keyType: string): Promise<string> {
    const params = new URLSearchParams({ app_name: appName });
    const resp = await this.request(`/api/keys/?${params.toString()}`);
    if (!resp.ok) {
      throw new KMSClientError(`KMS list error ${resp.status}: ${await resp.text()}`);
    }
    const keys = (await resp.json()) as KMSKeySummary[];
    const match = keys.find((k) => k.key_type === keyType && k.status === "active");
    if (!match) {
      throw new KMSClientError(`No active ${keyType} key found for app ${appName}`);
    }
    return this.getSecret(match.key_id);
  }

  /** List keys for one app or across all apps. Never returns plaintext. */
  async listKeys(appName?: string): Promise<KMSKeySummary[]> {
    const qs = appName ? `?${new URLSearchParams({ app_name: appName }).toString()}` : "";
    const resp = await this.request(`/api/keys/${qs}`);
    if (!resp.ok) {
      throw new KMSClientError(`KMS list error ${resp.status}: ${await resp.text()}`);
    }
    return (await resp.json()) as KMSKeySummary[];
  }

  /** Generate a brand-new secret. The plaintext is in the response and is the
   * ONLY time KMS will surface it — caller is responsible for showing it once
   * and never persisting it locally. */
  async generateKey(params: {
    appName: string;
    keyType: string;
    description?: string;
    expiresInDays?: number;
  }): Promise<KMSKeyWithSecret> {
    const body: Record<string, unknown> = {
      app_name: params.appName,
      key_type: params.keyType,
      description: params.description ?? "",
    };
    if (params.expiresInDays != null) body.expires_in_days = params.expiresInDays;
    const resp = await this.request(`/api/keys/generate`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      throw new KMSClientError(`KMS generate error ${resp.status}: ${await resp.text()}`);
    }
    return (await resp.json()) as KMSKeyWithSecret;
  }

  /** Rotate an active key — KMS creates a new key and marks the old one as
   * `rotated` with a grace window before it stops being honoured. */
  async rotateKey(keyId: string, gracePeriodDays?: number): Promise<KMSRotateResponse> {
    const body: Record<string, unknown> = {};
    if (gracePeriodDays != null) body.grace_period_days = gracePeriodDays;
    const resp = await this.request(
      `/api/keys/${encodeURIComponent(keyId)}/rotate`,
      { method: "POST", body: JSON.stringify(body) },
    );
    if (resp.status === 404) {
      throw new KMSClientError(`Key ${keyId} not found or not active`);
    }
    if (!resp.ok) {
      throw new KMSClientError(`KMS rotate error ${resp.status}: ${await resp.text()}`);
    }
    return (await resp.json()) as KMSRotateResponse;
  }

  /** List service tokens (metadata only — the raw token is never returned). */
  async listServiceTokens(appName?: string): Promise<KMSServiceTokenMetadata[]> {
    const qs = appName ? `?${new URLSearchParams({ app_name: appName }).toString()}` : "";
    const resp = await this.request(`/api/service-tokens/${qs}`);
    if (!resp.ok) {
      throw new KMSClientError(`KMS list service-tokens error ${resp.status}: ${await resp.text()}`);
    }
    return (await resp.json()) as KMSServiceTokenMetadata[];
  }

  /** Mint a new service token. The plaintext is surfaced ONCE — same caveat
   * as generateKey. */
  async createServiceToken(params: {
    appName: string;
    description?: string;
  }): Promise<KMSServiceTokenResponse> {
    const resp = await this.request(`/api/service-tokens/`, {
      method: "POST",
      body: JSON.stringify({
        app_name: params.appName,
        description: params.description ?? "",
      }),
    });
    if (!resp.ok) {
      throw new KMSClientError(`KMS create service-token error ${resp.status}: ${await resp.text()}`);
    }
    return (await resp.json()) as KMSServiceTokenResponse;
  }

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const headers: Record<string, string> = { ...this.headers };
      // Only send Content-Type when there's a body — KMS rejects bodyless
      // requests with a JSON content-type header on some endpoints.
      if (init.body != null) {
        headers["Content-Type"] = "application/json";
      }
      return await fetch(`${this.baseUrl}${path}`, {
        method: init.method ?? "GET",
        headers,
        body: init.body,
        signal: ctrl.signal,
      });
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        throw new KMSClientError(`KMS request timed out after ${this.timeoutMs}ms: ${path}`);
      }
      throw new KMSClientError(`KMS request failed: ${(err as Error).message}`);
    } finally {
      clearTimeout(timer);
    }
  }
}
