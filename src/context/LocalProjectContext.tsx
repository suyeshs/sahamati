import { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from "react";

/** A folder on disk bound to a project, resolved to its git repo root. */
interface ProjectBinding {
  /** Absolute path the user picked (may be a subdir of the repo). */
  selectedPath: string;
  /** Git repo root resolved from selectedPath. */
  repoRoot: string;
}

interface LocalProjectState {
  /** Slug of the currently-selected DB project, or null. */
  selectedSlug: string | null;
  /** Folder bound to the selected project (null until one is picked). */
  selectedPath: string | null;
  /** Git repo root for the selected project's folder. */
  repoRoot: string | null;
  /** Make a project the active one. Its bound folder (if any) auto-resolves. */
  selectProject: (slug: string | null) => void;
  /** Bind a picked folder + repo root to a project, remembered across sessions. */
  bindFolder: (slug: string, selectedPath: string, repoRoot: string) => void;
  /** Forget the folder bound to a project (keeps it selected). */
  clearBinding: (slug: string) => void;
}

const STORAGE_KEY = "sahamati.localProject.v2";

interface PersistShape {
  selectedSlug: string | null;
  bindings: Record<string, ProjectBinding>;
}

const LocalProjectContext = createContext<LocalProjectState | undefined>(undefined);

function load(): PersistShape {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && parsed.bindings) {
        return { selectedSlug: parsed.selectedSlug ?? null, bindings: parsed.bindings };
      }
    }
  } catch {
    /* ignore */
  }
  return { selectedSlug: null, bindings: {} };
}

export function LocalProjectProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PersistShape>(load);

  const persist = useCallback((next: PersistShape) => {
    setState(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }, []);

  const selectProject = useCallback(
    (slug: string | null) => persist({ ...state, selectedSlug: slug }),
    [state, persist]
  );

  const bindFolder = useCallback(
    (slug: string, selectedPath: string, repoRoot: string) =>
      persist({
        selectedSlug: slug,
        bindings: { ...state.bindings, [slug]: { selectedPath, repoRoot } },
      }),
    [state, persist]
  );

  const clearBinding = useCallback(
    (slug: string) => {
      const bindings = { ...state.bindings };
      delete bindings[slug];
      persist({ ...state, bindings });
    },
    [state, persist]
  );

  const value = useMemo<LocalProjectState>(() => {
    const binding = state.selectedSlug ? state.bindings[state.selectedSlug] : undefined;
    return {
      selectedSlug: state.selectedSlug,
      selectedPath: binding?.selectedPath ?? null,
      repoRoot: binding?.repoRoot ?? null,
      selectProject,
      bindFolder,
      clearBinding,
    };
  }, [state, selectProject, bindFolder, clearBinding]);

  return <LocalProjectContext.Provider value={value}>{children}</LocalProjectContext.Provider>;
}

export function useLocalProject(): LocalProjectState {
  const ctx = useContext(LocalProjectContext);
  if (!ctx) throw new Error("useLocalProject must be used within LocalProjectProvider");
  return ctx;
}
