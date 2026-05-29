import { Outlet } from "react-router-dom";
import Sidebar from "./Sidebar";
import { ProjectProvider } from "../context/ProjectContext";

export function GlobalLayout() {
  return (
    <div className="app-layout">
      <Sidebar mode="global" />
      <main className="app-content">
        <Outlet />
      </main>
    </div>
  );
}

export function ProjectLayout() {
  return (
    <ProjectProvider>
      <div className="app-layout">
        <Sidebar mode="project" />
        <main className="app-content">
          <Outlet />
        </main>
      </div>
    </ProjectProvider>
  );
}

// Default export for backward compat
export default GlobalLayout;
