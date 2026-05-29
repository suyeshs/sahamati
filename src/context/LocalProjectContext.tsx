import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

interface LocalProjectState {
  /** Absolute path the user picked (may be a subdir of the repo). */
  selectedPath: string | null;
  /** Git repo root resolved from selectedPath. */
  repoRoot: string | null;
  setProject: (selectedPath: string, repoRoot: string) => void;
  clearProject: () => void;
}

const STORAGE_KEY = "sahamati.localProject";

const LocalProjectContext = createContext<LocalProjectState | undefined>(undefined);

export function LocalProjectProvider({ children }: { children: ReactNode }) {
  const [{ selectedPath, repoRoot }, setState] = useState<{ selectedPath: string | null; repoRoot: string | null }>(
    () => {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) return JSON.parse(raw);
      } catch {
        /* ignore */
      }
      return { selectedPath: null, repoRoot: null };
    }
  );

  const setProject = useCallback((path: string, root: string) => {
    const next = { selectedPath: path, repoRoot: root };
    setState(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }, []);

  const clearProject = useCallback(() => {
    setState({ selectedPath: null, repoRoot: null });
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  return (
    <LocalProjectContext.Provider value={{ selectedPath, repoRoot, setProject, clearProject }}>
      {children}
    </LocalProjectContext.Provider>
  );
}

export function useLocalProject(): LocalProjectState {
  const ctx = useContext(LocalProjectContext);
  if (!ctx) throw new Error("useLocalProject must be used within LocalProjectProvider");
  return ctx;
}
