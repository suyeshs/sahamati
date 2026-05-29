import { useState, useEffect } from "react";
import { NavLink, useParams, Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { listProjects, type ProjectWithDetails } from "../lib/project-api";

interface SidebarProps {
  mode: "global" | "project";
}

const PROJECT_NAV_ITEMS = [
  { to: "", label: "Dashboard", end: true },
  { to: "/docs", label: "Documents", end: false },
  { to: "/workflows", label: "Workflows", end: false },
  { to: "/members", label: "Members", end: false },
  { to: "/settings", label: "Settings", end: false },
];

export default function Sidebar({ mode }: SidebarProps) {
  const { user, logout } = useAuth();
  const { slug } = useParams<{ slug: string }>();
  const [projects, setProjects] = useState<ProjectWithDetails[]>([]);

  useEffect(() => {
    if (mode === "global" && user?.email) {
      listProjects(user.email)
        .then((data) => setProjects(data.projects))
        .catch(console.error);
    }
  }, [mode, user?.email]);

  return (
    <nav className="sidebar">
      <div className="sidebar-header">
        <h1>Sahamati</h1>
        <span className="sidebar-subtitle">
          {mode === "project" ? "Project Workspace" : "Internal Tools"}
        </span>
      </div>

      {mode === "global" ? (
        <>
          <ul className="sidebar-nav">
            <li>
              <NavLink
                to="/"
                className={({ isActive }) => `sidebar-link ${isActive ? "active" : ""}`}
                end
              >
                Home
              </NavLink>
            </li>
            <li>
              <NavLink
                to="/videos"
                className={({ isActive }) => `sidebar-link ${isActive ? "active" : ""}`}
              >
                Videos
              </NavLink>
            </li>
            <li>
              <NavLink
                to="/agents"
                className={({ isActive }) => `sidebar-link ${isActive ? "active" : ""}`}
              >
                Agent Studio
              </NavLink>
            </li>
            <li>
              <NavLink
                to="/local-docs"
                className={({ isActive }) => `sidebar-link ${isActive ? "active" : ""}`}
              >
                Local Docs
              </NavLink>
            </li>
            <li>
              <NavLink
                to="/secrets"
                className={({ isActive }) => `sidebar-link ${isActive ? "active" : ""}`}
              >
                Secrets
              </NavLink>
            </li>
            <li>
              <NavLink
                to="/settings"
                className={({ isActive }) => `sidebar-link ${isActive ? "active" : ""}`}
              >
                Settings
              </NavLink>
            </li>
            <li>
              <a
                href={
                  import.meta.env.VITE_DOCS_URL ??
                  "https://sahamati-sync.sahamati.workers.dev/docs/"
                }
                target="_blank"
                rel="noopener noreferrer"
                className="sidebar-link"
              >
                Documentation
              </a>
            </li>
          </ul>

          <div className="sidebar-section">
            <div className="sidebar-section-header">
              <span className="sidebar-section-title">MY PROJECTS</span>
              <Link to="/projects/new" className="sidebar-add-btn" title="New Project">
                +
              </Link>
            </div>
            <ul className="sidebar-projects">
              {projects.map((project) => (
                <li key={project.id}>
                  <NavLink
                    to={`/projects/${project.slug}`}
                    className={({ isActive }) =>
                      `sidebar-project-link ${isActive ? "active" : ""}`
                    }
                  >
                    <span className="sidebar-project-dot" data-status={project.status} />
                    <span className="sidebar-project-name">{project.name}</span>
                  </NavLink>
                </li>
              ))}
              {projects.length === 0 && (
                <li className="sidebar-empty">No projects yet</li>
              )}
            </ul>
          </div>
        </>
      ) : (
        <>
          <Link to="/" className="sidebar-back-link">
            &larr; Back to Projects
          </Link>

          <ul className="sidebar-nav">
            {PROJECT_NAV_ITEMS.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={`/projects/${slug}${item.to}`}
                  className={({ isActive }) =>
                    `sidebar-link ${isActive ? "active" : ""}`
                  }
                  end={item.end}
                >
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </>
      )}

      {user && (
        <div className="sidebar-user">
          {user.picture && (
            <img
              src={user.picture}
              alt={user.name}
              className="sidebar-user-avatar"
            />
          )}
          <div className="sidebar-user-info">
            <span className="sidebar-user-name">{user.name}</span>
            <span className="sidebar-user-email">{user.email}</span>
          </div>
          <button className="sidebar-logout-btn" onClick={logout}>
            Sign out
          </button>
        </div>
      )}
    </nav>
  );
}
