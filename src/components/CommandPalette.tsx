import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { useAuth } from "../context/AuthContext";
import { listProjects, type ProjectWithDetails } from "../lib/project-api";

const OPEN_EVENT = "sahamati:open-command-palette";

/** Open the command palette from anywhere (e.g. the title bar button). */
export function openCommandPalette() {
  window.dispatchEvent(new CustomEvent(OPEN_EVENT));
}

interface Command {
  id: string;
  label: string;
  hint?: string;
  group: string;
  run: () => void;
}

export default function CommandPalette() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [projects, setProjects] = useState<ProjectWithDetails[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  // Open on Cmd/Ctrl+K and via the custom event; close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_EVENT, onOpen);
    };
  }, []);

  // Reset and focus on open; refresh the project list.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActive(0);
    requestAnimationFrame(() => inputRef.current?.focus());
    if (user?.email) {
      listProjects(user.email)
        .then((data) => setProjects(data.projects))
        .catch(() => {});
    }
  }, [open, user?.email]);

  const commands: Command[] = useMemo(() => {
    const go = (path: string) => () => {
      navigate(path);
      setOpen(false);
    };
    const nav: Command[] = [
      { id: "home", label: "Projects", group: "Navigate", run: go("/") },
      { id: "agents", label: "Agent Studio", group: "Navigate", run: go("/agents") },
      { id: "local-docs", label: "Local Docs", group: "Navigate", run: go("/local-docs") },
      { id: "settings", label: "Settings", group: "Navigate", run: go("/settings") },
    ];
    const actions: Command[] = [
      {
        id: "new-project",
        label: "New Project",
        hint: "Create",
        group: "Actions",
        run: go("/projects/new"),
      },
    ];
    const projectCmds: Command[] = projects.map((p) => ({
      id: `project-${p.id}`,
      label: p.name,
      hint: "Project",
      group: "Projects",
      run: go(`/projects/${p.slug}`),
    }));
    return [...actions, ...nav, ...projectCmds];
  }, [projects, navigate]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands
      .map((c) => ({ c, idx: c.label.toLowerCase().indexOf(q) }))
      .filter((x) => x.idx !== -1)
      .sort((a, b) => a.idx - b.idx)
      .map((x) => x.c);
  }, [commands, query]);

  useEffect(() => {
    if (active >= filtered.length) setActive(0);
  }, [filtered.length, active]);

  const onListKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      filtered[active]?.run();
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="cmdk-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onClick={() => setOpen(false)}
        >
          <motion.div
            className="cmdk-panel"
            initial={{ opacity: 0, y: -16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 420, damping: 32 }}
            onClick={(e) => e.stopPropagation()}
          >
            <input
              ref={inputRef}
              className="cmdk-input"
              placeholder="Search projects, pages, actions…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onListKey}
            />
            <div className="cmdk-list">
              {filtered.length === 0 && (
                <div className="cmdk-empty">No matches</div>
              )}
              {filtered.map((c, i) => (
                <button
                  key={c.id}
                  className={`cmdk-item ${i === active ? "active" : ""}`}
                  onMouseEnter={() => setActive(i)}
                  onClick={c.run}
                >
                  <span className="cmdk-item-label">{c.label}</span>
                  {c.hint && <span className="cmdk-item-hint">{c.hint}</span>}
                </button>
              ))}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
