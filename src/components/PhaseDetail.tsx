import { useState } from "react";
import { useAuth } from "../context/AuthContext";
import { usePermissions } from "../hooks/usePermissions";
import { updatePhaseStatus, type PhaseWithDocs } from "../lib/project-api";
import { PHASE_TEMPLATES, type PhaseTemplate } from "../lib/docs";
import AgentRunner from "./AgentRunner";
import MarkdownViewer from "./MarkdownViewer";

const PHASE_AGENT_MAP: Record<string, string> = {
  Discovery: "discovery",
  Requirements: "requirements",
  Design: "knowledge",
  Development: "process-docs",
  Testing: "knowledge",
  Deployment: "knowledge",
};

const STATUS_OPTIONS = ["not-started", "in-progress", "completed", "skipped"];

interface PhaseDetailProps {
  phase: PhaseWithDocs;
  projectSlug: string;
  onClose: () => void;
  onUpdate?: () => void;
}

export default function PhaseDetail({ phase, projectSlug, onClose, onUpdate }: PhaseDetailProps) {
  const { user } = useAuth();
  const permissions = usePermissions();
  const [showAgent, setShowAgent] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<PhaseTemplate | null>(null);

  const templates = PHASE_TEMPLATES[phase.name] ?? [];

  const handleStatusChange = async (newStatus: string) => {
    if (!user?.email) return;
    await updatePhaseStatus(user.email, projectSlug, phase.id, newStatus);
    onUpdate?.();
  };

  const agentType = PHASE_AGENT_MAP[phase.name] || "discovery";

  return (
    <div className="phase-detail">
      <div className="phase-detail-header">
        <div className="phase-detail-title">
          <h3>{phase.name} Phase</h3>
          {permissions.canEditProject && (
            <select
              value={phase.status}
              onChange={(e) => handleStatusChange(e.target.value)}
              className="phase-status-select"
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s.replace("-", " ")}
                </option>
              ))}
            </select>
          )}
        </div>
        <button className="phase-detail-close" onClick={onClose} type="button">
          Close
        </button>
      </div>

      <div className="phase-detail-content">
        <div className="phase-detail-docs">
          <h4>Reference Templates ({templates.length})</h4>
          {templates.length === 0 ? (
            <p className="text-muted">No reference templates for this phase.</p>
          ) : selectedTemplate ? (
            <div className="phase-template-viewer">
              <div className="phase-template-viewer-header">
                <button
                  className="btn btn-link"
                  onClick={() => setSelectedTemplate(null)}
                  type="button"
                >
                  &larr; Back to templates
                </button>
                <span className="phase-template-viewer-title">{selectedTemplate.title}</span>
              </div>
              <MarkdownViewer filePath={selectedTemplate.path} />
            </div>
          ) : (
            <ul className="phase-doc-list">
              {templates.map((tpl) => (
                <li
                  key={tpl.filename}
                  className="phase-doc-item"
                  onClick={() => setSelectedTemplate(tpl)}
                >
                  <span className="phase-doc-title">{tpl.title}</span>
                  <span className="phase-doc-meta">
                    <span className="badge">template</span>
                  </span>
                  <p className="phase-doc-description text-muted">{tpl.description}</p>
                </li>
              ))}
            </ul>
          )}
        </div>

        {permissions.canRunAgents && (
          <div className="phase-detail-actions">
            <button
              className="btn btn-primary"
              onClick={() => setShowAgent(!showAgent)}
              type="button"
            >
              {showAgent ? "Hide Agent" : `Run ${phase.name} Agent`}
            </button>
          </div>
        )}

        {showAgent && (
          <div className="phase-detail-agent">
            <AgentRunner
              agentType={agentType}
              projectSlug={projectSlug}
              phaseId={phase.id}
              userEmail={user?.email}
            />
          </div>
        )}
      </div>
    </div>
  );
}
