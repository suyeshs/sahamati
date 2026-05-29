import { useState, useEffect, useCallback, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useLocalProject } from "../context/LocalProjectContext";
import {
  pickProjectFolder,
  resolveRepo,
  initRepo,
  listDrafts,
  publishDraft,
  discardDraft,
  generateDraft,
  DOC_TYPES,
  type DocType,
  type DraftInfo,
} from "../lib/local-docs";

type RunStatus = "idle" | "running" | "done" | "error";

export default function LocalDocs() {
  const { selectedPath, repoRoot, setProject, clearProject } = useLocalProject();
  const [docType, setDocType] = useState<DocType>("brd");
  const [brief, setBrief] = useState("");
  const [status, setStatus] = useState<RunStatus>("idle");
  const [output, setOutput] = useState("");
  const [error, setError] = useState("");
  const [drafts, setDrafts] = useState<DraftInfo[]>([]);
  const [notice, setNotice] = useState("");
  const controllerRef = useRef<AbortController | null>(null);

  const refreshDrafts = useCallback(async () => {
    if (!selectedPath) return;
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

  const handlePick = async () => {
    setError("");
    setNotice("");
    const path = await pickProjectFolder();
    if (!path) return;
    try {
      const { repoRoot } = await resolveRepo(path);
      setProject(path, repoRoot);
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
      const res = await publishDraft(selectedPath, filename, true);
      if (res.status === "published") {
        setNotice(
          `Published → ${res.publishRel}${res.committed ? ` (committed ${res.sha?.slice(0, 7)})` : ""}. Push when ready.`
        );
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

      {/* Folder selection */}
      <div style={{ margin: "1rem 0", padding: "1rem", borderRadius: "var(--radius)", boxShadow: "var(--neu-inset)" }}>
        {selectedPath ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem" }}>
            <div>
              <div style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>Project folder</div>
              <div style={{ fontFamily: "monospace" }}>{selectedPath}</div>
              {repoRoot && repoRoot !== selectedPath && (
                <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>repo root: {repoRoot}</div>
              )}
            </div>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button className="btn btn-sm" onClick={handleInit}>Initialize docs</button>
              <button className="btn btn-sm" onClick={handlePick}>Change…</button>
              <button className="btn btn-sm" onClick={clearProject}>Clear</button>
            </div>
          </div>
        ) : (
          <div style={{ textAlign: "center" }}>
            <p style={{ marginBottom: "0.75rem" }}>No project selected.</p>
            <button className="btn btn-primary" onClick={handlePick}>Choose project folder…</button>
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
              <h3>Preview</h3>
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
