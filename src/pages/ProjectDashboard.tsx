import { useProject } from "../context/ProjectContext";
import WorkflowPipeline from "../components/WorkflowPipeline";

export default function ProjectDashboard() {
  const { project, phases, members, loading, error, refresh } = useProject();

  if (loading) {
    return (
      <div className="page-loading">
        <div className="loading-spinner" />
        <p>Loading project...</p>
      </div>
    );
  }

  if (error || !project) {
    return (
      <div className="error-state">
        <h3>Error</h3>
        <p>{error || "Project not found"}</p>
      </div>
    );
  }

  const completedPhases = phases.filter((p) => p.status === "completed").length;
  const totalDocs = phases.reduce((sum, p) => sum + p.doc_count, 0);
  const progress = phases.length > 0 ? Math.round((completedPhases / phases.length) * 100) : 0;

  return (
    <div className="project-dashboard">
      <div className="project-dashboard-header">
        <div>
          <h1>{project.name}</h1>
          {project.description && (
            <p className="project-description">{project.description}</p>
          )}
        </div>
        <div className="project-status-badge" data-status={project.status}>
          {project.status}
        </div>
      </div>

      <div className="project-summary-cards">
        <div className="summary-card">
          <span className="summary-card-value">{progress}%</span>
          <span className="summary-card-label">Progress</span>
        </div>
        <div className="summary-card">
          <span className="summary-card-value">{phases.length}</span>
          <span className="summary-card-label">Phases</span>
        </div>
        <div className="summary-card">
          <span className="summary-card-value">{totalDocs}</span>
          <span className="summary-card-label">Documents</span>
        </div>
        <div className="summary-card">
          <span className="summary-card-value">{members.length}</span>
          <span className="summary-card-label">Members</span>
        </div>
      </div>

      <div className="project-workflow-section">
        <h2>Workflow</h2>
        <WorkflowPipeline
          phases={phases}
          projectSlug={project.slug}
          onPhaseUpdate={refresh}
        />
      </div>
    </div>
  );
}
