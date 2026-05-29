import type { PhaseWithDocs } from "../lib/project-api";

const STATUS_CLASSES: Record<string, string> = {
  "not-started": "phase-pill--not-started",
  "in-progress": "phase-pill--in-progress",
  completed: "phase-pill--completed",
  skipped: "phase-pill--skipped",
};

interface PhasePillProps {
  phase: PhaseWithDocs;
  isSelected: boolean;
  onClick: () => void;
}

export default function PhasePill({ phase, isSelected, onClick }: PhasePillProps) {
  const statusClass = STATUS_CLASSES[phase.status] || "";

  return (
    <button
      className={`phase-pill ${statusClass} ${isSelected ? "phase-pill--selected" : ""}`}
      onClick={onClick}
      type="button"
    >
      <span className="phase-pill-name">{phase.name}</span>
      <span className="phase-pill-docs">
        {phase.doc_count} doc{phase.doc_count !== 1 ? "s" : ""}
      </span>
      <span className="phase-pill-status">{phase.status.replace("-", " ")}</span>
    </button>
  );
}
