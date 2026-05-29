// KMS Secrets — admin CRUD for sahamati-kms keys and service tokens.
//
// Authorization is enforced on the agent-server (admin role required). The
// page renders an explanatory empty state for non-admins rather than hiding
// silently. Plaintext values returned by KMS are shown once with a copy
// button and never refetched.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useBlocker } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import {
  KNOWN_APP_NAMES,
  KNOWN_KEY_TYPES,
  createServiceToken,
  generateSecret,
  listSecrets,
  listServiceTokens,
  rotateSecret,
  runSecretAssistant,
  type KMSKeyMetadata,
  type KMSServiceTokenMetadata,
} from "../lib/secrets-api";

type Tab = "keys" | "tokens" | "assistant";

interface JustRevealed {
  kind: "key" | "token";
  label: string; // e.g. "saans-v2 / aa_portal_jwt_secret"
  id: string;
  value: string;
}

function isAdmin(user: { role?: string } | null | undefined): boolean {
  return Boolean(user && (user as { role?: string }).role === "admin");
}

function fmtTs(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export default function Secrets() {
  const { user } = useAuth();
  const admin = isAdmin(user as { role?: string } | null);
  const email = user?.email ?? "";

  const [tab, setTab] = useState<Tab>("keys");
  const [appName, setAppName] = useState<string>(KNOWN_APP_NAMES[0]);
  const [keys, setKeys] = useState<KMSKeyMetadata[]>([]);
  const [tokens, setTokens] = useState<KMSServiceTokenMetadata[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<JustRevealed | null>(null);
  // Set true when the user copies the value OR explicitly dismisses the panel
  // after acknowledging. Used to gate navigation away from the page.
  const [revealedAcknowledged, setRevealedAcknowledged] = useState(false);

  const hasUnsavedSecret = revealed !== null && !revealedAcknowledged;

  // Block window/tab close (or reload) while a fresh secret is on screen.
  // The actual prompt text is browser-controlled — we only get to set the flag.
  useEffect(() => {
    if (!hasUnsavedSecret) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Legacy: some browsers still require a returnValue to trigger the prompt.
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [hasUnsavedSecret]);

  // Block in-app navigation (clicking a sidebar link, browser back, etc.).
  // react-router v7 useBlocker returns a Blocker; we surface a confirm() and
  // either proceed or reset the blocker so the user can stay.
  const blocker = useBlocker(hasUnsavedSecret);
  useEffect(() => {
    if (blocker.state !== "blocked") return;
    const proceed = window.confirm(
      "You just generated a secret that hasn't been copied. Leaving this page means it can never be retrieved again. Leave anyway?",
    );
    if (proceed) {
      setRevealedAcknowledged(true);
      blocker.proceed();
    } else {
      blocker.reset();
    }
  }, [blocker]);

  // Generate form
  const [genKeyType, setGenKeyType] = useState<string>(KNOWN_KEY_TYPES[0]);
  const [genDescription, setGenDescription] = useState("");
  const [genExpiresDays, setGenExpiresDays] = useState<string>("");
  const [generating, setGenerating] = useState(false);

  // Mint service-token form
  const [tokenDescription, setTokenDescription] = useState("");
  const [minting, setMinting] = useState(false);

  const reload = useCallback(async () => {
    if (!email || !admin) return;
    setLoading(true);
    setError(null);
    try {
      if (tab === "keys") {
        const data = await listSecrets(email, appName);
        setKeys(data.keys);
      } else {
        const data = await listServiceTokens(email, appName);
        setTokens(data.tokens);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [email, admin, tab, appName]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    setGenerating(true);
    setError(null);
    try {
      const expires = genExpiresDays.trim() ? Number(genExpiresDays.trim()) : undefined;
      const result = await generateSecret(email, {
        app_name: appName,
        key_type: genKeyType,
        description: genDescription || undefined,
        expires_in_days: expires,
      });
      setRevealed({
        kind: "key",
        label: `${result.app_name} / ${result.key_type}`,
        id: result.key_id,
        value: result.secret,
      });
      setRevealedAcknowledged(false);
      setGenDescription("");
      setGenExpiresDays("");
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setGenerating(false);
    }
  };

  const handleRotate = async (keyId: string, label: string) => {
    if (!email) return;
    if (!confirm(`Rotate ${label}? A new secret is generated; the old one enters a grace period.`)) return;
    setError(null);
    try {
      const result = await rotateSecret(email, keyId);
      setRevealed({
        kind: "key",
        label: `${label} (rotated)`,
        id: result.new_key_id,
        value: result.new_secret,
      });
      setRevealedAcknowledged(false);
      await reload();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleMintToken = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    setMinting(true);
    setError(null);
    try {
      const result = await createServiceToken(email, {
        app_name: appName,
        description: tokenDescription || undefined,
      });
      setRevealed({
        kind: "token",
        label: `${result.app_name} service token`,
        id: result.token_id,
        value: result.token,
      });
      setRevealedAcknowledged(false);
      setTokenDescription("");
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setMinting(false);
    }
  };

  const visibleKeys = useMemo(() => keys, [keys]);

  if (!email) {
    return (
      <div className="page-container">
        <h1>KMS Secrets</h1>
        <p>Please sign in to manage secrets.</p>
      </div>
    );
  }

  if (!admin) {
    return (
      <div className="page-container">
        <h1>KMS Secrets</h1>
        <p style={{ color: "var(--text-muted, #888)" }}>
          KMS secret management is restricted to organization admins. Ask a Sahamati admin to
          generate or rotate the secret you need.
        </p>
      </div>
    );
  }

  return (
    <div className="page-container">
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 16 }}>
        <div>
          <h1>KMS Secrets</h1>
          <p style={{ color: "var(--text-muted, #888)", margin: 0 }}>
            Proxied to sahamati-kms. Plaintext values are shown ONCE — copy them out
            before navigating away.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <label htmlFor="app_name" style={{ fontSize: 12 }}>App</label>
          <select
            id="app_name"
            value={appName}
            onChange={(e) => setAppName(e.target.value)}
          >
            {KNOWN_APP_NAMES.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </div>
      </header>

      <div role="tablist" style={{ display: "flex", gap: 8, marginBottom: 16, borderBottom: "1px solid #ddd" }}>
        <button
          role="tab"
          aria-selected={tab === "keys"}
          onClick={() => setTab("keys")}
          style={{ padding: "8px 12px", border: "none", background: "transparent", borderBottom: tab === "keys" ? "2px solid var(--accent, #4f46e5)" : "2px solid transparent", cursor: "pointer" }}
        >Keys</button>
        <button
          role="tab"
          aria-selected={tab === "tokens"}
          onClick={() => setTab("tokens")}
          style={{ padding: "8px 12px", border: "none", background: "transparent", borderBottom: tab === "tokens" ? "2px solid var(--accent, #4f46e5)" : "2px solid transparent", cursor: "pointer" }}
        >Service tokens</button>
        <button
          role="tab"
          aria-selected={tab === "assistant"}
          onClick={() => setTab("assistant")}
          style={{ padding: "8px 12px", border: "none", background: "transparent", borderBottom: tab === "assistant" ? "2px solid var(--accent, #4f46e5)" : "2px solid transparent", cursor: "pointer" }}
        >Assistant</button>
      </div>

      {error && (
        <div role="alert" style={{ background: "#fee2e2", color: "#991b1b", padding: 12, borderRadius: 6, marginBottom: 12 }}>
          {error}
        </div>
      )}

      {revealed && (
        <RevealPanel
          revealed={revealed}
          acknowledged={revealedAcknowledged}
          onAcknowledge={() => setRevealedAcknowledged(true)}
          onDismiss={() => {
            setRevealed(null);
            setRevealedAcknowledged(false);
          }}
        />
      )}

      {tab === "assistant" ? (
        <AssistantPanel email={email} />
      ) : tab === "keys" ? (
        <>
          <form onSubmit={handleGenerate} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr auto", gap: 8, marginBottom: 16, padding: 12, background: "#f9fafb", borderRadius: 6 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <label style={{ fontSize: 12 }}>Key type</label>
              <select value={genKeyType} onChange={(e) => setGenKeyType(e.target.value)}>
                {KNOWN_KEY_TYPES.map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <label style={{ fontSize: 12 }}>Description</label>
              <input value={genDescription} onChange={(e) => setGenDescription(e.target.value)} placeholder="e.g. AA portal signing key" />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <label style={{ fontSize: 12 }}>Expires (days, optional)</label>
              <input
                value={genExpiresDays}
                onChange={(e) => setGenExpiresDays(e.target.value)}
                placeholder="leave blank for default"
                inputMode="numeric"
              />
            </div>
            <div style={{ display: "flex", alignItems: "flex-end" }}>
              <button type="submit" disabled={generating}>
                {generating ? "Generating…" : "Generate"}
              </button>
            </div>
          </form>

          <KeysTable
            keys={visibleKeys}
            loading={loading}
            onRotate={(k) => handleRotate(k.key_id, `${k.app_name} / ${k.key_type}`)}
          />
        </>
      ) : (
        <>
          <form onSubmit={handleMintToken} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, marginBottom: 16, padding: 12, background: "#f9fafb", borderRadius: 6 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <label style={{ fontSize: 12 }}>Description</label>
              <input
                value={tokenDescription}
                onChange={(e) => setTokenDescription(e.target.value)}
                placeholder="e.g. saans-v2 bootstrap token"
              />
            </div>
            <div style={{ display: "flex", alignItems: "flex-end" }}>
              <button type="submit" disabled={minting}>
                {minting ? "Minting…" : "Mint service token"}
              </button>
            </div>
          </form>

          <TokensTable tokens={tokens} loading={loading} />
        </>
      )}
    </div>
  );
}

function RevealPanel({
  revealed,
  acknowledged,
  onAcknowledge,
  onDismiss,
}: {
  revealed: JustRevealed;
  acknowledged: boolean;
  onAcknowledge: () => void;
  onDismiss: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(revealed.value);
      setCopied(true);
      onAcknowledge();
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // no-op — older browsers
    }
  };
  const handleDismiss = () => {
    if (!acknowledged) {
      const ok = window.confirm(
        "You haven't copied this value yet. Once dismissed, it can never be retrieved again. Dismiss?",
      );
      if (!ok) return;
    }
    onDismiss();
  };
  return (
    <div style={{ border: "1px solid #fbbf24", background: "#fffbeb", padding: 12, borderRadius: 6, marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <strong>One-time reveal: {revealed.label}</strong>
        <button onClick={handleDismiss} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18 }}>×</button>
      </div>
      <p style={{ fontSize: 12, color: "#92400e", margin: "0 0 8px" }}>
        This is the only time the plaintext is shown. Copy it to {revealed.kind === "key" ? "your application's secret store" : "the consuming service's environment"} now.
        ID: <code>{revealed.id}</code>
      </p>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <code style={{ flex: 1, padding: 8, background: "#fff", border: "1px solid #fde68a", borderRadius: 4, overflowX: "auto", fontFamily: "monospace", fontSize: 13 }}>
          {revealed.value}
        </code>
        <button onClick={handleCopy}>{copied ? "Copied!" : "Copy"}</button>
      </div>
      {!acknowledged && (
        <p style={{ fontSize: 11, color: "#92400e", marginTop: 8, marginBottom: 0 }}>
          Closing this tab or navigating away while this banner is visible will prompt for confirmation.
        </p>
      )}
    </div>
  );
}

function KeysTable({
  keys,
  loading,
  onRotate,
}: {
  keys: KMSKeyMetadata[];
  loading: boolean;
  onRotate: (k: KMSKeyMetadata) => void;
}) {
  if (loading) return <p>Loading…</p>;
  if (keys.length === 0) return <p style={{ color: "#888" }}>No keys for this app yet.</p>;
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
      <thead>
        <tr style={{ textAlign: "left", borderBottom: "1px solid #e5e7eb" }}>
          <th style={{ padding: "8px 4px" }}>Key type</th>
          <th style={{ padding: "8px 4px" }}>Status</th>
          <th style={{ padding: "8px 4px" }}>Description</th>
          <th style={{ padding: "8px 4px" }}>Created</th>
          <th style={{ padding: "8px 4px" }}>Expires</th>
          <th style={{ padding: "8px 4px" }}>Key ID</th>
          <th style={{ padding: "8px 4px", textAlign: "right" }}></th>
        </tr>
      </thead>
      <tbody>
        {keys.map((k) => (
          <tr key={k.key_id} style={{ borderBottom: "1px solid #f3f4f6" }}>
            <td style={{ padding: "8px 4px" }}>{k.key_type}</td>
            <td style={{ padding: "8px 4px" }}>
              <span style={{ padding: "2px 6px", borderRadius: 3, fontSize: 12, background: k.status === "active" ? "#d1fae5" : "#fef3c7", color: k.status === "active" ? "#065f46" : "#92400e" }}>
                {k.status}
              </span>
            </td>
            <td style={{ padding: "8px 4px" }}>{k.description || "—"}</td>
            <td style={{ padding: "8px 4px", fontSize: 12, color: "#6b7280" }}>{fmtTs(k.created_at)}</td>
            <td style={{ padding: "8px 4px", fontSize: 12, color: "#6b7280" }}>{fmtTs(k.expires_at)}</td>
            <td style={{ padding: "8px 4px", fontFamily: "monospace", fontSize: 12 }}>{k.key_id}</td>
            <td style={{ padding: "8px 4px", textAlign: "right" }}>
              {k.status === "active" ? (
                <button onClick={() => onRotate(k)}>Rotate</button>
              ) : (
                <span style={{ color: "#9ca3af", fontSize: 12 }}>—</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Render the live SSE stream from `runSecretAssistant`. Each SDK message is
 * collapsed into a single readable row — assistant text, tool calls (Bash
 * commands shown verbatim), tool results (output trimmed), system messages
 * mostly hidden. Unknown shapes are dumped as JSON so we don't lose info. */
function AssistantPanel({ email }: { email: string }) {
  const [prompt, setPrompt] = useState("");
  const [log, setLog] = useState<AssistantLogItem[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  const runDisabled = !email || running || prompt.trim().length === 0;

  const handleRun = (e: React.FormEvent) => {
    e.preventDefault();
    if (runDisabled) return;
    setError(null);
    setLog([]);
    setRunning(true);
    const trimmed = prompt.trim();
    controllerRef.current = runSecretAssistant(email, trimmed, {
      onMessage: (msg) => {
        const item = collapseAgentMessage(msg);
        if (item) setLog((prev) => [...prev, item]);
      },
      onDone: () => {
        setRunning(false);
        controllerRef.current = null;
      },
      onError: (err) => {
        setError(err);
        setRunning(false);
        controllerRef.current = null;
      },
    });
  };

  const handleCancel = () => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setRunning(false);
  };

  return (
    <div>
      <div style={{ background: "#f3f4f6", border: "1px solid #e5e7eb", borderRadius: 6, padding: 12, marginBottom: 12, fontSize: 13, color: "#374151" }}>
        Describe what you need. The orchestrator will call the same KMS endpoints as
        the form tabs above; plaintext values still appear in the reveal panel and
        are never echoed in the chat transcript.
      </div>
      <form onSubmit={handleRun} style={{ display: "grid", gridTemplateColumns: "1fr", gap: 8, marginBottom: 12 }}>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder='e.g. "Generate a fresh jwt_secret for saans-v2 — there should already be one active, so rotate it instead."'
          rows={3}
          style={{ width: "100%", padding: 8, fontFamily: "inherit", fontSize: 14, borderRadius: 4, border: "1px solid #d1d5db" }}
          disabled={running}
        />
        <div style={{ display: "flex", gap: 8 }}>
          <button type="submit" disabled={runDisabled}>
            {running ? "Running…" : "Run assistant"}
          </button>
          {running && (
            <button type="button" onClick={handleCancel}>
              Cancel
            </button>
          )}
        </div>
      </form>

      {error && (
        <div role="alert" style={{ background: "#fee2e2", color: "#991b1b", padding: 10, borderRadius: 6, marginBottom: 12, fontSize: 13 }}>
          {error}
        </div>
      )}

      <div style={{ border: "1px solid #e5e7eb", borderRadius: 6, padding: 8, maxHeight: 480, overflowY: "auto", background: "#fafafa" }}>
        {log.length === 0 ? (
          <p style={{ color: "#9ca3af", fontSize: 13, margin: "8px 4px" }}>
            {running ? "Waiting for the first message…" : "No output yet."}
          </p>
        ) : (
          log.map((item, i) => <AgentLogRow key={i} item={item} />)
        )}
      </div>
    </div>
  );
}

interface AssistantLogItem {
  kind: "text" | "tool_use" | "tool_result" | "system" | "raw";
  speaker?: "assistant" | "user" | "system";
  text?: string;
  toolName?: string;
  toolInput?: unknown;
  toolOutput?: string;
  raw?: unknown;
}

function collapseAgentMessage(msg: unknown): AssistantLogItem | null {
  // Claude Agent SDK messages have varied shapes; pull out what we can render
  // and fall back to a raw JSON row. The exact contract isn't stable across
  // SDK versions, so be permissive and defensive.
  if (!msg || typeof msg !== "object") return null;
  const m = msg as Record<string, unknown>;

  // SDK "assistant" / "user" messages typically carry { role, content: [...] }
  if ((m.type === "assistant" || m.role === "assistant") && Array.isArray(m.content)) {
    for (const block of m.content as Array<Record<string, unknown>>) {
      if (block?.type === "text" && typeof block.text === "string") {
        return { kind: "text", speaker: "assistant", text: block.text };
      }
      if (block?.type === "tool_use") {
        return {
          kind: "tool_use",
          toolName: typeof block.name === "string" ? block.name : "tool",
          toolInput: block.input,
        };
      }
    }
  }
  if ((m.type === "user" || m.role === "user") && Array.isArray(m.content)) {
    for (const block of m.content as Array<Record<string, unknown>>) {
      if (block?.type === "tool_result") {
        const content = block.content;
        let text = "";
        if (typeof content === "string") text = content;
        else if (Array.isArray(content)) {
          for (const c of content as Array<Record<string, unknown>>) {
            if (typeof c?.text === "string") text += c.text;
          }
        }
        return { kind: "tool_result", toolOutput: text };
      }
    }
  }
  if (m.type === "system" || m.role === "system") {
    return null; // de-noise system frames
  }
  return { kind: "raw", raw: msg };
}

function AgentLogRow({ item }: { item: AssistantLogItem }) {
  if (item.kind === "text") {
    return (
      <div style={{ padding: "6px 4px", borderBottom: "1px dashed #e5e7eb" }}>
        <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 2 }}>assistant</div>
        <div style={{ fontSize: 14, whiteSpace: "pre-wrap" }}>{item.text}</div>
      </div>
    );
  }
  if (item.kind === "tool_use") {
    const cmd = item.toolInput && typeof item.toolInput === "object"
      ? (item.toolInput as { command?: string; file_path?: string }).command
        ?? (item.toolInput as { file_path?: string }).file_path
        ?? JSON.stringify(item.toolInput)
      : "";
    return (
      <div style={{ padding: "6px 4px", borderBottom: "1px dashed #e5e7eb", background: "#eef2ff" }}>
        <div style={{ fontSize: 11, color: "#4338ca", marginBottom: 2 }}>tool: {item.toolName}</div>
        <code style={{ fontSize: 12, fontFamily: "monospace", display: "block", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
          {cmd}
        </code>
      </div>
    );
  }
  if (item.kind === "tool_result") {
    const trimmed = (item.toolOutput ?? "").slice(0, 800);
    return (
      <div style={{ padding: "6px 4px", borderBottom: "1px dashed #e5e7eb" }}>
        <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 2 }}>tool result</div>
        <pre style={{ fontSize: 12, fontFamily: "monospace", margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
          {trimmed}{(item.toolOutput?.length ?? 0) > 800 ? "\n… (truncated)" : ""}
        </pre>
      </div>
    );
  }
  return (
    <div style={{ padding: "6px 4px", borderBottom: "1px dashed #e5e7eb", opacity: 0.7 }}>
      <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 2 }}>raw</div>
      <pre style={{ fontSize: 11, fontFamily: "monospace", margin: 0 }}>{JSON.stringify(item.raw, null, 2).slice(0, 400)}</pre>
    </div>
  );
}

function TokensTable({ tokens, loading }: { tokens: KMSServiceTokenMetadata[]; loading: boolean }) {
  if (loading) return <p>Loading…</p>;
  if (tokens.length === 0) return <p style={{ color: "#888" }}>No service tokens for this app yet.</p>;
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
      <thead>
        <tr style={{ textAlign: "left", borderBottom: "1px solid #e5e7eb" }}>
          <th style={{ padding: "8px 4px" }}>Token ID</th>
          <th style={{ padding: "8px 4px" }}>Status</th>
          <th style={{ padding: "8px 4px" }}>Description</th>
          <th style={{ padding: "8px 4px" }}>Created by</th>
          <th style={{ padding: "8px 4px" }}>Created</th>
          <th style={{ padding: "8px 4px" }}>Last used</th>
        </tr>
      </thead>
      <tbody>
        {tokens.map((t) => (
          <tr key={t.token_id} style={{ borderBottom: "1px solid #f3f4f6" }}>
            <td style={{ padding: "8px 4px", fontFamily: "monospace", fontSize: 12 }}>{t.token_id}</td>
            <td style={{ padding: "8px 4px" }}>{t.status}</td>
            <td style={{ padding: "8px 4px" }}>{t.description || "—"}</td>
            <td style={{ padding: "8px 4px", fontSize: 12, color: "#6b7280" }}>{t.created_by}</td>
            <td style={{ padding: "8px 4px", fontSize: 12, color: "#6b7280" }}>{fmtTs(t.created_at)}</td>
            <td style={{ padding: "8px 4px", fontSize: 12, color: "#6b7280" }}>{fmtTs(t.last_used_at)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
