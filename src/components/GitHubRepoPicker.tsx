import { useState, useEffect, useCallback } from "react";
import { useGitHub } from "../context/GitHubContext";

interface GitHubRepoPickerProps {
  /** Currently selected repo URL ("" when none). */
  value: string;
  /** Called with the chosen repo URL, or "" when cleared. */
  onChange: (url: string) => void;
}

/**
 * Connected-GitHub repository picker. Shared by Create Project and Project
 * Settings so both offer the same search/select flow rather than a raw URL
 * textbox. Relies on the app-level GitHubProvider for connection + repo list.
 */
export default function GitHubRepoPicker({ value, onChange }: GitHubRepoPickerProps) {
  const { isConnected: ghConnected, connectGitHub, repos, loadingRepos, loadRepos } = useGitHub();
  const [repoSearch, setRepoSearch] = useState("");
  const [showRepoPicker, setShowRepoPicker] = useState(false);

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
    onChange(htmlUrl);
    setShowRepoPicker(false);
    setRepoSearch("");
  };

  if (value) {
    return (
      <div className="repo-selected-row">
        <span className="repo-selected-url">{value}</span>
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => { onChange(""); setShowRepoPicker(false); }}
        >
          Change
        </button>
      </div>
    );
  }

  if (!ghConnected) {
    return (
      <div className="repo-connect-prompt">
        <span className="repo-connect-text">Connect GitHub to select a repository</span>
        <button type="button" className="btn btn-sm btn-primary" onClick={connectGitHub}>
          Connect GitHub
        </button>
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        className="btn btn-outline repo-select-btn"
        onClick={() => setShowRepoPicker(!showRepoPicker)}
      >
        Select a repository...
      </button>

      {showRepoPicker && (
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
    </>
  );
}
