import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { ProjectWithDetails } from "../lib/project-api";

const STATUS_COLORS: Record<string, string> = {
  active: "#4a6cf7",
  "on-hold": "#f0ad4e",
  completed: "#5cb85c",
  archived: "#999",
};

interface ProjectCardProps {
  project: ProjectWithDetails;
  onArchive?: (project: ProjectWithDetails) => void;
}

export default function ProjectCard({ project, onArchive }: ProjectCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  return (
    <div className="project-card-wrapper">
      <Link to={`/projects/${project.slug}`} className="project-card">
        <div className="project-card-header">
          <h3 className="project-card-title">{project.name}</h3>
          <span
            className="project-card-status"
            style={{ backgroundColor: STATUS_COLORS[project.status] || "#999" }}
          >
            {project.status}
          </span>
        </div>
        {project.description && (
          <p className="project-card-description">{project.description}</p>
        )}
        <div className="project-card-meta">
          <span>{project.member_count} member{project.member_count !== 1 ? "s" : ""}</span>
          <span>{project.doc_count} doc{project.doc_count !== 1 ? "s" : ""}</span>
        </div>
      </Link>
      {onArchive && (
        <div className="project-card-menu" ref={menuRef}>
          <button
            type="button"
            className="project-card-menu-btn"
            aria-label="Project actions"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setMenuOpen((v) => !v);
            }}
          >
            ⋮
          </button>
          {menuOpen && (
            <div className="project-card-menu-dropdown" role="menu">
              <button
                type="button"
                role="menuitem"
                className="project-card-menu-item"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setMenuOpen(false);
                  onArchive(project);
                }}
              >
                Archive project
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
