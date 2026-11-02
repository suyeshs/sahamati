// Defender: dependency-CVE targets, findings and remediation PRs for a project.
// Mutating actions (add/approve target, scan, patch, triage status) are admin
// only, enforced on the agent-server; the page explains rather than hides.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useProject } from "../context/ProjectContext";
import { useAuth } from "../context/AuthContext";
import {
  approveTarget,
  createTarget,
  deleteTarget,
  listFindings,
  listScans,
  listTargets,
  runPatch,
  runScan,
  setFindingStatus,
  updateSchedule,
  type DefenderFinding,
  type DefenderScan,
  type DefenderTarget,
  type FindingStatus,
} from "../lib/defender-api";

type LogItem = { kind: "phase" | "log" | "agent" | "tool" | "error" | "done"; text: string; detail?: string };

function isAdmin(user: { role?: string } | null | undefined): boolean {
  return Boolean(user && user.role === "admin");
}

function fmtTs(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

function advisoryHref(id: string): string {
  if (id.startsWith("GHSA-")) return `https://github.com/advisories/${id}`;
  if (id.startsWith("CVE-")) return `https://nvd.nist.gov/vuln/detail/${id}`;
  if (id.startsWith("RUSTSEC-")) return `https://rustsec.org/advisories/${id}`;
  return `https://osv.dev/vulnerability/${id}`;
}

/** Collapse an SDK or pipeline SSE frame into one log row. */
function toLogItem(msg: unknown): LogItem | null {
  if (!msg || typeof msg !== "object") return null;
  const m = msg as Record<string, unknown>;
  if (m.type === "defender") {
    const phase = String(m.phase);
    if (phase === "log") return { kind: "log", text: String(m.line ?? "") };
    if (phase === "checkout") return { kind: "phase", text: m.mode === "clone" ? `Cloning ${m.repo}` : `Scanning local path ${m.path}` };
    if (phase === "inventory") return { kind: "phase", text: `Lockfiles: ${(m.lockfiles as string[]).join(", ") || "none"}` };
    if (phase === "osv") return { kind: "phase", text: `Querying OSV for ${m.queries} package versions` };
    if (phase === "audit") return { kind: "phase", text: `${m.tool} audit on ${m.lockfile}: ${m.ok ? `${m.advisories} advisories` : `skipped (${m.note})`}` };
    if (phase === "triage") return { kind: "phase", text: `Triage agent reviewing ${m.findings} open findings` };
    if (phase === "patch") return { kind: "phase", text: `Patch agent working on ${m.findings} findings (base: ${m.branchBase})` };
    if (phase === "done") {
      const s = m.summary as { findings?: number; added?: number; resolved?: number; packages?: number } | undefined;
      return { kind: "done", text: `Scan complete: ${s?.findings ?? 0} findings across ${s?.packages ?? 0} packages (${s?.added ?? 0} new, ${s?.resolved ?? 0} resolved)` };
    }
    return { kind: "log", text: JSON.stringify(m) };
  }
  if (m.type === "agent") {
    const inner = m.message as Record<string, unknown> | undefined;
    const content = (inner?.message as { content?: unknown } | undefined)?.content ?? inner?.content;
    if (Array.isArray(content)) {
      for (const block of content as Array<Record<string, unknown>>) {
        if (block.type === "text" && typeof block.text === "string") return { kind: "agent", text: block.text };
        if (block.type === "tool_use") return { kind: "tool", text: String(block.name ?? "tool").replace("mcp__defender__", "defender."), detail: JSON.stringify(block.input) };
      }
    }
    return null;
  }
  return null;
}

const SEVERITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

export default function Defender() {
  const { project } = useProject();
  const { user } = useAuth();
  const admin = isAdmin(user as { role?: string } | null);

  const [targets, setTargets] = useState<DefenderTarget[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [scan, setScan] = useState<DefenderScan | null>(null);
  const [scans, setScans] = useState<DefenderScan[]>([]);
  const [findings, setFindings] = useState<DefenderFinding[]>([]);
  const [statusFilter, setStatusFilter] = useState<FindingStatus | "all">("open");
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<LogItem[]>([]);
  const [running, setRunning] = useState<"scan" | "patch" | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const logEndRef = useRef<HTMLDivElement | null>(null);

  // Add-target form
  const [label, setLabel] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [cron, setCron] = useState("");
  const [showAdd, setShowAdd] = useState(false);

  const slug = project?.slug ?? "";

  const reloadTargets = useCallback(async () => {
    if (!slug) return;
    try {
      const { targets } = await listTargets(slug);
      setTargets(targets);
      if (!selected && targets.length) setSelected(targets[0].id);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [slug, selected]);

  const reloadFindings = useCallback(async () => {
    if (!selected) return;
    try {
      const [f, s] = await Promise.all([listFindings(selected), listScans(selected)]);
      setScan(f.scan);
      setFindings(f.findings);
      setScans(s.scans);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [selected]);

  useEffect(() => {
    void reloadTargets();
  }, [reloadTargets]);

  useEffect(() => {
    setChecked(new Set());
    void reloadFindings();
  }, [reloadFindings]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ block: "end" });
  }, [log]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const target = useMemo(() => targets.find((t) => t.id === selected) ?? null, [targets, selected]);
  const isFileTarget = target?.base_url.startsWith("file://") ?? false;

  const visible = useMemo(
    () =>
      findings
        .filter((f) => statusFilter === "all" || f.status === statusFilter)
        .sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9) || (a.priority ?? "p9").localeCompare(b.priority ?? "p9")),
    [findings, statusFilter],
  );

  const patchable = useMemo(
    () => visible.filter((f) => f.status === "open" && f.fixed_version && !f.proposal_pr_url && !f.remediation_pr_url && !isFileTarget),
    [visible, isFileTarget],
  );

  const handleAdd = async () => {
    if (!slug || !label.trim() || !repoUrl.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const { target } = await createTarget({ projectSlug: slug, label: label.trim(), repoUrl: repoUrl.trim(), scheduleCron: cron.trim() || undefined });
      setLabel("");
      setRepoUrl("");
      setCron("");
      setShowAdd(false);
      await reloadTargets();
      setSelected(target.id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleApprove = async (t: DefenderTarget) => {
    const reason = window.prompt(`Approve "${t.label}" for dependency scanning? Enter a short reason for the audit trail.`);
    if (!reason) return;
    setBusy(true);
    try {
      await approveTarget(t.id, reason);
      await reloadTargets();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleSchedule = async (t: DefenderTarget) => {
    const next = window.prompt("Cron schedule (5 fields, server local time). Leave empty to disable.", t.schedule_cron ?? "0 2 * * *");
    if (next === null) return;
    setBusy(true);
    try {
      await updateSchedule(t.id, next.trim() || null);
      await reloadTargets();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (t: DefenderTarget) => {
    if (!window.confirm(`Remove target "${t.label}" and all of its scans and findings? This cannot be undone.`)) return;
    setBusy(true);
    try {
      await deleteTarget(t.id);
      setSelected(null);
      await reloadTargets();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const push = (item: LogItem | null) => {
    if (item) setLog((prev) => [...prev, item]);
  };

  const startScan = (phase: "scan" | "scan+triage") => {
    if (!selected || running) return;
    setLog([{ kind: "phase", text: phase === "scan" ? "Starting dependency scan" : "Starting scan with triage" }]);
    setRunning("scan");
    setError(null);
    abortRef.current = runScan(selected, phase, {
      onMessage: (m) => push(toLogItem(m)),
      onDone: () => {
        setRunning(null);
        void reloadFindings();
        void reloadTargets();
      },
      onError: (e) => {
        push({ kind: "error", text: e });
        setRunning(null);
        void reloadFindings();
      },
    });
  };

  const startPatch = () => {
    if (!selected || running || checked.size === 0) return;
    const ids = [...checked];
    if (!window.confirm(`Open pull requests for ${ids.length} finding(s)? The agent will bump versions in an isolated workspace, run the project's tests, and open a PR for human review.`)) return;
    setLog([{ kind: "phase", text: `Starting patch run for ${ids.length} findings` }]);
    setRunning("patch");
    setError(null);
    abortRef.current = runPatch(selected, ids, {
      onMessage: (m) => push(toLogItem(m)),
      onDone: (d) => {
        const proposals = (d as { proposals?: Array<{ package: string; to: string; status: string; prUrl: string | null }> }).proposals ?? [];
        for (const p of proposals) push({ kind: p.prUrl ? "done" : "log", text: `${p.package} -> ${p.to}: ${p.status}${p.prUrl ? ` (${p.prUrl})` : ""}` });
        setRunning(null);
        setChecked(new Set());
        void reloadFindings();
      },
      onError: (e) => {
        push({ kind: "error", text: e });
        setRunning(null);
        void reloadFindings();
      },
    });
  };

  const stopRun = () => {
    abortRef.current?.abort();
    push({ kind: "error", text: "Stopped watching this run. The server finishes or aborts on its own; refresh to see the result." });
    setRunning(null);
  };

  const changeStatus = async (f: DefenderFinding, status: FindingStatus) => {
    try {
      await setFindingStatus(f.id, status);
      setFindings((prev) => prev.map((x) => (x.id === f.id ? { ...x, status } : x)));
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const toggle = (id: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (!project) return null;

  return (
    <div className="defender">
      <div className="page-header">
        <h1>Defender</h1>
        <p className="defender-subtitle">Dependency vulnerabilities for this project's repositories, matched against public advisory data (OSV). Patches arrive as pull requests; people merge.</p>
      </div>

      {error && (
        <div className="defender-error" role="alert">
          {error} <button type="button" className="btn-sm" onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}

      <section className="defender-targets">
        <div className="defender-section-head">
          <h2>Targets</h2>
          {admin && (
            <button type="button" className="btn btn-secondary" onClick={() => setShowAdd((v) => !v)} disabled={busy}>
              {showAdd ? "Cancel" : "Add target"}
            </button>
          )}
        </div>

        {showAdd && admin && (
          <div className="defender-add">
            <input placeholder="Label (e.g. saans-v2)" value={label} onChange={(e) => setLabel(e.target.value)} />
            <input placeholder="https://github.com/owner/repo or file:///absolute/path" value={repoUrl} onChange={(e) => setRepoUrl(e.target.value)} />
            <input placeholder="Cron (optional, e.g. 0 2 * * *)" value={cron} onChange={(e) => setCron(e.target.value)} />
            <button type="button" className="btn btn-primary" onClick={handleAdd} disabled={busy || !label.trim() || !repoUrl.trim()}>
              Save
            </button>
          </div>
        )}

        {targets.length === 0 ? (
          <div className="empty-state">
            <h3>No targets yet</h3>
            <p>{admin ? "Add a GitHub repository or a local path to start scanning its lockfiles." : "An admin needs to add and approve a repository before scans can run."}</p>
          </div>
        ) : (
          <table className="defender-table">
            <thead>
              <tr>
                <th>Label</th>
                <th>Source</th>
                <th>Approval</th>
                <th>Schedule</th>
                <th>State</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {targets.map((t) => (
                <tr key={t.id} className={t.id === selected ? "selected" : ""} onClick={() => setSelected(t.id)}>
                  <td>{t.label}</td>
                  <td className="mono">{t.base_url}</td>
                  <td>{t.approved_at ? <span className="badge badge-ok">approved</span> : <span className="badge badge-warning">pending</span>}</td>
                  <td className="mono">{t.schedule_cron ?? "manual"}</td>
                  <td>{t.in_flight ? <span className="badge badge-running">running</span> : "idle"}</td>
                  <td className="defender-row-actions" onClick={(e) => e.stopPropagation()}>
                    {admin && !t.approved_at && (
                      <button type="button" className="btn-sm" onClick={() => handleApprove(t)} disabled={busy}>Approve</button>
                    )}
                    {admin && <button type="button" className="btn-sm" onClick={() => handleSchedule(t)} disabled={busy}>Schedule</button>}
                    {admin && <button type="button" className="btn-sm btn-danger-small" onClick={() => handleDelete(t)} disabled={busy || t.in_flight}>Remove</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {target && (
        <section className="defender-findings">
          <div className="defender-section-head">
            <h2>
              Findings for {target.label}
              {scan && <span className="defender-scan-meta"> · last scan {fmtTs(scan.completed_at)} ({scan.trigger}){scan.summary?.packages !== undefined ? `, ${scan.summary.packages} packages` : ""}</span>}
            </h2>
            <div className="defender-actions">
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as FindingStatus | "all")}>
                <option value="open">Open</option>
                <option value="resolved">Resolved</option>
                <option value="accepted-risk">Accepted risk</option>
                <option value="false-positive">False positive</option>
                <option value="all">All</option>
              </select>
              {admin && target.approved_at && !running && (
                <>
                  <button type="button" className="btn btn-secondary" onClick={() => startScan("scan")} disabled={target.in_flight}>Scan</button>
                  <button type="button" className="btn btn-secondary" onClick={() => startScan("scan+triage")} disabled={target.in_flight}>Scan + triage</button>
                  <button type="button" className="btn btn-primary" onClick={startPatch} disabled={checked.size === 0 || target.in_flight} title={isFileTarget ? "Local paths are scan-only" : undefined}>
                    Open PR for {checked.size || ""} selected
                  </button>
                </>
              )}
              {running && <button type="button" className="btn btn-danger" onClick={stopRun}>Stop watching</button>}
            </div>
          </div>

          {!target.approved_at && <p className="defender-note">This target is awaiting admin approval; scans cannot run yet.</p>}

          {visible.length === 0 ? (
            <div className="empty-state">
              <h3>{scan ? "No findings match this filter" : "No scan yet"}</h3>
              <p>{scan ? "Change the filter or run a new scan." : "Run a scan to inventory the lockfiles and match them against OSV."}</p>
            </div>
          ) : (
            <table className="defender-table defender-findings-table">
              <thead>
                <tr>
                  <th />
                  <th>Severity</th>
                  <th>Package</th>
                  <th>Installed</th>
                  <th>Fixed</th>
                  <th>Advisory</th>
                  <th>Manifest</th>
                  <th>Triage</th>
                  <th>PR</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((f) => {
                  const canPick = patchable.includes(f);
                  const pr = f.proposal_pr_url ?? f.remediation_pr_url;
                  return (
                    <tr key={f.id}>
                      <td>
                        <input type="checkbox" checked={checked.has(f.id)} disabled={!admin || !canPick} onChange={() => toggle(f.id)} title={!canPick ? "Not patchable (no fix, already has a PR, or local target)" : undefined} />
                      </td>
                      <td><span className={`badge severity-${f.severity}`}>{f.severity}</span></td>
                      <td className="mono">
                        {f.package}
                        <span className="defender-muted"> {f.is_direct === 1 ? "direct" : "transitive"} · {f.ecosystem}</span>
                      </td>
                      <td className="mono">{f.installed_version}</td>
                      <td className="mono">{f.fixed_version ?? <span className="defender-muted">none</span>}</td>
                      <td>
                        <a href={advisoryHref(f.title)} target="_blank" rel="noreferrer" title={f.description.split("\n")[0]}>{f.title}</a>
                        {f.advisory_ids.length > 1 && <span className="defender-muted"> +{f.advisory_ids.length - 1}</span>}
                      </td>
                      <td className="mono">{f.manifest_path}</td>
                      <td>
                        {f.priority ? (
                          <span title={f.triage_note ?? ""}>
                            <strong>{f.priority}</strong> · {f.reachability}
                          </span>
                        ) : (
                          <span className="defender-muted">not triaged</span>
                        )}
                      </td>
                      <td>
                        {pr ? (
                          <a href={pr} target="_blank" rel="noreferrer">PR</a>
                        ) : f.proposal_status ? (
                          <span className="defender-muted">{f.proposal_status}</span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td>
                        {admin ? (
                          <select value={f.status} onChange={(e) => changeStatus(f, e.target.value as FindingStatus)}>
                            <option value="open">open</option>
                            <option value="resolved">resolved</option>
                            <option value="accepted-risk">accepted risk</option>
                            <option value="false-positive">false positive</option>
                          </select>
                        ) : (
                          f.status
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          {scans.length > 1 && (
            <details className="defender-history">
              <summary>Scan history ({scans.length})</summary>
              <ul>
                {scans.map((s) => (
                  <li key={s.id} className="mono">
                    {fmtTs(s.started_at)} · {s.trigger} · {s.status}
                    {s.summary ? ` · ${s.summary.findings ?? 0} findings (${s.summary.added ?? 0} new, ${s.summary.resolved ?? 0} resolved)` : ""}
                    {s.error ? ` · ${s.error}` : ""}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}

      {log.length > 0 && (
        <section className="defender-log">
          <h2>{running ? "Run in progress" : "Last run"}</h2>
          <div className="defender-log-body">
            {log.map((item, i) => (
              <div key={i} className={`defender-log-row defender-log-${item.kind}`}>
                <span className="defender-log-text">{item.text}</span>
                {item.detail && <code className="defender-log-detail">{item.detail.slice(0, 300)}</code>}
              </div>
            ))}
            <div ref={logEndRef} />
          </div>
        </section>
      )}
    </div>
  );
}
