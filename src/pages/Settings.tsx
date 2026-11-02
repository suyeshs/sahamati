import { useState, useEffect, useRef } from "react";
import { QRCodeSVG } from "qrcode.react";
import { useAuth } from "../context/AuthContext";
import { useGitHub } from "../context/GitHubContext";
import { get2faStatus, setup2fa, verify2fa, disable2fa } from "../lib/project-api";
import {
  getClaudeAuthStatus,
  startClaudeLogin,
  logoutClaude,
  getRunnerMode,
  type ClaudeAuthResponse,
  type RunnerMode,
} from "../lib/claudecode-api";

type FieldDef =
  | { key: string; label: string; type: "text" | "password"; placeholder?: string }
  | { key: string; label: string; type: "select"; options: string[] };

interface IntegrationDef {
  id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  /** "oauth" = uses existing Google sign-in with extra scopes, "token" = manual credential */
  authMode: "oauth" | "token";
  scopes?: string[];
  fields: FieldDef[];
}

const INTEGRATIONS: IntegrationDef[] = [
  {
    id: "google-docs",
    name: "Google Docs",
    description: "Import and sync documents from Google Drive. Generate BRDs and FRDs directly into shared folders.",
    icon: "📄",
    color: "#4285F4",
    authMode: "oauth",
    scopes: [
      "https://www.googleapis.com/auth/documents",
      "https://www.googleapis.com/auth/drive.file",
    ],
    fields: [
      { key: "folderId", label: "Default Drive Folder ID", type: "text", placeholder: "1a2b3c4d5e..." },
      { key: "syncMode", label: "Sync Mode", type: "select", options: ["Manual", "On Generate", "Bi-directional"] },
    ],
  },
  {
    id: "google-sheets",
    name: "Google Sheets",
    description: "Read project data from spreadsheets. Export requirements matrices and traceability reports.",
    icon: "📊",
    color: "#0F9D58",
    authMode: "oauth",
    scopes: [
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/drive.file",
    ],
    fields: [
      { key: "spreadsheetId", label: "Default Spreadsheet ID", type: "text", placeholder: "1a2b3c4d5e..." },
      { key: "sheetName", label: "Default Sheet", type: "text", placeholder: "Sheet1" },
    ],
  },
  {
    id: "google-mail",
    name: "Google Mail",
    description: "Give the mail-e agent read access to your mailbox so it can run against your email. Uses your Google sign-in with Gmail scopes.",
    icon: "✉️",
    color: "#EA4335",
    authMode: "oauth",
    scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
    fields: [
      { key: "labelFilter", label: "Label Filter", type: "text", placeholder: "INBOX or a custom label" },
      { key: "lookback", label: "Lookback Window", type: "select", options: ["7 days", "30 days", "90 days", "All mail"] },
    ],
  },
  {
    id: "evernote",
    name: "Evernote",
    description: "Search and sync notes from your Evernote workspace. Create notes from generated documentation.",
    icon: "🐘",
    color: "#00A82D",
    authMode: "token",
    fields: [
      { key: "devToken", label: "Developer Token", type: "password", placeholder: "S=s1:U=..." },
      { key: "sandbox", label: "Environment", type: "select", options: ["Production", "Sandbox"] },
      { key: "defaultNotebook", label: "Default Notebook", type: "text", placeholder: "Notebook name or GUID" },
    ],
  },
  {
    id: "rankmath",
    name: "Rank Math SEO",
    description: "Read SEO data from a WordPress site running Rank Math — site audits, post SEO meta, link reports, and schema.",
    icon: "🔍",
    color: "#B92A70",
    authMode: "token",
    fields: [
      { key: "siteUrl", label: "WordPress Site URL", type: "text", placeholder: "https://blog.example.com" },
      { key: "username", label: "WordPress Username", type: "text", placeholder: "editor" },
      { key: "appPassword", label: "Application Password", type: "password", placeholder: "xxxx xxxx xxxx xxxx" },
    ],
  },
];

