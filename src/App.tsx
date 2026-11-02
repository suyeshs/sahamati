import { useState } from "react";
import { Routes, Route } from "react-router-dom";
import { useAuth } from "./context/AuthContext";
import { GlobalLayout, ProjectLayout } from "./components/Layout";
import Login from "./pages/Login";
import ProjectList from "./pages/ProjectList";
import CreateProject from "./pages/CreateProject";
import ProjectDashboard from "./pages/ProjectDashboard";
import ProjectDocuments from "./pages/ProjectDocuments";
import ProjectWorkflows from "./pages/ProjectWorkflows";
import ProjectMembers from "./pages/ProjectMembers";
import ProjectSettings from "./pages/ProjectSettings";
import Settings from "./pages/Settings";
import AgentStudio from "./pages/AgentStudio";
import VideoGallery from "./pages/VideoGallery";
import VideoCreate from "./pages/VideoCreate";
import Secrets from "./pages/Secrets";
import LocalDocs from "./pages/LocalDocs";
import Defender from "./pages/Defender";
import SecurityPosture from "./pages/SecurityPosture";

function TwoFactorChallenge() {
  const { verify2faLogin, logout, user } = useAuth();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);

  const handleVerify = async () => {
    if (code.length !== 6) return;
    setVerifying(true);
    setError(null);
    try {
      await verify2faLogin(code);
    } catch (err: any) {
      setError(err.message || "Invalid code. Please try again.");
      setCode("");
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="loading-screen" style={{ flexDirection: "column", gap: "1.5rem" }}>
      <div style={{
        background: "var(--bg)",
        borderRadius: "var(--radius)",
        boxShadow: "var(--neu-raised)",
        padding: "2.5rem",
        maxWidth: "400px",
        width: "100%",
        textAlign: "center",
      }}>
        <div style={{ fontSize: "2.5rem", marginBottom: "0.75rem" }}>
          <svg width="40" height="40" viewBox="0 0 24 24" fill="var(--accent)" stroke="var(--accent)" strokeWidth="0">
            <path d="M12 1C8.676 1 6 3.676 6 7v2H4v14h16V9h-2V7c0-3.324-2.676-6-6-6zm0 2c2.276 0 4 1.724 4 4v2H8V7c0-2.276 1.724-4 4-4zm0 10c1.1 0 2 .9 2 2s-.9 2-2 2-2-.9-2-2 .9-2 2-2z"/>
          </svg>
        </div>
        <h2 style={{ margin: "0 0 0.5rem", color: "var(--text)" }}>Two-Factor Authentication</h2>
        <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", margin: "0 0 1.5rem" }}>
          Enter the 6-digit code from your authenticator app{user?.email ? ` for ${user.email}` : ""}.
        </p>

        {error && (
          <p style={{ fontSize: "0.85rem", color: "var(--danger)", margin: "0 0 1rem" }}>
            {error}
          </p>
        )}

        <input
          type="text"
          placeholder="000000"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          maxLength={6}
          autoFocus
          style={{
            width: "100%",
            textAlign: "center",
            fontSize: "1.8rem",
            letterSpacing: "0.5em",
            padding: "0.75rem",
            borderRadius: "var(--radius-sm)",
            border: "none",
            boxShadow: "var(--neu-pressed)",
            background: "var(--bg)",
            color: "var(--text)",
            outline: "none",
            boxSizing: "border-box",
          }}
          onKeyDown={(e) => e.key === "Enter" && handleVerify()}
        />

        <button
          className="btn btn-primary"
          onClick={handleVerify}
          disabled={code.length !== 6 || verifying}
          style={{ width: "100%", marginTop: "1rem", padding: "0.75rem" }}
        >
          {verifying ? "Verifying..." : "Verify"}
        </button>

        <button
          onClick={logout}
          style={{
            marginTop: "1rem",
            background: "none",
            border: "none",
            color: "var(--text-muted)",
            cursor: "pointer",
            fontSize: "0.85rem",
          }}
        >
          Cancel and sign out
        </button>
      </div>
    </div>
  );
}

function App() {
  const { isAuthenticated, isLoading, needs2fa } = useAuth();

  if (isLoading) {
    return (
      <div className="loading-screen" data-tauri-drag-region>
        <div className="loading-spinner" />
        <p>Loading...</p>
      </div>
    );
  }

  if (needs2fa) {
    return <TwoFactorChallenge />;
  }

  if (!isAuthenticated) {
    return <Login />;
  }

  return (
    <Routes>
      {/* Global routes */}
      <Route path="/" element={<GlobalLayout />}>
        <Route index element={<ProjectList />} />
        <Route path="projects/new" element={<CreateProject />} />
        <Route path="settings" element={<Settings />} />
        <Route path="agents" element={<AgentStudio />} />
        <Route path="local-docs" element={<LocalDocs />} />
        <Route path="security" element={<SecurityPosture />} />
        <Route path="videos" element={<VideoGallery />} />
        <Route path="videos/create" element={<VideoCreate />} />
        <Route path="secrets" element={<Secrets />} />
      </Route>

      {/* Project-scoped routes */}
      <Route path="/projects/:slug" element={<ProjectLayout />}>
        <Route index element={<ProjectDashboard />} />
        <Route path="docs" element={<ProjectDocuments />} />
        <Route path="workflows" element={<ProjectWorkflows />} />
        <Route path="defender" element={<Defender />} />
        <Route path="members" element={<ProjectMembers />} />
        <Route path="settings" element={<ProjectSettings />} />
      </Route>
    </Routes>
  );
}

export default App;
