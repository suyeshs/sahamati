import { useEffect, type ReactNode } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import Sidebar from "./Sidebar";
import TitleBar from "./TitleBar";
import CommandPalette from "./CommandPalette";
import { ProjectProvider } from "../context/ProjectContext";

/** Listen for the tray "New Project" menu item and route to the create page. */
function useTrayEvents() {
  const navigate = useNavigate();
  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    let dispose: (() => void) | undefined;
    let cancelled = false;
    import("@tauri-apps/api/event")
      .then(({ listen }) => listen("tray://new-project", () => navigate("/projects/new")))
      .then((un) => {
        if (cancelled) un();
        else dispose = un;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, [navigate]);
}

function AppShell({ mode, children }: { mode: "global" | "project"; children: ReactNode }) {
  const location = useLocation();
  useTrayEvents();

  return (
    <>
      <TitleBar />
      <div className="app-layout">
        <Sidebar mode={mode} />
        <main className="app-content">
          <AnimatePresence mode="wait">
            <motion.div
              key={location.pathname}
              className="route-view"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            >
              {children}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
      <CommandPalette />
    </>
  );
}

export function GlobalLayout() {
  return (
    <AppShell mode="global">
      <Outlet />
    </AppShell>
  );
}

export function ProjectLayout() {
  return (
    <ProjectProvider>
      <AppShell mode="project">
        <Outlet />
      </AppShell>
    </ProjectProvider>
  );
}

// Default export for backward compat
export default GlobalLayout;