// --- GitHub connection card using the shared GitHubContext ---

function GitHubConnectionCard() {
  const { isConnected, isConnecting, username, error, connectGitHub, disconnectGitHub, clearError } = useGitHub();

  return (
    <div className={`integration-card ${isConnected ? "connected" : ""}`} style={{ marginBottom: "0.75rem" }}>
      <div className="integration-card-header" style={{ cursor: "default" }}>
        <div className="integration-card-icon" style={{ background: "#24292e" }}>
          <svg width="20" height="20" viewBox="0 0 16 16" fill="white">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
          </svg>
        </div>
        <div className="integration-card-info">
          <span className="integration-card-name">GitHub</span>
          <span className="integration-card-desc">
            Connect your GitHub account to browse repositories and use code as context for agent-generated documents.
          </span>
        </div>
        <div className="integration-card-status">
          {isConnected && <span className="integration-badge-connected">Connected</span>}
        </div>
      </div>

      <div className="integration-card-body">
        {isConnected && username && (
          <div className="integration-oauth-info">
            <span className="integration-oauth-label">GitHub Account</span>
            <span className="integration-oauth-email">@{username}</span>
          </div>
        )}

        {!isConnected && !isConnecting && (
          <div className="integration-oauth-info">
            <span className="integration-oauth-hint">
              Clicking Connect will open GitHub in your browser to authorize access to your repositories.
            </span>
          </div>
        )}

        {error && (
          <p
            style={{ fontSize: "0.85rem", color: "var(--danger)", margin: "0.5rem 0", cursor: "pointer" }}
            onClick={clearError}
            title="Click to dismiss"
          >
            {error}
          </p>
        )}

        <div className="integration-card-actions">
          {isConnected ? (
            <button className="btn btn-danger" onClick={disconnectGitHub}>
              Disconnect
            </button>
          ) : (
            <button
              className="btn btn-primary"
              onClick={connectGitHub}
              disabled={isConnecting}
            >
              {isConnecting ? "Waiting for GitHub..." : "Connect GitHub"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function TwoFactorCard() {
  const { user } = useAuth();
  const [is2faEnabled, setIs2faEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [setupUri, setSetupUri] = useState<string | null>(null);
  const [setupSecret, setSetupSecret] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showDisable, setShowDisable] = useState(false);
  const [disableCode, setDisableCode] = useState("");

  useEffect(() => {
    if (!user?.email) return;
    get2faStatus(user.email)
      .then(({ enabled }) => {
        setIs2faEnabled(enabled);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [user?.email]);

  const handleSetup = async () => {
    if (!user?.email) return;
    setError(null);
    setSuccess(null);
    try {
      const { secret, uri } = await setup2fa(user.email);
      setSetupUri(uri);
      setSetupSecret(secret);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleVerify = async () => {
    if (!user?.email || !code) return;
    setError(null);
    try {
      await verify2fa(user.email, code);
      setIs2faEnabled(true);
      setSetupUri(null);
      setSetupSecret(null);
      setCode("");
      setSuccess("Two-factor authentication enabled successfully.");
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleDisable = async () => {
    if (!user?.email || !disableCode) return;
    setError(null);
    try {
      await disable2fa(user.email, disableCode);
      setIs2faEnabled(false);
      setShowDisable(false);
      setDisableCode("");
      setSuccess("Two-factor authentication disabled.");
    } catch (err: any) {
      setError(err.message);
    }
  };

  if (loading) return <p style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>Loading 2FA status...</p>;

  return (
    <div className="integration-card" style={{ marginBottom: "0.75rem" }}>
      <div className="integration-card-header" style={{ cursor: "default" }}>
        <div className="integration-card-icon" style={{ background: "#6c5ce7", fontSize: "20px", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="white" stroke="white" strokeWidth="0">
            <path d="M12 1C8.676 1 6 3.676 6 7v2H4v14h16V9h-2V7c0-3.324-2.676-6-6-6zm0 2c2.276 0 4 1.724 4 4v2H8V7c0-2.276 1.724-4 4-4zm0 10c1.1 0 2 .9 2 2s-.9 2-2 2-2-.9-2-2 .9-2 2-2z"/>
          </svg>
        </div>
        <div className="integration-card-info">
          <span className="integration-card-name">Two-Factor Authentication</span>
          <span className="integration-card-desc">
            Secure your account with a TOTP authenticator app (Google Authenticator, Authy, etc.)
          </span>
        </div>
        <div className="integration-card-status">
          {is2faEnabled && <span className="integration-badge-connected">Enabled</span>}
        </div>
      </div>

      <div className="integration-card-body">
        {error && (
          <p style={{ fontSize: "0.85rem", color: "var(--danger)", margin: "0.5rem 0", cursor: "pointer" }} onClick={() => setError(null)}>
            {error}
          </p>
        )}
        {success && (
          <p style={{ fontSize: "0.85rem", color: "var(--success)", margin: "0.5rem 0", cursor: "pointer" }} onClick={() => setSuccess(null)}>
            {success}
          </p>
        )}

        {!is2faEnabled && !setupUri && (
          <div>
            <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", margin: "0 0 0.75rem" }}>
              Add an extra layer of security by requiring a code from your authenticator app when signing in.
            </p>
            <button className="btn btn-primary" onClick={handleSetup}>
              Set Up 2FA
            </button>
          </div>
        )}

        {!is2faEnabled && setupUri && (
          <div>
            <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", margin: "0 0 0.75rem" }}>
              Scan this QR code with your authenticator app, then enter the 6-digit code below to confirm.
            </p>
            <div style={{ display: "flex", justifyContent: "center", margin: "1rem 0", padding: "1rem", background: "white", borderRadius: "12px", width: "fit-content", marginLeft: "auto", marginRight: "auto" }}>
              <QRCodeSVG value={setupUri} size={180} />
            </div>
            {setupSecret && (
              <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", textAlign: "center", margin: "0.5rem 0", wordBreak: "break-all" }}>
                Manual entry key: <code style={{ background: "var(--bg-dark)", padding: "2px 6px", borderRadius: "4px", fontSize: "0.8rem" }}>{setupSecret}</code>
              </p>
            )}
            <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginTop: "1rem" }}>
              <input
                type="text"
                placeholder="Enter 6-digit code"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                maxLength={6}
                style={{ width: "160px", textAlign: "center", fontSize: "1.1rem", letterSpacing: "0.3em" }}
                onKeyDown={(e) => e.key === "Enter" && handleVerify()}
              />
              <button className="btn btn-primary" onClick={handleVerify} disabled={code.length !== 6}>
                Verify & Enable
              </button>
              <button className="btn btn-secondary" onClick={() => { setSetupUri(null); setSetupSecret(null); setCode(""); }}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {is2faEnabled && !showDisable && (
          <div>
            <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", margin: "0 0 0.75rem" }}>
              Two-factor authentication is active. You will be prompted for a code after signing in with Google.
            </p>
            <button className="btn btn-danger" onClick={() => setShowDisable(true)}>
              Disable 2FA
            </button>
          </div>
        )}

        {is2faEnabled && showDisable && (
          <div>
            <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", margin: "0 0 0.75rem" }}>
              Enter a code from your authenticator app to confirm disabling 2FA.
            </p>
            <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
              <input
                type="text"
                placeholder="Enter 6-digit code"
                value={disableCode}
                onChange={(e) => setDisableCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                maxLength={6}
                style={{ width: "160px", textAlign: "center", fontSize: "1.1rem", letterSpacing: "0.3em" }}
                onKeyDown={(e) => e.key === "Enter" && handleDisable()}
              />
              <button className="btn btn-danger" onClick={handleDisable} disabled={disableCode.length !== 6}>
                Confirm Disable
              </button>
              <button className="btn btn-secondary" onClick={() => { setShowDisable(false); setDisableCode(""); }}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ClaudeCodeCard() {
  const [resp, setResp] = useState<ClaudeAuthResponse | null>(null);
  const [runnerMode, setRunnerMode] = useState<RunnerMode | null>(null);
  const [loading, setLoading] = useState(true);
  const [polling, setPolling] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const pollHandle = useRef<number | null>(null);

  const refresh = async () => {
    try {
      const [s, rm] = await Promise.all([getClaudeAuthStatus(), getRunnerMode()]);
      setResp(s);
      setRunnerMode(rm.mode);
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    return () => {
      if (pollHandle.current !== null) {
        window.clearInterval(pollHandle.current);
      }
    };
  }, []);

  const stopPolling = () => {
    if (pollHandle.current !== null) {
      window.clearInterval(pollHandle.current);
      pollHandle.current = null;
    }
    setPolling(false);
  };

  const handleLogin = async () => {
    setActionError(null);
    try {
      const res = await startClaudeLogin({});
      if (!res.started) {
        setActionError(res.error || "Failed to start login");
        return;
      }
      setPolling(true);
      const startedAt = Date.now();
      pollHandle.current = window.setInterval(async () => {
        try {
          const s = await getClaudeAuthStatus();
          setResp(s);
          if (s.status?.loggedIn) stopPolling();
          else if (Date.now() - startedAt > 5 * 60 * 1000) {
            stopPolling();
            setActionError("Login timed out after 5 minutes. Click Refresh once you've completed sign-in.");
          }
        } catch {
          // transient — keep polling
        }
      }, 2_000);
    } catch (err) {
      setActionError((err as Error).message);
    }
  };

  const handleLogout = async () => {
    setActionError(null);
    try {
      const res = await logoutClaude();
      if (!res.ok) setActionError(res.error || "Logout failed");
      await refresh();
    } catch (err) {
      setActionError((err as Error).message);
    }
  };

  const status = resp?.status;
  const installed = resp?.installed;
  const loggedIn = !!status?.loggedIn;
  const runnerMismatch = loggedIn && runnerMode === "sdk";

  return (
    <div className={`integration-card ${loggedIn ? "connected" : ""}`} style={{ marginBottom: "0.75rem" }}>
      <div className="integration-card-header" style={{ cursor: "default" }}>
        <div
          className="integration-card-icon"
          style={{
            background: "#cc785c",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "white",
            fontWeight: 700,
            fontSize: "16px",
          }}
        >
          CC
        </div>
        <div className="integration-card-info">
          <span className="integration-card-name">Claude Code Account</span>
          <span className="integration-card-desc">
            Sign in to your Claude account so agents can run on your subscription credits (CLI runner mode).
          </span>
        </div>
        <div className="integration-card-status">
          {loading
            ? null
            : loggedIn
            ? <span className="integration-badge-connected">Signed in</span>
            : installed === false
            ? <span className="integration-badge-connected" style={{ background: "var(--danger)" }}>Not installed</span>
            : <span className="integration-badge-connected" style={{ background: "var(--text-muted)" }}>Signed out</span>}
        </div>
      </div>

      <div className="integration-card-body">
        {loading && (
          <p style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>Loading...</p>
        )}

        {!loading && installed === false && (
          <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", margin: "0 0 0.75rem" }}>
            The <code>claude</code> CLI was not found on this machine. Install it from{" "}
            <code>https://claude.com/claude-code</code>, then click Refresh.
          </p>
        )}

        {!loading && installed && status && loggedIn && (
          <div style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
            <div style={{ margin: "0.25rem 0" }}>
              <strong>Account:</strong> {status.email ?? "unknown"}
            </div>
            {status.orgName && (
              <div style={{ margin: "0.25rem 0" }}>
                <strong>Organization:</strong> {status.orgName}
              </div>
            )}
            {status.subscriptionType && (
              <div style={{ margin: "0.25rem 0" }}>
                <strong>Subscription:</strong> {status.subscriptionType}
              </div>
            )}
            {status.authMethod && (
              <div style={{ margin: "0.25rem 0" }}>
                <strong>Method:</strong> {status.authMethod}
              </div>
            )}
            <div style={{ margin: "0.25rem 0" }}>
              <strong>Agent runner mode:</strong> {runnerMode ?? "..."}
            </div>
            {runnerMismatch && (
              <p style={{ margin: "0.5rem 0", color: "var(--warning, #b58900)" }}>
                You're signed in, but the agent runner is set to <code>sdk</code> (uses API credits).
                Set <code>AGENT_RUNNER=cli</code> in <code>agent-server/.env</code> and restart the
                server to use your subscription.
              </p>
            )}
          </div>
        )}

        {!loading && installed && !loggedIn && (
          <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", margin: "0 0 0.75rem" }}>
            Clicking <strong>Sign in</strong> will open the Claude login page in your default browser.
            After completing sign-in there, this card will update automatically.
          </p>
        )}

        {polling && (
          <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", margin: "0.5rem 0" }}>
            Waiting for sign-in to complete in your browser...
          </p>
        )}

        {actionError && (
          <p
            style={{ fontSize: "0.85rem", color: "var(--danger)", margin: "0.5rem 0", cursor: "pointer" }}
            onClick={() => setActionError(null)}
            title="Click to dismiss"
          >
            {actionError}
          </p>
        )}

        <div className="integration-card-actions">
          {loggedIn ? (
            <button className="btn btn-danger" onClick={handleLogout}>
              Sign out
            </button>
          ) : (
            <button
              className="btn btn-primary"
              onClick={handleLogin}
              disabled={installed === false || polling}
            >
              {polling ? "Waiting for browser..." : "Sign in"}
            </button>
          )}
          <button className="btn btn-secondary" onClick={refresh} disabled={loading}>
            Refresh
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Settings() {
  const { user } = useAuth();
  const [expandedCard, setExpandedCard] = useState<string | null>(null);
  const [integrationData, setIntegrationData] = useState<Record<string, Record<string, string>>>({});
  const [connectedIntegrations, setConnectedIntegrations] = useState<Set<string>>(new Set());

  const handleFieldChange = (integrationId: string, fieldKey: string, value: string) => {
    setIntegrationData((prev) => ({
      ...prev,
      [integrationId]: { ...prev[integrationId], [fieldKey]: value },
    }));
  };

  const handleConnect = (integration: IntegrationDef) => {
    if (connectedIntegrations.has(integration.id)) {
      // Disconnect
      setConnectedIntegrations((prev) => {
        const next = new Set(prev);
        next.delete(integration.id);
        return next;
      });
      return;
    }

    if (integration.authMode === "oauth") {
      // TODO: Trigger incremental Google OAuth consent with additional scopes
      // For now, mark as connected — the backend will request scopes via OAuth2 code flow
      console.log(`[Integration] Requesting Google scopes for ${integration.id}:`, integration.scopes);
    }

    setConnectedIntegrations((prev) => new Set(prev).add(integration.id));
  };

  return (
    <div className="page settings">
      <h2>Settings</h2>

      <div className="settings-section">
        <h3>General</h3>
        <div className="settings-row">
          <span>Team Name</span>
          <input type="text" placeholder="My Team" disabled />
        </div>
        <div className="settings-row">
          <span>Default Process</span>
          <select disabled>
            <option>Hybrid (Agile)</option>
            <option>Traditional</option>
            <option>AI-Native</option>
          </select>
        </div>
      </div>

      <div className="settings-section">
        <h3>Documentation</h3>
        <div className="settings-row">
          <span>Docs Directory</span>
          <input type="text" value="./docs" disabled />
        </div>
        <div className="settings-row">
          <span>Auto-refresh</span>
          <select disabled>
            <option>Enabled</option>
            <option>Disabled</option>
          </select>
        </div>
      </div>

      <div className="settings-section">
        <h3>Security</h3>
        <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", margin: "0 0 1.25rem" }}>
          Manage two-factor authentication for your account.
        </p>
        <TwoFactorCard />
      </div>

      <div className="settings-section">
        <h3>Agent Runtime</h3>
        <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", margin: "0 0 1.25rem" }}>
          Authenticate the Claude Code CLI on this machine so agents can run on your subscription
          credits instead of API credits.
        </p>
        <ClaudeCodeCard />
      </div>

      <div className="settings-section">
        <h3>Integrations</h3>
        <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", margin: "0 0 1.25rem" }}>
          Connect external services to enhance your documentation workflow.
        </p>
        <div className="integration-cards">
          {/* GitHub — dedicated OAuth card */}
          <GitHubConnectionCard />

          {INTEGRATIONS.map((integration) => {
            const isExpanded = expandedCard === integration.id;
            const isConnected = connectedIntegrations.has(integration.id);
            const data = integrationData[integration.id] || {};

            return (
              <div
                key={integration.id}
                className={`integration-card ${isExpanded ? "expanded" : ""} ${isConnected ? "connected" : ""}`}
              >
                <div
                  className="integration-card-header"
                  onClick={() => setExpandedCard(isExpanded ? null : integration.id)}
                >
                  <div className="integration-card-icon" style={{ background: integration.color }}>
                    {integration.icon}
                  </div>
                  <div className="integration-card-info">
                    <span className="integration-card-name">{integration.name}</span>
                    <span className="integration-card-desc">{integration.description}</span>
                  </div>
                  <div className="integration-card-status">
                    {isConnected && <span className="integration-badge-connected">Connected</span>}
                    <span className={`integration-chevron ${isExpanded ? "open" : ""}`}>&#9662;</span>
                  </div>
                </div>

                {isExpanded && (
                  <div className="integration-card-body">
                    {/* OAuth integrations show the signed-in account */}
                    {integration.authMode === "oauth" && (
                      <div className="integration-oauth-info">
                        <span className="integration-oauth-label">Google Account</span>
                        <span className="integration-oauth-email">{user?.email ?? "Not signed in"}</span>
                        {!isConnected && (
                          <span className="integration-oauth-hint">
                            Clicking Grant Access will request additional permissions for {integration.name} on your current Google account.
                          </span>
                        )}
                      </div>
                    )}

                    {integration.fields.map((field) => (
                      <div key={field.key} className="integration-field">
                        <label>{field.label}</label>
                        {field.type === "select" ? (
                          <select
                            value={data[field.key] || ""}
                            onChange={(e) => handleFieldChange(integration.id, field.key, e.target.value)}
                          >
                            <option value="">Select...</option>
                            {field.options.map((opt) => (
                              <option key={opt} value={opt}>{opt}</option>
                            ))}
                          </select>
                        ) : (
                          <input
                            type={field.type}
                            placeholder={field.placeholder}
                            value={data[field.key] || ""}
                            onChange={(e) => handleFieldChange(integration.id, field.key, e.target.value)}
                          />
                        )}
                      </div>
                    ))}
                    <div className="integration-card-actions">
                      <button
                        className={`btn ${isConnected ? "btn-danger" : "btn-primary"}`}
                        onClick={() => handleConnect(integration)}
                      >
                        {isConnected
                          ? "Revoke Access"
                          : integration.authMode === "oauth"
                            ? "Grant Access"
                            : "Connect"}
                      </button>
                      {isConnected && (
                        <button className="btn btn-secondary">Test Connection</button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="settings-section">
        <h3>Agent Configuration</h3>
        <p className="placeholder-note">
          Agent and LLM configuration will be available when the agentic
          documentation framework is connected.
        </p>
      </div>
    </div>
  );
}
