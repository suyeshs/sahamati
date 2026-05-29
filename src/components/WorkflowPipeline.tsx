import { useState } from "react";
import PhasePill from "./PhasePill";
import PhaseConnector from "./PhaseConnector";
import PhaseDetail from "./PhaseDetail";
import type { PhaseWithDocs } from "../lib/project-api";

interface WorkflowPipelineProps {
  phases: PhaseWithDocs[];
  projectSlug: string;
  onPhaseUpdate?: () => void;
}

export default function WorkflowPipeline({ phases, projectSlug, onPhaseUpdate }: WorkflowPipelineProps) {
  const [selectedPhaseId, setSelectedPhaseId] = useState<string | null>(null);

  const selectedPhase = phases.find((p) => p.id === selectedPhaseId);

  return (
    <div className="workflow-pipeline-container">
      <div className="workflow-pipeline">
        {phases.map((phase, index) => (
          <div key={phase.id} className="workflow-pipeline-item">
            <PhasePill
              phase={phase}
              isSelected={phase.id === selectedPhaseId}
              onClick={() =>
                setSelectedPhaseId(phase.id === selectedPhaseId ? null : phase.id)
              }
            />
            {index < phases.length - 1 && <PhaseConnector />}
          </div>
        ))}
      </div>
      {selectedPhase && (
        <PhaseDetail
          phase={selectedPhase}
          projectSlug={projectSlug}
          onClose={() => setSelectedPhaseId(null)}
          onUpdate={onPhaseUpdate}
        />
      )}
    </div>
  );
}
