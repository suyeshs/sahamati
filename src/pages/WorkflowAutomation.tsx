import { useState, useEffect } from "react";
import AgentRunner from "../components/AgentRunner";
import DocumentReview from "../components/DocumentReview";
import { checkHealth } from "../lib/agent-api";
import { useAuth } from "../context/AuthContext";
import { useGitHub } from "../context/GitHubContext";


type Tab = "workflows" | "documents";

export default function WorkflowAutomation() {
  const [activeTab, setActiveTab] = useState<Tab>("workflows");
  const [activeWorkflow, setActiveWorkflow] = useState<string | null>(null);
  const [serverOnline, setServerOnline] = useState<boolean | null>(null);
  const [selectedRepo, setSelectedRepo] = useState<string>("");
  const [repoSearch, setRepoSearch] = useState("");
  const { user } = useAuth();
  const {
    isConnected: githubConnected,
    username: githubUsername,
    isConnecting: githubConnecting,
    connectGitHub,
    disconnectGitHub,
    repos,
    loadingRepos,
    loadRepos,
    error: githubError,
    clearError: clearGithubError,
  } = useGitHub();

  useEffect(() => {
    checkHealth()
      .then(() => setServerOnline(true))
      .catch(() => setServerOnline(false));
  }, []);

  // Load repos when GitHub is connected and process-docs workflow is active
  useEffect(() => {
    if (githubConnected && activeWorkflow === "process-docs" && repos.length === 0) {
      loadRepos();
    }
  }, [githubConnected, activeWorkflow, repos.length, loadRepos]);

  const filteredRepos = repoSearch
    ? repos.filter(
        (r) =>
          r.full_name.toLowerCase().includes(repoSearch.toLowerCase()) ||
          (r.description ?? "").toLowerCase().includes(repoSearch.toLowerCase())
      )
    : repos;

  return (
    <div className="page workflows">
      <h2>Workflow Automation</h2>

      {serverOnline === false && (
        <div className="server-status offline">
          Agent server is offline. Start it with:{" "}
          <code>cd agent-server && bun run dev</code>
        </div>
      )}
      {serverOnline === true && (
        <div className="server-status online">Agent server connected</div>
      )}

      <div className="tab-bar">
        <button
          className={`tab-btn ${activeTab === "workflows" ? "active" : ""}`}
          onClick={() => setActiveTab("workflows")}
        >
          Agent Workflows
        </button>
        <button
          className={`tab-btn ${activeTab === "documents" ? "active" : ""}`}
          onClick={() => setActiveTab("documents")}
        >
          Generated Documents
        </button>
      </div>

      {activeTab === "workflows" && (
        <div className="workflows-content">
          {!activeWorkflow && (
            <div className="workflow-cards">
              <div
                className="workflow-card"
                onClick={() => setActiveWorkflow("discovery")}
              >
                <h3>Generate BRD</h3>
                <p>
                  Transform meeting notes, project ideas, or stakeholder
                  conversations into a structured Business Requirements
                  Document.
                </p>
                <span className="workflow-agent-label">Discovery Agent</span>
              </div>

              <div
                className="workflow-card"
                onClick={() => setActiveWorkflow("requirements")}
              >
                <h3>Generate User Stories</h3>
                <p>
                  Transform an existing BRD into detailed user stories with
                  acceptance criteria and an FRD.
                </p>
                <span className="workflow-agent-label">Requirements Agent</span>
              </div>

              <div
                className="workflow-card"
                onClick={() => setActiveWorkflow("knowledge")}
              >
                <h3>Documentation Health Check</h3>
                <p>
                  Scan all project documentation for gaps, staleness, and
                  inconsistencies. Get a health report with recommendations.
                </p>
                <span className="workflow-agent-label">Knowledge Agent</span>
              </div>

              <div
                className="workflow-card"
                onClick={() => setActiveWorkflow("process-docs")}
              >
                <h3>Generate Process Docs</h3>
                <p>
                  Connect to a GitHub repository and generate traditional SOP
                  documentation — architecture, deployment, operations, and
                  development standards.
                </p>
                <span className="workflow-agent-label">Process Docs Agent</span>
              </div>
            </div>
          )}

          {activeWorkflow && (
            <div>
              <button
                className="btn btn-secondary"
                onClick={() => setActiveWorkflow(null)}
                style={{ marginBottom: "1rem" }}
              >
                &larr; Back to workflows
              </button>

              {activeWorkflow === "discovery" && (
                <AgentRunner
                  agentType="discovery"
                  title="Generate BRD"
                  description="Paste meeting notes, project description, or stakeholder conversation below. The Discovery Agent will generate a complete Business Requirements Document."
                  placeholder="Paste your meeting notes or project description here...&#10;&#10;Example: We had a meeting about building a new customer portal. The key stakeholders are the VP of Sales and the Head of Customer Success. The main goals are to reduce support tickets by 40% and improve customer self-service capabilities..."
                />
              )}

              {activeWorkflow === "requirements" && (
                <AgentRunner
                  agentType="requirements"
                  title="Generate User Stories"
                  description="The Requirements Agent will find the most recent BRD and generate user stories with acceptance criteria. You can also specify which BRD to use."
                  placeholder="Generate user stories from the latest BRD&#10;&#10;Or specify: Generate user stories from BRD-customer-portal-2026-02-26.md"
                />
              )}

              {activeWorkflow === "knowledge" && (
                <AgentRunner
                  agentType="knowledge"
                  title="Documentation Health Check"
                  description="The Knowledge Agent will scan all project documentation and generate a health report with completeness scores and recommendations."
                  placeholder="Run a documentation health check&#10;&#10;Or specify: Check documentation freshness for the requirements folder"
                />
              )}

              {activeWorkflow === "process-docs" && (
                <div>
                  <div className="github-connect-section">
                    {!githubConnected ? (
                      <button
                        className="btn btn-github"
                        onClick={connectGitHub}
                        disabled={githubConnecting}
                      >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
                        </svg>
                        {githubConnecting ? "Connecting..." : "Connect GitHub"}
                      </button>
                    ) : (
                      <div className="github-connected">
                        <span className="github-connected-label">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style={{ opacity: 0.7 }}>
                            <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
                          </svg>
                          Connected as @{githubUsername}
                        </span>
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={disconnectGitHub}
                        >
                          Disconnect
                        </button>
                      </div>
                    )}
                    {githubError && (
                      <div className="github-error">
                        {githubError}
                        <button onClick={clearGithubError} className="login-error-dismiss">
                          Dismiss
                        </button>
                      </div>
                    )}
                  </div>

                  {githubConnected && (
                    <div className="repo-picker">
                      <input
                        type="text"
                        className="repo-search"
                        placeholder="Search your repositories..."
                        value={repoSearch}
                        onChange={(e) => setRepoSearch(e.target.value)}
                      />
                      <div className="repo-list">
                        {loadingRepos && <div className="repo-loading">Loading repos...</div>}
                        {!loadingRepos && filteredRepos.length === 0 && (
                          <div className="repo-empty">No repositories found</div>
                        )}
                        {filteredRepos.map((repo) => (
                          <div
                            key={repo.id}
                            className={`repo-item ${selectedRepo === repo.html_url ? "selected" : ""}`}
                            onClick={() => setSelectedRepo(repo.html_url)}
                          >
                            <div className="repo-item-name">
                              {repo.full_name}
                              {repo.private && <span className="repo-badge private">Private</span>}
                            </div>
                            {repo.description && (
                              <div className="repo-item-desc">{repo.description}</div>
                            )}
                            <div className="repo-item-meta">
                              {repo.language && <span>{repo.language}</span>}
                              <span>{new Date(repo.updated_at).toLocaleDateString()}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <AgentRunner
                    agentType="process-docs"
                    title="Generate Process Documentation"
                    description={
                      githubConnected
                        ? "Select a repo above or enter a URL/path below. The agent will analyze the codebase and generate SOP documentation."
                        : "Connect GitHub above for private repo access, or enter a public repo URL or local path below."
                    }
                    placeholder={
                      selectedRepo
                        ? selectedRepo
                        : "https://github.com/org/repo\n\nOr a local path: /Users/me/work/my-project"
                    }
                    userEmail={user?.email}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {activeTab === "documents" && <DocumentReview />}
    </div>
  );
}
