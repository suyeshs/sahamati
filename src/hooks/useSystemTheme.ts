import { useEffect, useState } from "react";

export type ThemeMode = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "sahamati-theme";

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

function readStoredMode(): ThemeMode {
  if (typeof localStorage === "undefined") return "system";
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === "light" || stored === "dark" || stored === "system"
    ? stored
    : "system";
}

/**
 * Drives the app's light/dark theme.
 *
 * - "system" follows the OS appearance: on macOS via the Tauri window theme
 *   (with live `onThemeChanged` updates), in a plain browser via the
 *   `prefers-color-scheme` media query.
 * - "light"/"dark" are explicit overrides, persisted to localStorage.
 *
 * Applies the resolved theme as `data-theme` on <html> so App.css tokens switch.
 */
export function useSystemTheme() {
  const [mode, setModeState] = useState<ThemeMode>(readStoredMode);
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>("light");

  // Track the OS appearance (Tauri window theme, or browser media query).
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    if (isTauri) {
      import("@tauri-apps/api/window")
        .then(async ({ getCurrentWindow }) => {
          const win = getCurrentWindow();
          const current = await win.theme();
          if (!cancelled && current) setSystemTheme(current);
          const stop = await win.onThemeChanged(({ payload }) => {
            setSystemTheme(payload);
          });
          if (cancelled) stop();
          else unlisten = stop;
        })
        .catch(() => {
          /* not in a Tauri window — leave default */
        });
    } else if (typeof window !== "undefined" && window.matchMedia) {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      setSystemTheme(mq.matches ? "dark" : "light");
      const onChange = (e: MediaQueryListEvent) =>
        setSystemTheme(e.matches ? "dark" : "light");
      mq.addEventListener("change", onChange);
      unlisten = () => mq.removeEventListener("change", onChange);
    }

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  const resolved: ResolvedTheme = mode === "system" ? systemTheme : mode;

  // Reflect the resolved theme onto <html> for the CSS token layer.
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", resolved);
  }, [resolved]);

  const setMode = (next: ThemeMode) => {
    setModeState(next);
    try {
      if (next === "system") localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* storage unavailable — keep in-memory only */
    }
  };

  /** Cycle light → dark → system for a single toggle control. */
  const cycleMode = () =>
    setMode(mode === "light" ? "dark" : mode === "dark" ? "system" : "light");

  return { mode, resolved, setMode, cycleMode };
}
