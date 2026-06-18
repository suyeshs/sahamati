import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { motion } from "motion/react";
import { useAuth } from "../context/AuthContext";
import { listProjects, archiveProject, type ProjectWithDetails } from "../lib/project-api";
import ProjectCard from "../components/ProjectCard";

export default function ProjectList() {
  const { user } = useAuth();
  const [projects, setProjects] = useState<ProjectWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user?.email) return;
    setLoading(true);
    listProjects(user.email)
      .then((data) => setProjects(data.projects))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [user?.email]);

  const handleArchive = async (project: ProjectWithDetails) => {
    if (!user?.email) return;
    if (!confirm(`Archive "${project.name}"? It will be hidden from the project list.`)) return;
    try {
      await archiveProject(user.email, project.slug);
      setProjects((prev) => prev.filter((p) => p.id !== project.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to archive project");
    }
  };

  if (loading) {
    return (
      <div className="page-loading">
        <div className="loading-spinner" />
        <p>Loading projects...</p>
      </div>
    );
  }

  return (
    <div className="project-list-page">
      <div className="page-header">
        <h1>My Projects</h1>
        <Link to="/projects/new" className="btn btn-primary">
          + New Project
        </Link>
      </div>

      {error && <p className="error-text">{error}</p>}

      {projects.length === 0 ? (
        <div className="empty-state">
          <h3>No projects yet</h3>
          <p>Create your first project to get started.</p>
          <Link to="/projects/new" className="btn btn-primary">
            Create Project
          </Link>
        </div>
      ) : (
        <motion.div
          className="project-grid"
          initial="hidden"
          animate="show"
          variants={{
            hidden: {},
            show: { transition: { staggerChildren: 0.05 } },
          }}
        >
          {projects.map((project) => (
            <motion.div
              key={project.id}
              variants={{
                hidden: { opacity: 0, y: 14 },
                show: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 380, damping: 30 } },
              }}
            >
              <ProjectCard project={project} onArchive={handleArchive} />
            </motion.div>
          ))}
        </motion.div>
      )}
    </div>
  );
}
