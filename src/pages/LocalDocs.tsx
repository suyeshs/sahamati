import { useState, useEffect, useCallback, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useLocalProject } from "../context/LocalProjectContext";
import { useAuth } from "../context/AuthContext";
import { listProjects, createDocument, triggerSync, type ProjectWithDetails } from "../lib/project-api";
import {
  pickProjectFolder,
  resolveRepo,
  initRepo,
  listDrafts,
  publishDraft,
  discardDraft,
  readDraft,
  generateDraft,
  DOC_TYPES,
  type DocType,
  type DraftInfo,
} from "../lib/local-docs";

type RunStatus = "idle" | "running" | "done" | "error";

/** Map a draft filename prefix to a project document category for the portal. */
function categoryFromFilename(filename: string): string {
  const f = filename.toLowerCase();
  if (f.startsWith("brd-") || f.startsWith("intent-")) return "business";
  if (f.startsWith("story-") || f.startsWith("us-")) return "requirements";
  if (f.startsWith("architecture-") || f.startsWith("arch-")) return "process";
  if (f.startsWith("security-")) return "security";
  return "general";
}

export default function LocalDocs() {
  const { user } = useAuth();
  const { selectedSlug, selectedPath, repoRoot, selectProject, bindFolder, clearBinding } =
    useLocalProject();
  const [projects, setProjects] = useState<ProjectWithDetails[]>([]);
  const [docType, setDocType] = useState<DocType>("brd");
  const [brief, setBrief] = useState("");
  const [status, setStatus] = useState<RunStatus>("idle");
  const [output, setOutput] = useState("");
  const [error, setError] = useState("");
  const [drafts, setDrafts] = useState<DraftInfo[]>([]);
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const controllerRef = useRef<AbortController | null>(null);

  const selectedProject = projects.find((p) => p.slug === selectedSlug) ?? null;

  // Load the user's projects for the picker
  useEffect(() => {
    if (!user?.email) return;
    listProjects(user.email)
      .then((res) => setProjects(res.projects))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [user?.email]);

  const refreshDrafts = useCallback(async () => {
    if (!selectedPath) {
      setDrafts([]);
      return;
    }
    try {
      const { drafts } = await listDrafts(selectedPath);
      setDrafts(drafts);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [selectedPath]);

  useEffect(() => {
    refreshDrafts();
  }, [refreshDrafts]);

  const handleSelectProject = (slug: string) => {
    setError("");
    setNotice("");
    setOutput("");
    selectProject(slug || null);
  };

  const handlePick = async () => {
    if (!selectedSlug) return;
    setError("");
    setNotice("");
    const path = await pickProjectFolder();
    if (!path) return;
    try {
      const { repoRoot } = await resolveRepo(path);
      bindFolder(selectedSlug, path, repoRoot);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleInit = async () => {
    if (!selectedPath) return;
    setError("");
    try {
      const res = await initRepo(selectedPath);
      setNotice(
        res.created.length
          ? `Initialized: ${res.created.join(", ")}`
          : "Already initialized — nothing to create."
      );
      refreshDrafts();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleGenerate = () => {
    if (!selectedPath || !brief.trim()) return;
    setStatus("running");
    setOutput("");
    setReviewing(null);
    setError("");
    setNotice("");
    const { promise, controller } = generateDraft(selectedPath, docType, brief);
    controllerRef.current = controller;
    promise
      .then((result) => {
        setOutput(result.content);
        setStatus("done");
        setNotice(`Draft staged: ${result.filename} (not yet published)`);
        refreshDrafts();
      })
      .catch((err) => {
        if (err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : String(err));
        setStatus("error");
      });
  };

  const handlePublish = async (filename: string) => {
    if (!selectedPath) return;
    setError("");
    try {
      // Read the content before publishing — publish moves the file out of .drafts/.
      let content = "";
      try {
        content = (await readDraft(selectedPath, filename)).content;
      } catch {
        /* fall through; portal registration is best-effort */
      }

      const res = await publishDraft(selectedPath, filename, true);
      if (res.status === "published") {
        const committed = res.committed ? ` (committed ${res.sha?.slice(0, 7)})` : "";

        // Register with the selected project, then push immediately so it lands
        // in the documentation portal now — rather than waiting on the background
        // drain (which the SYNC_DISABLED kill-switch may have paused). Repo copy
        // and portal copy coexist.
        let portalNote = "";
        if (selectedSlug && user?.email && content) {
          try {
            await createDocument(user.email, selectedSlug, {
              title: filename.replace(/\.md$/, ""),
              content,
              category: categoryFromFilename(filename),
              filename,
            });
            try {
              const { pushed } = await triggerSync(user.email);
              portalNote = ` Synced to the documentation portal (${pushed} change${pushed === 1 ? "" : "s"} pushed).`;
            } catch (syncErr) {
              const msg = syncErr instanceof Error ? syncErr.message : String(syncErr);
              portalNote = ` Saved to the project — portal sync didn't run (${msg}). It'll sync once enabled.`;
            }
          } catch (err) {
            portalNote = ` (repo published, but portal registration failed: ${err instanceof Error ? err.message : String(err)})`;
          }
        }

        setNotice(`Published → ${res.publishRel}${committed}. git push when ready.${portalNote}`);
      } else if (res.status === "exists") {
        setError(`A published file already exists at ${res.publishRel}.`);
      } else {
        setError(`Could not publish (${res.status}).`);
      }
      refreshDrafts();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleReview = async (filename: string) => {
    if (!selectedPath) return;
    setError("");
    try {
      const { content } = await readDraft(selectedPath, filename);
      setOutput(content);
      setReviewing(filename);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDiscard = async (filename: string) => {
    if (!selectedPath) return;
    setError("");
    try {
      await discardDraft(selectedPath, filename);
      setNotice(`Discarded ${filename}`);
      refreshDrafts();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="page" style={{ padding: "1.5rem", maxWidth: 900, margin: "0 auto" }}>
      <h2>Local Project Docs</h2>
      <p style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>
        Generate documentation directly into a project on this machine. Drafts are written to{" "}
        <code>docs/.drafts/</code> in your repo — your editor and <code>git status</code> will show
        them as unpublished until you publish.
      </p>

      {/* Project selection */}
      <div style={{ margin: "1rem 0", padding: "1rem", borderRadius: "var(--radius)", boxShadow: "var(--neu-inset)" }}>
        <label htmlFor="local-project" style={{ fontSize: "0.8rem", color: "var(--text-muted)", display: "block", marginBottom: "0.35rem" }}>
          Project
        </label>
        <select
          id="local-project"
          value={selectedSlug ?? ""}
          onChange={(e) => handleSelectProject(e.target.value)}
          style={{ width: "100%" }}
        >
          <option value="">Select a project…</option>
          {projects.map((p) => (
            <option key={p.id} value={p.slug}>{p.name}</option>
          ))}
        </select>

        {selectedProject && (
          <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.5rem" }}>
            {selectedProject.github_repo_url
              ? <>Linked repo: <a href={selectedProject.github_repo_url} target="_blank" rel="noreferrer">{selectedProject.github_repo_url}</a></>
              : <>No GitHub repo linked — add one in Project → Settings.</>}
          </div>
        )}

        {/* Folder binding for the selected project */}
        {selectedSlug && (
          <div style={{ marginTop: "0.75rem", paddingTop: "0.75rem", borderTop: "1px solid var(--border, #eee)" }}>
            {selectedPath ? (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem" }}>
                <div>
                  <div style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>Working folder</div>
                  <div style={{ fontFamily: "monospace" }}>{selectedPath}</div>
                  {repoRoot && repoRoot !== selectedPath && (
                    <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>repo root: {repoRoot}</div>
                  )}
                </div>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <button className="btn btn-sm" onClick={handleInit}>Initialize docs</button>
                  <button className="btn btn-sm" onClick={handlePick}>Change…</button>
                  <button className="btn btn-sm" onClick={() => clearBinding(selectedSlug)}>Clear</button>
                </div>
              </div>
            ) : (
              <div style={{ textAlign: "center" }}>
                <p style={{ marginBottom: "0.75rem", fontSize: "0.85rem", color: "var(--text-muted)" }}>
                  Pick the local checkout for this project once — it's remembered next time.
                </p>
                <button className="btn btn-primary" onClick={handlePick}>Choose project folder…</button>
              </div>
            )}
          </div>
        )}
      </div>

      {error && <div className="agent-error" style={{ color: "var(--danger, #c0392b)" }}>{error}</div>}
      {notice && <div className="agent-status" style={{ color: "var(--accent)" }}>{notice}</div>}

      {selectedPath && (
        <>
          {/* Generate */}
          <div style={{ margin: "1rem 0" }}>
            <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.5rem" }}>
              <select value={docType} onChange={(e) => setDocType(e.target.value as DocType)} disabled={status === "running"}>
                {DOC_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            <textarea
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              placeholder="Describe what to document…"
              rows={4}
              disabled={status === "running"}
              style={{ width: "100%" }}
            />
            <div style={{ marginTop: "0.5rem" }}>
              <button className="btn btn-primary" onClick={handleGenerate} disabled={!brief.trim() || status === "running"}>
                {status === "running" ? "Generating…" : "Generate draft"}
              </button>
            </div>
          </div>

          {/* Drafts list */}
          <div style={{ margin: "1rem 0" }}>
            <h3>Unpublished drafts {drafts.length > 0 && <span style={{ color: "var(--accent)" }}>● {drafts.length}</span>}</h3>
            {drafts.length === 0 ? (
              <p style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>None. Generated drafts appear here until published.</p>
            ) : (
              <ul style={{ listStyle: "none", padding: 0 }}>
                {drafts.map((d) => (
                  <li key={d.filename} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.5rem 0", borderBottom: "1px solid var(--border, #eee)" }}>
                    <div>
                      <div style={{ fontFamily: "monospace", fontSize: "0.85rem" }}>{d.filename}</div>
                      <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                        {d.ageDays === 0 ? "today" : `${d.ageDays}d ago`}{d.ageDays >= 7 ? " ⚠ stale" : ""}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: "0.5rem" }}>
                      <button className="btn btn-sm" onClick={() => handleReview(d.filename)}>Review</button>
                      <button className="btn btn-sm btn-primary" onClick={() => handlePublish(d.filename)}>Publish</button>
                      <button className="btn btn-sm" onClick={() => handleDiscard(d.filename)}>Discard</button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Output preview */}
          {output && (
            <div style={{ margin: "1rem 0" }}>
              <h3>
                {reviewing ? `Reviewing: ${reviewing}` : "Preview"}
                {reviewing && (
                  <button className="btn btn-sm" style={{ marginLeft: "0.75rem" }} onClick={() => { setOutput(""); setReviewing(null); }}>
                    Close
                  </button>
                )}
              </h3>
              <div className="md-viewer" style={{ maxHeight: 400, overflow: "auto", padding: "1rem", boxShadow: "var(--neu-inset)", borderRadius: "var(--radius)" }}>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{output}</ReactMarkdown>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
