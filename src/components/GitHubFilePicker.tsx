import { useState, useEffect, useCallback } from "react";
import { useGitHub } from "../context/GitHubContext";

const AGENT_SERVER_URL =
  import.meta.env.VITE_AGENT_SERVER_URL ?? "http://localhost:3001";

export interface GitHubFileSelection {
  owner: string;
  repo: string;
  branch: string;
  path: string;
  type: "file" | "dir";
  name: string;
}

interface RepoItem {
  name: string;
  path: string;
  type: "file" | "dir";
  size?: number;
  sha: string;
}

interface Branch {
  name: string;
}

interface Repo {
  full_name: string;
  name: string;
  owner: { login: string };
  default_branch: string;
  private: boolean;
  description: string | null;
}

interface GitHubFilePickerProps {
  userEmail: string;
  projectRepoUrl?: string | null;
  selectedFiles: GitHubFileSelection[];
  onSelectionChange: (files: GitHubFileSelection[]) => void;
}

type PickerStep = "repo" | "browse";

export default function GitHubFilePicker({
  userEmail,
  projectRepoUrl,
  selectedFiles,
  onSelectionChange,
}: GitHubFilePickerProps) {
  const { isConnected: ghConnected, connectGitHub } = useGitHub();
  const [step, setStep] = useState<PickerStep>("repo");

  // Repo selection
  const [repos, setRepos] = useState<Repo[]>([]);
  const [repoSearch, setRepoSearch] = useState("");
  const [repoLoading, setRepoLoading] = useState(false);

  // Current repo/branch
  const [selectedRepo, setSelectedRepo] = useState<{ owner: string; repo: string; defaultBranch: string } | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedBranch, setSelectedBranch] = useState("");

  // File browsing
  const [currentPath, setCurrentPath] = useState("");
  const [contents, setContents] = useState<RepoItem[]>([]);
  const [browseLoading, setBrowseLoading] = useState(false);
  const [browseError, setBrowseError] = useState("");

  // Auto-select repo from project URL
  useEffect(() => {
    if (projectRepoUrl && ghConnected) {
      const match = projectRepoUrl.match(/github\.com\/([^/]+)\/([^/]+)/);
      if (match) {
        selectRepo(match[1], match[2]);
      }
    }
  }, [projectRepoUrl, ghConnected]);

  // Fetch repos
  const fetchRepos = useCallback(async (search?: string) => {
    setRepoLoading(true);
    try {
      const params = new URLSearchParams({ email: userEmail, sort: "updated", per_page: "20" });
      if (search) params.set("q", search);
      const res = await fetch(`${AGENT_SERVER_URL}/api/github/repos?${params}`);
      const data = await res.json();
      setRepos((data as { repos: Repo[] }).repos ?? []);
    } catch {
      setRepos([]);
    } finally {
      setRepoLoading(false);
    }
  }, [userEmail]);

  useEffect(() => {
    if (ghConnected && step === "repo") fetchRepos();
  }, [ghConnected, step, fetchRepos]);

  const selectRepo = async (owner: string, repo: string) => {
    setBrowseLoading(true);
    setBrowseError("");
    try {
      // Fetch repo details for default branch
      const repoRes = await fetch(
        `${AGENT_SERVER_URL}/api/github/repos/${owner}/${repo}?email=${encodeURIComponent(userEmail)}`
      );
      const repoData = (await repoRes.json()) as Repo;
      const defaultBranch = repoData.default_branch ?? "main";

      setSelectedRepo({ owner, repo, defaultBranch });
      setSelectedBranch(defaultBranch);

      // Fetch branches
      const branchRes = await fetch(
        `${AGENT_SERVER_URL}/api/github/repos/${owner}/${repo}/branches?email=${encodeURIComponent(userEmail)}`
      );
      const branchData = (await branchRes.json()) as { branches: Branch[] };
      setBranches(branchData.branches ?? []);

      // Fetch root contents
      await fetchContents(owner, repo, "", defaultBranch);
      setStep("browse");
    } catch (err) {
      setBrowseError(err instanceof Error ? err.message : "Failed to load repo");
    } finally {
      setBrowseLoading(false);
    }
  };

  const fetchContents = async (owner: string, repo: string, path: string, ref: string) => {
    setBrowseLoading(true);
    setBrowseError("");
    try {
      const params = new URLSearchParams({ email: userEmail });
      if (ref) params.set("ref", ref);
      const res = await fetch(
        `${AGENT_SERVER_URL}/api/github/repos/${owner}/${repo}/contents/${path}?${params}`
      );
      if (!res.ok) throw new Error(`Failed to load: ${res.status}`);
      const data = (await res.json()) as { contents: RepoItem[] | RepoItem };
      const items = Array.isArray(data.contents) ? data.contents : [data.contents];
      // Sort: dirs first, then files alphabetically
      items.sort((a, b) => {
        if (a.type === "dir" && b.type !== "dir") return -1;
        if (a.type !== "dir" && b.type === "dir") return 1;
        return a.name.localeCompare(b.name);
      });
      setContents(items);
      setCurrentPath(path);
    } catch (err) {
      setBrowseError(err instanceof Error ? err.message : "Failed to browse");
      setContents([]);
    } finally {
      setBrowseLoading(false);
    }
  };

  const navigateToPath = (path: string) => {
    if (!selectedRepo) return;
    fetchContents(selectedRepo.owner, selectedRepo.repo, path, selectedBranch);
  };

  const handleBranchChange = (branch: string) => {
    setSelectedBranch(branch);
    if (selectedRepo) {
      fetchContents(selectedRepo.owner, selectedRepo.repo, currentPath, branch);
    }
  };

  const isSelected = (item: RepoItem) =>
    selectedFiles.some(
      (f) =>
        f.path === item.path &&
        f.owner === selectedRepo?.owner &&
        f.repo === selectedRepo?.repo
    );

  const toggleSelection = (item: RepoItem) => {
    if (!selectedRepo) return;
    const entry: GitHubFileSelection = {
      owner: selectedRepo.owner,
      repo: selectedRepo.repo,
      branch: selectedBranch,
      path: item.path,
      type: item.type,
      name: item.name,
    };

    if (isSelected(item)) {
      onSelectionChange(
        selectedFiles.filter(
          (f) =>
            !(f.path === item.path && f.owner === entry.owner && f.repo === entry.repo)
        )
      );
    } else {
      onSelectionChange([...selectedFiles, entry]);
    }
  };

  const removeSelection = (file: GitHubFileSelection) => {
    onSelectionChange(
      selectedFiles.filter(
        (f) => !(f.path === file.path && f.owner === file.owner && f.repo === file.repo)
      )
    );
  };

  // Breadcrumb segments
  const pathSegments = currentPath ? currentPath.split("/") : [];

  if (!ghConnected) {
    return (
      <div className="ghfp-status ghfp-not-connected">
        <span>GitHub not connected.</span>
        <button className="btn btn-sm btn-primary" onClick={connectGitHub} style={{ marginLeft: "0.5rem" }}>
          Connect GitHub
        </button>
      </div>
    );
  }

  return (
    <div className="ghfp">
      {/* Selected files chips */}
      {selectedFiles.length > 0 && (
        <div className="ghfp-selected">
          <span className="ghfp-selected-label">Selected ({selectedFiles.length}):</span>
          <div className="ghfp-chips">
            {selectedFiles.map((f) => (
              <span key={`${f.owner}/${f.repo}/${f.path}`} className="ghfp-chip">
                <span className="ghfp-chip-icon">{f.type === "dir" ? "\uD83D\uDCC1" : "\uD83D\uDCC4"}</span>
                <span className="ghfp-chip-path">{f.path}</span>
                <button
                  className="ghfp-chip-remove"
                  onClick={() => removeSelection(f)}
                  title="Remove"
                >
                  &times;
                </button>
              </span>
            ))}
          </div>
        </div>
      )}

      {step === "repo" && (
        <div className="ghfp-repo-picker">
          <div className="ghfp-search-row">
            <input
              type="text"
              value={repoSearch}
              onChange={(e) => setRepoSearch(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && fetchRepos(repoSearch)}
              placeholder="Search repositories..."
            />
            <button className="btn btn-sm" onClick={() => fetchRepos(repoSearch)}>
              Search
            </button>
          </div>
          {repoLoading ? (
            <div className="ghfp-loading">Loading repos...</div>
          ) : (
            <div className="ghfp-repo-list">
              {repos.map((r) => (
                <button
                  key={r.full_name}
                  className="ghfp-repo-item"
                  onClick={() => selectRepo(r.owner.login, r.name)}
                >
                  <span className="ghfp-repo-name">
                    {r.private && <span className="ghfp-lock" title="Private">&#128274;</span>}
                    {r.full_name}
                  </span>
                  {r.description && (
                    <span className="ghfp-repo-desc">{r.description}</span>
                  )}
                </button>
              ))}
              {repos.length === 0 && <div className="ghfp-empty">No repositories found.</div>}
            </div>
          )}
        </div>
      )}

      {step === "browse" && selectedRepo && (
        <div className="ghfp-browser">
          <div className="ghfp-browser-header">
            <button
              className="btn btn-sm"
              onClick={() => { setStep("repo"); setSelectedRepo(null); setContents([]); setCurrentPath(""); }}
            >
              &larr; Repos
            </button>
            <span className="ghfp-repo-label">{selectedRepo.owner}/{selectedRepo.repo}</span>
            <select
              className="ghfp-branch-select"
              value={selectedBranch}
              onChange={(e) => handleBranchChange(e.target.value)}
            >
              {branches.map((b) => (
                <option key={b.name} value={b.name}>{b.name}</option>
              ))}
            </select>
          </div>

          {/* Breadcrumbs */}
          <div className="ghfp-breadcrumbs">
            <button onClick={() => navigateToPath("")} className="ghfp-crumb">
              root
            </button>
            {pathSegments.map((seg, i) => {
              const segPath = pathSegments.slice(0, i + 1).join("/");
              return (
                <span key={segPath}>
                  <span className="ghfp-crumb-sep">/</span>
                  <button onClick={() => navigateToPath(segPath)} className="ghfp-crumb">
                    {seg}
                  </button>
                </span>
              );
            })}
          </div>

          {browseError && <div className="ghfp-error">{browseError}</div>}

          {browseLoading ? (
            <div className="ghfp-loading">Loading...</div>
          ) : (
            <div className="ghfp-file-list">
              {currentPath && (
                <button
                  className="ghfp-file-item ghfp-file-parent"
                  onClick={() => {
                    const parentPath = currentPath.split("/").slice(0, -1).join("/");
                    navigateToPath(parentPath);
                  }}
                >
                  <span className="ghfp-file-icon">..</span>
                  <span className="ghfp-file-name">..</span>
                </button>
              )}
              {contents.map((item) => (
                <div key={item.path} className={`ghfp-file-item ${isSelected(item) ? "selected" : ""}`}>
                  <label className="ghfp-file-check">
                    <input
                      type="checkbox"
                      checked={isSelected(item)}
                      onChange={() => toggleSelection(item)}
                    />
                  </label>
                  <button
                    className="ghfp-file-link"
                    onClick={() => {
                      if (item.type === "dir") navigateToPath(item.path);
                    }}
                    disabled={item.type !== "dir"}
                  >
                    <span className="ghfp-file-icon">
                      {item.type === "dir" ? "\uD83D\uDCC1" : "\uD83D\uDCC4"}
                    </span>
                    <span className="ghfp-file-name">{item.name}</span>
                  </button>
                  {item.size != null && item.type === "file" && (
                    <span className="ghfp-file-size">{formatSize(item.size)}</span>
                  )}
                </div>
              ))}
              {contents.length === 0 && !browseLoading && (
                <div className="ghfp-empty">Empty directory</div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
