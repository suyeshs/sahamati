import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useGitHub } from "../context/GitHubContext";
import { createProject } from "../lib/project-api";

export default function CreateProject() {
  const { user } = useAuth();
  const { isConnected: ghConnected, connectGitHub, repos, loadingRepos, loadRepos } = useGitHub();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [githubRepoUrl, setGithubRepoUrl] = useState("");
  const [repoSearch, setRepoSearch] = useState("");
  const [showRepoPicker, setShowRepoPicker] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load repos when picker is opened and GitHub is connected
  useEffect(() => {
    if (showRepoPicker && ghConnected) {
      loadRepos();
    }
  }, [showRepoPicker, ghConnected, loadRepos]);

  const handleRepoSearch = useCallback(() => {
    loadRepos({ q: repoSearch || undefined });
  }, [repoSearch, loadRepos]);

  const selectRepo = (htmlUrl: string) => {
    setGithubRepoUrl(htmlUrl);
    setShowRepoPicker(false);
    setRepoSearch("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user?.email || !name.trim()) return;

    setLoading(true);
    setError(null);
    try {
      const { project } = await createProject(user.email, {
        name: name.trim(),
        description: description.trim() || undefined,
        githubRepoUrl: githubRepoUrl.trim() || undefined,
      });
      navigate(`/projects/${project.slug}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create project");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="create-project-page">
      <h1>Create New Project</h1>

      <form onSubmit={handleSubmit} className="create-project-form">
        <div className="form-group">
          <label htmlFor="project-name">Project Name *</label>
          <input
            id="project-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., AA Ecosystem Portal"
            required
            autoFocus
          />
        </div>

        <div className="form-group">
          <label htmlFor="project-description">Description</label>
          <textarea
            id="project-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Brief description of the project..."
            rows={3}
          />
        </div>

        <div className="form-group">
          <label>GitHub Repository (optional)</label>
          {githubRepoUrl ? (
            <div className="repo-selected-row">
              <span className="repo-selected-url">{githubRepoUrl}</span>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => { setGithubRepoUrl(""); setShowRepoPicker(false); }}
              >
                Change
              </button>
            </div>
          ) : !ghConnected ? (
            <div className="repo-connect-prompt">
              <span className="repo-connect-text">Connect GitHub to select a repository</span>
              <button type="button" className="btn btn-sm btn-primary" onClick={connectGitHub}>
                Connect GitHub
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="btn btn-outline repo-select-btn"
              onClick={() => setShowRepoPicker(!showRepoPicker)}
            >
              Select a repository...
            </button>
          )}

          {showRepoPicker && ghConnected && (
            <div className="repo-picker-dropdown">
              <div className="repo-picker-search">
                <input
                  type="text"
                  value={repoSearch}
                  onChange={(e) => setRepoSearch(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), handleRepoSearch())}
                  placeholder="Search repositories..."
                />
                <button type="button" className="btn btn-sm" onClick={handleRepoSearch}>
                  Search
                </button>
              </div>
              {loadingRepos ? (
                <div className="repo-picker-loading">Loading repos...</div>
              ) : (
                <div className="repo-picker-list">
                  {repos.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      className="repo-picker-item"
                      onClick={() => selectRepo(r.html_url)}
                    >
                      <span className="repo-picker-name">
                        {r.private && <span className="repo-picker-lock" title="Private">&#128274;</span>}
                        {r.full_name}
                      </span>
                      {r.description && (
                        <span className="repo-picker-desc">{r.description}</span>
                      )}
                    </button>
                  ))}
                  {repos.length === 0 && (
                    <div className="repo-picker-empty">No repositories found.</div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {error && <p className="error-text">{error}</p>}

        <div className="form-actions">
          <button type="button" className="btn" onClick={() => navigate("/")}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={loading || !name.trim()}>
            {loading ? "Creating..." : "Create Project"}
          </button>
        </div>
      </form>
    </div>
  );
}
