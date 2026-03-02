import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import { useAuth } from "./AuthContext";
import {
  startGitHubOAuth,
  pollGitHubAuth,
  getGitHubStatus,
  disconnectGitHub as disconnectGitHubApi,
  listGitHubRepos,
  type GitHubRepo,
} from "../lib/github-api";
import {
  isTauriEnvironment,
  openInSystemBrowser,
} from "./tauri-auth";

const GITHUB_STORAGE_KEY = "sahamati_github";
const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000;

interface GitHubState {
  isConnected: boolean;
  username: string | null;
  isConnecting: boolean;
}

interface GitHubContextType extends GitHubState {
  connectGitHub: () => void;
  disconnectGitHub: () => void;
  repos: GitHubRepo[];
  loadingRepos: boolean;
  loadRepos: (options?: { page?: number; q?: string }) => void;
  error: string | null;
  clearError: () => void;
}

const GitHubContext = createContext<GitHubContextType | null>(null);

export function GitHubProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [state, setState] = useState<GitHubState>({
    isConnected: false,
    username: null,
    isConnecting: false,
  });
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollAbortRef = useRef<AbortController | null>(null);

  // Check connection status on mount / user change
  useEffect(() => {
    if (!user?.email) {
      setState({ isConnected: false, username: null, isConnecting: false });
      setRepos([]);
      return;
    }

    // Check localStorage first for instant UI
    try {
      const stored = localStorage.getItem(GITHUB_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed.email === user.email && parsed.username) {
          setState({ isConnected: true, username: parsed.username, isConnecting: false });
        }
      }
    } catch {}

    // Then verify with server
    getGitHubStatus(user.email)
      .then((status) => {
        setState((prev) => ({
          ...prev,
          isConnected: status.connected,
          username: status.username ?? null,
        }));
        if (status.connected && status.username) {
          localStorage.setItem(
            GITHUB_STORAGE_KEY,
            JSON.stringify({ email: user.email, username: status.username })
          );
        } else {
          localStorage.removeItem(GITHUB_STORAGE_KEY);
        }
      })
      .catch(() => {
        // Server offline — keep localStorage state
      });
  }, [user?.email]);

  const connectGitHub = useCallback(async () => {
    if (!user?.email) {
      setError("You must be logged in to connect GitHub");
      return;
    }

    setState((prev) => ({ ...prev, isConnecting: true }));
    setError(null);

    try {
      const { authUrl, sessionId } = await startGitHubOAuth(user.email);

      // Open in system browser (Tauri) or new window (web)
      if (isTauriEnvironment()) {
        await openInSystemBrowser(authUrl);
      } else {
        window.open(authUrl, "_blank", "width=600,height=700");
      }

      // Poll for result
      const controller = new AbortController();
      pollAbortRef.current = controller;
      const startTime = Date.now();

      const poll = async () => {
        while (!controller.signal.aborted && Date.now() - startTime < POLL_TIMEOUT_MS) {
          try {
            const result = await pollGitHubAuth(sessionId);

            if (result.status === "complete" && result.data) {
              setState({
                isConnected: true,
                username: result.data.username,
                isConnecting: false,
              });
              localStorage.setItem(
                GITHUB_STORAGE_KEY,
                JSON.stringify({ email: user.email, username: result.data.username })
              );
              return;
            }

            if (result.status === "error") {
              setError(result.error ?? "GitHub connection failed");
              setState((prev) => ({ ...prev, isConnecting: false }));
              return;
            }

            // Still pending — wait and poll again
            await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
          } catch {
            // Network error — keep polling
            await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
          }
        }

        if (!controller.signal.aborted) {
          setError("GitHub connection timed out. Please try again.");
          setState((prev) => ({ ...prev, isConnecting: false }));
        }
      };

      poll();
    } catch (err: any) {
      setError(err.message || "Failed to start GitHub OAuth");
      setState((prev) => ({ ...prev, isConnecting: false }));
    }
  }, [user?.email]);

  const disconnectGitHub = useCallback(async () => {
    if (!user?.email) return;

    pollAbortRef.current?.abort();

    try {
      await disconnectGitHubApi(user.email);
    } catch {
      // Best effort
    }

    setState({ isConnected: false, username: null, isConnecting: false });
    setRepos([]);
    localStorage.removeItem(GITHUB_STORAGE_KEY);
  }, [user?.email]);

  const loadRepos = useCallback(
    async (options?: { page?: number; q?: string }) => {
      if (!user?.email || !state.isConnected) return;

      setLoadingRepos(true);
      try {
        const result = await listGitHubRepos(user.email, options);
        if (options?.page && options.page > 1) {
          setRepos((prev) => [...prev, ...result]);
        } else {
          setRepos(result);
        }
      } catch (err: any) {
        setError(err.message || "Failed to load repos");
      } finally {
        setLoadingRepos(false);
      }
    },
    [user?.email, state.isConnected]
  );

  const clearError = useCallback(() => setError(null), []);

  return (
    <GitHubContext.Provider
      value={{
        ...state,
        connectGitHub,
        disconnectGitHub,
        repos,
        loadingRepos,
        loadRepos,
        error,
        clearError,
      }}
    >
      {children}
    </GitHubContext.Provider>
  );
}

export function useGitHub() {
  const context = useContext(GitHubContext);
  if (!context) {
    throw new Error("useGitHub must be used within a GitHubProvider");
  }
  return context;
}
