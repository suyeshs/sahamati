// Security Posture: cross-project dependency-risk view for leadership (CISO)
// and engineering. Executive view leads with exposure, SLA and remediation
// speed; the engineering toggle adds the per-target detail. All numbers come
// from /api/defender/posture, computed deterministically from scan history.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  acknowledgeAlert,
  getPosture,
  listAlerts,
  runCveWatch,
  type AlertsResponse,
  type DefenderAlert,
  type Posture,
  type ProjectPosture,
  type SeverityCounts,
  type TargetPosture,
} from "../lib/defender-api";

type View = "executive" | "engineering";

const SEVERITIES: Array<keyof SeverityCounts> = ["critical", "high", "medium", "low"];
const GRADE_LABEL: Record<ProjectPosture["grade"], string> = {
  critical: "Critical exposure",
  serious: "Needs attention",
  warning: "Watch",
  good: "Healthy",
  unknown: "Not scanned",
};

function pct(v: number | null): string {
  return v === null ? "—" : `${Math.round(v * 100)}%`;
}

function days(v: number | null): string {
  if (v === null) return "—";
  return v < 1 ? "<1 d" : `${Math.round(v)} d`;
}

function age(v: number | null): string {
  if (v === null) return "never";
  if (v < 1) return "today";
  return `${Math.round(v)} d ago`;
}

