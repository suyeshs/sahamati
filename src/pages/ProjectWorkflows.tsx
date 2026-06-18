import { useState } from "react";
import { useProject } from "../context/ProjectContext";
import { usePermissions } from "../hooks/usePermissions";
import AgentRunner from "../components/AgentRunner";
import { useAuth } from "../context/AuthContext";

const AGENT_WORKFLOWS = [
  {
    type: "discovery",
    title: "Generate BRD",
    description: "Generate a Business Requirements Document from meeting notes or project description.",
    phase: "Discovery",
  },
  {
    type: "requirements",
    title: "Generate Requirements",
    description: "Transform a BRD into functional requirements and user stories.",
    phase: "Requirements",
  },
  {
    type: "knowledge",
    title: "Knowledge Base",
    description: "Generate or update knowledge base documentation and FAQs.",
    phase: "Design",
  },
  {
    type: "process-docs",
    title: "Process Documentation",
    description: "Generate SOPs, architecture docs, and runbooks from a codebase.",
    phase: "Development",
  },
  {
    type: "security",
    title: "Security Assessment",
    description: "Static security review of a codebase — secrets, auth, injection, misconfig — as an OWASP/CWE report.",
    phase: "Development",
  },
  {
    type: "owasp",
    title: "OWASP Assessment",
    description: "Assess against OWASP Top 10:2025 + ASVS with a STRIDE threat model, test-execution register, and regulatory alignment.",
    phase: "Development",
  },
  {
    type: "vapt",
    title: "VAPT Report",
    description: "Vulnerability assessment & penetration-test plan: recon, STRIDE threat model, findings, and an operator run-book.",
    phase: "Development",
  },
];

export default function ProjectWorkflows() {
  const { project, phases } = useProject();
  const { user } = useAuth();
  const permissions = usePermissions();
  const [selectedWorkflow, setSelectedWorkflow] = useState<string | null>(null);

  if (!project) return null;

  if (!permissions.canRunAgents) {
    return (
      <div className="project-workflows">
        <h1>Workflows</h1>
        <div className="empty-state">
          <p>You don't have permission to run agents on this project.</p>
        </div>
      </div>
    );
  }

  // Map phase names to phase IDs
  const phaseMap = new Map(phases.map((p) => [p.name, p.id]));

  return (
    <div className="project-workflows">
      <h1>Agent Workflows</h1>

      <div className="workflow-cards">
        {AGENT_WORKFLOWS.map((workflow) => (
          <button
            key={workflow.type}
            className={`workflow-card ${selectedWorkflow === workflow.type ? "selected" : ""}`}
            onClick={() =>
              setSelectedWorkflow(
                selectedWorkflow === workflow.type ? null : workflow.type
              )
            }
            type="button"
          >
            <h3>{workflow.title}</h3>
            <p>{workflow.description}</p>
            <span className="workflow-card-phase">Phase: {workflow.phase}</span>
          </button>
        ))}
      </div>

      {selectedWorkflow && (
        <div className="workflow-runner">
          <AgentRunner
            agentType={selectedWorkflow}
            projectSlug={project.slug}
            phaseId={phaseMap.get(
              AGENT_WORKFLOWS.find((w) => w.type === selectedWorkflow)?.phase || ""
            )}
            userEmail={user?.email}
            projectRepoUrl={project.github_repo_url}
          />
        </div>
      )}
    </div>
  );
}