/** Thin stacked bar of open findings by severity. Labels carry the meaning; colour is secondary. */
function SeverityBar({ counts, total }: { counts: SeverityCounts; total: number }) {
  if (total === 0) return <span className="posture-muted">none open</span>;
  return (
    <div className="posture-sevbar" role="img" aria-label={SEVERITIES.map((s) => `${counts[s]} ${s}`).join(", ")}>
      <div className="posture-sevbar-track">
        {SEVERITIES.filter((s) => counts[s] > 0).map((s) => (
          <span key={s} className={`posture-sevbar-seg sev-${s}`} style={{ flexGrow: counts[s] }} title={`${counts[s]} ${s}`} />
        ))}
      </div>
      <div className="posture-sevbar-labels">
        {SEVERITIES.filter((s) => counts[s] > 0).map((s) => (
          <span key={s} className="posture-sevbar-label">
            <span className={`posture-dot sev-${s}`} aria-hidden="true" />
            {counts[s]} {s}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Single-series sparkline of findings per scan. One series, so no legend; the title names it. */
function Sparkline({ points }: { points: Array<{ at: string; findings: number }> }) {
  if (points.length < 2) return <span className="posture-muted">{points.length === 1 ? `${points[0].findings} (1 scan)` : "—"}</span>;
  const w = 96;
  const h = 24;
  const max = Math.max(1, ...points.map((p) => p.findings));
  const min = Math.min(...points.map((p) => p.findings));
  const span = Math.max(1, max - min);
  const xs = points.map((_, i) => (i / (points.length - 1)) * (w - 4) + 2);
  const ys = points.map((p) => h - 2 - ((p.findings - min) / span) * (h - 4));
  const d = xs.map((x, i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${ys[i].toFixed(1)}`).join(" ");
  const last = points[points.length - 1];
  const first = points[0];
  const delta = last.findings - first.findings;
  return (
    <span className="posture-spark" title={`${points.length} scans: ${first.findings} → ${last.findings}`}>
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
        <path d={d} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={xs[xs.length - 1]} cy={ys[ys.length - 1]} r="3" fill="currentColor" />
      </svg>
      <span className={`posture-delta ${delta > 0 ? "up" : delta < 0 ? "down" : ""}`}>
        {delta > 0 ? `+${delta}` : delta < 0 ? `${delta}` : "flat"}
      </span>
    </span>
  );
}

function advisoryHref(id: string): string {
  if (id.startsWith("GHSA-")) return `https://github.com/advisories/${id}`;
  if (id.startsWith("CVE-")) return `https://nvd.nist.gov/vuln/detail/${id}`;
  if (id.startsWith("RUSTSEC-")) return `https://rustsec.org/advisories/${id}`;
  return `https://osv.dev/vulnerability/${id}`;
}

function since(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`);
  const h = (Date.now() - d.getTime()) / 3_600_000;
  if (h < 1) return "just now";
  if (h < 48) return `${Math.round(h)} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

/** Feed notifications: newly published advisories hitting inventoried packages, not yet in a scan. */
function AlertsPanel({ data, busy, onAck, onCheck }: { data: AlertsResponse | null; busy: boolean; onAck: (a: DefenderAlert) => void; onCheck: () => void }) {
  const alerts = data?.alerts ?? [];
  const critical = alerts.filter((a) => a.severity === "critical").length;
  return (
    <section className={`posture-alerts ${critical > 0 ? "has-critical" : alerts.length > 0 ? "has-high" : ""}`} aria-live="polite">
      <div className="posture-alerts-head">
        <h2>
          CVE feed notifications
          {alerts.length > 0 && <span className="posture-alerts-count">{alerts.length} new{critical > 0 ? `, ${critical} critical` : ""}</span>}
        </h2>
        <div className="posture-alerts-meta">
          {data?.running ? "checking feed…" : data?.lastCheckedAt ? `last checked ${since(data.lastCheckedAt)}` : "never checked"}
          {data?.lastError && <span className="posture-bad"> · last check failed: {data.lastError}</span>}
          <button type="button" className="btn-sm" onClick={onCheck} disabled={busy || Boolean(data?.running)}>Check feed now</button>
        </div>
      </div>
      {alerts.length === 0 ? (
        <p className="posture-muted">No new critical or high advisories against inventoried packages since the last scans. Targets scanned before the watch existed need one rescan to be covered.</p>
      ) : (
        <ul className="posture-alert-list">
          {alerts.map((a) => (
            <li key={a.id} className={`posture-alert sev-row-${a.severity}`}>
              <span className={`badge severity-${a.severity}`}>{a.severity}</span>
              <div className="posture-alert-body">
                <div>
                  <a href={advisoryHref(a.advisory_id)} target="_blank" rel="noreferrer"><strong>{a.advisory_id}</strong></a>
                  {" "}affects <code>{a.package}@{a.installed_version}</code>
                  {a.fixed_version ? <> · fixed in <code>{a.fixed_version}</code></> : <> · <span className="posture-bad">no fix published</span></>}
                </div>
                <div className="posture-muted">
                  {a.project_name} · {a.target_label} · {a.manifest_path} · published {since(a.published_at)} · detected {since(a.detected_at)}
                </div>
                <div className="posture-alert-summary">{a.summary}</div>
              </div>
              <div className="posture-alert-actions">
                <Link className="btn-sm" to={`/projects/${a.project_slug}/defender`}>Rescan</Link>
                <button type="button" className="btn-sm" onClick={() => onAck(a)} disabled={busy}>Acknowledge</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function StatTile({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "critical" | "serious" | "warning" | "good" }) {
  return (
    <div className={`posture-tile ${tone ? `tone-${tone}` : ""}`}>
      <span className="posture-tile-label">{label}</span>
      <span className="posture-tile-value">{value}</span>
      {hint && <span className="posture-tile-hint">{hint}</span>}
    </div>
  );
}

function TargetRow({ t }: { t: TargetPosture }) {
  const total = t.open.critical + t.open.high + t.open.medium + t.open.low + t.open.info;
  return (
    <tr className="posture-target-row">
      <td className="mono">
        {t.label}
        <span className="posture-muted"> {t.repoUrl.replace(/^https:\/\/github\.com\//, "")}</span>
      </td>
      <td>
        {t.approved ? (t.scheduled ? "scheduled" : "manual") : <span className="posture-muted">awaiting approval</span>}
      </td>
      <td className={t.stale ? "posture-stale" : ""}>{age(t.lastScanAgeDays)}{t.stale && t.lastScanAgeDays !== null ? " · stale" : ""}</td>
      <td>{t.packages || "—"}</td>
      <td><SeverityBar counts={t.open} total={total} /></td>
      <td><Sparkline points={t.trend} /></td>
    </tr>
  );
}

export default function SecurityPosture() {
  const [data, setData] = useState<Posture | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>("executive");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [alerts, setAlerts] = useState<AlertsResponse | null>(null);
  const [alertBusy, setAlertBusy] = useState(false);

  const reloadAlerts = useCallback(async () => {
    try {
      setAlerts(await listAlerts(true));
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  // On load: show what we have, then refresh the feed if the last check is stale.
  useEffect(() => {
    void (async () => {
      await reloadAlerts();
      try {
        const r = await runCveWatch(true);
        if (r.ran) await reloadAlerts();
      } catch {
        // The panel already shows the last error from the server.
      }
    })();
  }, [reloadAlerts]);

  const checkFeedNow = async () => {
    setAlertBusy(true);
    try {
      await runCveWatch(false);
      await reloadAlerts();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setAlertBusy(false);
    }
  };

  const ackAlert = async (a: DefenderAlert) => {
    setAlertBusy(true);
    try {
      await acknowledgeAlert(a.id);
      setAlerts((prev) => (prev ? { ...prev, alerts: prev.alerts.filter((x) => x.id !== a.id) } : prev));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setAlertBusy(false);
    }
  };

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await getPosture());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const totals = data?.totals;
  const summaryText = useMemo(() => {
    if (!data) return "";
    const t = data.totals;
    const worst = data.projects.filter((p) => p.grade === "critical").map((p) => p.name);
    return [
      `Dependency security posture as of ${new Date(data.generatedAt).toLocaleDateString()} (${t.projects} projects, ${t.targets} repositories).`,
      `Open: ${t.open.critical} critical, ${t.open.high} high, ${t.open.medium} medium, ${t.open.low} low.`,
      `SLA: ${t.slaBreachedTotal} findings past SLA; compliance ${pct(t.slaCompliance)}. Median time to remediate ${days(t.medianTimeToRemediateDays)} (last ${data.lookbackDays} days).`,
      `Remediation: ${t.prsOpened} PRs open covering ${t.withPr} findings; ${t.acceptedRisk} accepted-risk exceptions; triage coverage ${pct(t.triageCoverage)}.`,
      `Coverage: ${t.staleTargets} repositories not scanned in 7 days, ${t.neverScanned} never scanned.`,
      worst.length ? `Critical exposure: ${worst.join(", ")}.` : "No project currently carries open critical findings.",
    ].join("\n");
  }, [data]);

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="posture">
      <div className="page-header posture-header">
        <div>
          <h1>Security Posture</h1>
          <p className="posture-subtitle">
            Dependency vulnerabilities across every project you can see, measured against remediation SLAs
            {data ? ` (critical ${data.sla.critical} d, high ${data.sla.high} d, medium ${data.sla.medium} d, low ${data.sla.low} d)` : ""}. Advisory data from OSV.dev.
          </p>
        </div>
        <div className="posture-controls">
          <div className="posture-segmented" role="group" aria-label="View">
            <button type="button" className={view === "executive" ? "active" : ""} onClick={() => setView("executive")}>Executive</button>
            <button type="button" className={view === "engineering" ? "active" : ""} onClick={() => setView("engineering")}>Engineering</button>
          </div>
          <button type="button" className="btn btn-secondary" onClick={() => void navigator.clipboard?.writeText(summaryText)} disabled={!data} title="Copy a plain-text summary for a status report">
            Copy summary
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => void reload()} disabled={loading}>Refresh</button>
        </div>
      </div>

      {error && <div className="defender-error" role="alert">{error}</div>}

      <AlertsPanel data={alerts} busy={alertBusy} onAck={ackAlert} onCheck={checkFeedNow} />

      {totals && (
        <section className="posture-kpis" aria-label="Headline metrics">
          <StatTile label="Open critical + high" value={String(totals.open.critical + totals.open.high)} hint={`${totals.open.critical} critical · ${totals.open.high} high`} tone={totals.open.critical > 0 ? "critical" : totals.open.high > 0 ? "serious" : "good"} />
          <StatTile label="Past SLA" value={String(totals.slaBreachedTotal)} hint={`compliance ${pct(totals.slaCompliance)}`} tone={totals.slaBreachedTotal > 0 ? "critical" : "good"} />
          <StatTile label="Median time to remediate" value={days(totals.medianTimeToRemediateDays)} hint={`last ${data?.lookbackDays} days`} />
          <StatTile label="P0 (reachable, fix available)" value={String(totals.p0)} hint={`triage coverage ${pct(totals.triageCoverage)}`} tone={totals.p0 > 0 ? "serious" : undefined} />
          <StatTile label="Remediation PRs open" value={String(totals.prsOpened)} hint={`${totals.withPr} findings in review`} />
          <StatTile label="Risk exceptions" value={String(totals.acceptedRisk)} hint="accepted-risk findings" tone={totals.acceptedRisk > 0 ? "warning" : undefined} />
          <StatTile label="Scan coverage gaps" value={String(totals.staleTargets + totals.neverScanned)} hint={`${totals.staleTargets} stale · ${totals.neverScanned} never scanned`} tone={totals.staleTargets + totals.neverScanned > 0 ? "warning" : "good"} />
        </section>
      )}

      {loading && !data && <p className="posture-muted">Loading…</p>}

      {data && data.projects.length === 0 && (
        <div className="empty-state">
          <h3>No projects visible</h3>
          <p>Open a project, go to Defender, and add its repository to start measuring.</p>
        </div>
      )}

      {data && data.projects.length > 0 && (
        <section>
          <table className="defender-table posture-table">
            <thead>
              <tr>
                <th>Project</th>
                <th>State</th>
                <th>Open findings</th>
                <th>Past SLA</th>
                <th>Due in 7 d</th>
                <th>P0</th>
                <th>Triage</th>
                <th>PRs</th>
                <th>Exceptions</th>
                <th>Time to fix</th>
                <th>Scan freshness</th>
                {view === "engineering" && <th>Direct / total</th>}
                {view === "engineering" && <th>Repos</th>}
              </tr>
            </thead>
            <tbody>
              {data.projects.map((p) => (
                <>
                  <tr key={p.projectId} className={`posture-row grade-${p.grade}`} onClick={() => toggle(p.projectId)}>
                    <td>
                      <strong>{p.name}</strong>
                      <span className="posture-muted"> {expanded.has(p.projectId) ? "▾" : "▸"}</span>
                    </td>
                    <td><span className={`badge grade-badge grade-${p.grade}`}>{GRADE_LABEL[p.grade]}</span></td>
                    <td><SeverityBar counts={p.open} total={p.openTotal} /></td>
                    <td className={p.slaBreachedTotal > 0 ? "posture-bad" : ""}>
                      {p.slaBreachedTotal}
                      {p.slaBreachedTotal > 0 && <span className="posture-muted"> ({p.slaBreached.critical}c · {p.slaBreached.high}h)</span>}
                    </td>
                    <td>{p.slaDueSoon}</td>
                    <td className={p.p0 > 0 ? "posture-bad" : ""}>{p.p0}</td>
                    <td>{pct(p.triageCoverage)}</td>
                    <td>{p.prsOpened}{p.withPr ? <span className="posture-muted"> ({p.withPr} findings)</span> : null}</td>
                    <td>{p.acceptedRisk}{p.falsePositive ? <span className="posture-muted"> +{p.falsePositive} fp</span> : null}</td>
                    <td>{days(p.medianTimeToRemediateDays)}{p.resolvedInWindow ? <span className="posture-muted"> (n={p.resolvedInWindow})</span> : null}</td>
                    <td className={p.coverage.stale + p.coverage.neverScanned > 0 ? "posture-stale" : ""}>
                      {p.coverage.targets === 0 ? (
                        <Link to={`/projects/${p.slug}/defender`} onClick={(e) => e.stopPropagation()}>add a target</Link>
                      ) : (
                        `${p.coverage.targets - p.coverage.stale - p.coverage.neverScanned}/${p.coverage.targets} fresh`
                      )}
                    </td>
                    {view === "engineering" && <td>{p.openDirect} / {p.openTotal}</td>}
                    {view === "engineering" && <td>{p.coverage.targets} ({p.coverage.scheduled} scheduled)</td>}
                  </tr>
                  {expanded.has(p.projectId) && (
                    <tr key={`${p.projectId}-detail`} className="posture-detail-row">
                      <td colSpan={view === "engineering" ? 13 : 11}>
                        {p.targets.length === 0 ? (
                          <p className="posture-muted">No Defender targets. <Link to={`/projects/${p.slug}/defender`}>Add one</Link>.</p>
                        ) : (
                          <table className="defender-table posture-target-table">
                            <thead>
                              <tr>
                                <th>Repository</th>
                                <th>Mode</th>
                                <th>Last scan</th>
                                <th>Packages</th>
                                <th>Open findings</th>
                                <th>Findings per scan</th>
                              </tr>
                            </thead>
                            <tbody>
                              {p.targets.map((t) => <TargetRow key={t.id} t={t} />)}
                            </tbody>
                          </table>
                        )}
                        <p className="posture-detail-link">
                          <Link to={`/projects/${p.slug}/defender`}>Open Defender for {p.name} →</Link>
                        </p>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
          <p className="posture-footnote">
            Past SLA counts open findings older than the SLA for their severity, measured from the first scan that saw them. Time to fix is the median age of findings that disappeared from a later scan or were marked resolved in the last {data.lookbackDays} days. Exceptions are findings a person marked accepted-risk; they stay visible here on purpose.
          </p>
        </section>
      )}
    </div>
  );
}
