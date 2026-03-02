import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import {
  exchangeGoogleCredential,
  refreshToken,
  logoutFromServer,
  type AuthUser,
  type AuthResponse,
} from "./auth-api";
import {
  isTauriEnvironment,
  startOAuthFlow,
  openInSystemBrowser,
  pollAuthResult,
} from "./tauri-auth";

// Google Identity Services types
declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: any) => void;
          prompt: (callback?: (notification: any) => void) => void;
          renderButton: (element: HTMLElement | null, config: any) => void;
          revoke: (email: string, callback: () => void) => void;
        };
      };
    };
  }
}

const STORAGE_KEY = "sahamati_auth";
const INACTIVITY_TIMEOUT_MS = 15 * 60 * 1000;
const TOKEN_REFRESH_THRESHOLD_MS = 60 * 60 * 1000;

interface AuthState {
  user: AuthUser | null;
  token: string | null;
  expiresAt: number | null;
  isAuthenticated: boolean;
}

interface AuthContextType extends AuthState {
  isLoading: boolean;
  error: string | null;
  login: () => void;
  logout: () => Promise<void>;
  clearError: () => void;
  getAuthHeader: () => Record<string, string>;
}

const AuthContext = createContext<AuthContextType | null>(null);

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? "";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    token: null,
    expiresAt: null,
    isAuthenticated: false,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [gisReady, setGisReady] = useState(false);
  const pollAbortRef = useRef<AbortController | null>(null);

  const saveSession = useCallback((data: AuthResponse) => {
    setState({
      user: data.user,
      token: data.token,
      expiresAt: data.expiresAt,
      isAuthenticated: true,
    });
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        token: data.token,
        user: data.user,
        expiresAt: data.expiresAt,
      })
    );
  }, []);

  const clearSession = useCallback(() => {
    setState({
      user: null,
      token: null,
      expiresAt: null,
      isAuthenticated: false,
    });
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  // Restore session from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        const now = Math.floor(Date.now() / 1000);
        if (parsed.expiresAt && parsed.expiresAt > now) {
          setState({
            user: parsed.user,
            token: parsed.token,
            expiresAt: parsed.expiresAt,
            isAuthenticated: true,
          });
        } else {
          localStorage.removeItem(STORAGE_KEY);
        }
      }
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
    setIsLoading(false);
  }, []);

  // Load Google Identity Services (skip in Tauri — GSI doesn't work in WKWebView)
  useEffect(() => {
    if (isTauriEnvironment()) {
      setIsLoading(false);
      return;
    }

    if (!GOOGLE_CLIENT_ID) {
      setError("Google Client ID not configured");
      setIsLoading(false);
      return;
    }

    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.onload = () => {
      window.google?.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: handleGoogleResponse,
        auto_select: false,
        cancel_on_tap_outside: true,
      });
      setGisReady(true);
    };
    script.onerror = () => {
      setError("Failed to load Google Sign-In");
      setIsLoading(false);
    };
    document.head.appendChild(script);

    return () => {
      script.remove();
    };
  }, []);

  const handleGoogleResponse = async (response: { credential: string }) => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await exchangeGoogleCredential(response.credential);
      saveSession(data);
    } catch (err: any) {
      setError(err.message || "Authentication failed");
    } finally {
      setIsLoading(false);
    }
  };

  // Inactivity timeout
  useEffect(() => {
    if (!state.isAuthenticated) return;

    let timeoutId: ReturnType<typeof setTimeout>;
    const resetTimer = () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        clearSession();
        setError("Session expired due to inactivity. Please sign in again.");
      }, INACTIVITY_TIMEOUT_MS);
    };

    const events = ["mousedown", "keydown", "touchstart", "scroll"];
    events.forEach((e) =>
      document.addEventListener(e, resetTimer, { passive: true })
    );
    resetTimer();

    return () => {
      clearTimeout(timeoutId);
      events.forEach((e) => document.removeEventListener(e, resetTimer));
    };
  }, [state.isAuthenticated, clearSession]);

  // Token auto-refresh
  useEffect(() => {
    if (!state.token || !state.expiresAt) return;

    const msUntilExpiry = state.expiresAt * 1000 - Date.now();
    const msUntilRefresh = msUntilExpiry - TOKEN_REFRESH_THRESHOLD_MS;

    // Don't clear session on refresh failure if token is still valid —
    // Google ID tokens can't be refreshed, so just let them expire naturally.
    const handleRefreshFailure = () => {
      const remaining = (state.expiresAt ?? 0) * 1000 - Date.now();
      if (remaining <= 0) {
        clearSession();
      }
    };

    if (msUntilRefresh <= 0 && msUntilExpiry > 0) {
      refreshToken(state.token)
        .then((data) => {
          setState((prev) => ({
            ...prev,
            token: data.token,
            expiresAt: data.expiresAt,
          }));
          const stored = localStorage.getItem(STORAGE_KEY);
          if (stored) {
            const parsed = JSON.parse(stored);
            parsed.token = data.token;
            parsed.expiresAt = data.expiresAt;
            localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
          }
        })
        .catch(handleRefreshFailure);
      return;
    }

    if (msUntilRefresh <= 0) return;

    const timerId = setTimeout(() => {
      if (state.token) {
        refreshToken(state.token)
          .then((data) => {
            setState((prev) => ({
              ...prev,
              token: data.token,
              expiresAt: data.expiresAt,
            }));
          })
          .catch(handleRefreshFailure);
      }
    }, msUntilRefresh);

    return () => clearTimeout(timerId);
  }, [state.token, state.expiresAt, clearSession]);

  // Tauri OAuth flow: open system browser, poll for result
  const loginWithTauri = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    pollAbortRef.current?.abort();
    const abortController = new AbortController();
    pollAbortRef.current = abortController;

    try {
      const { authUrl, sessionId } = await startOAuthFlow();
      await openInSystemBrowser(authUrl);
      const data = await pollAuthResult(sessionId, {
        signal: abortController.signal,
      });
      saveSession(data);
    } catch (err: any) {
      if (err.name !== "AbortError") {
        setError(err.message || "Authentication failed");
      }
    } finally {
      setIsLoading(false);
      pollAbortRef.current = null;
    }
  }, [saveSession]);

  const login = useCallback(() => {
    if (isTauriEnvironment()) {
      loginWithTauri();
      return;
    }

    if (!gisReady || !window.google) {
      setError("Google Sign-In is loading, please wait...");
      return;
    }
    setError(null);
    window.google.accounts.id.prompt((notification: any) => {
      if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
        const reason =
          notification.getNotDisplayedReason?.() ||
          notification.getSkippedReason?.();
        console.warn("[Auth] Google prompt issue:", reason);

        const buttonContainer = document.getElementById(
          "google-signin-fallback"
        );
        if (buttonContainer && window.google) {
          window.google.accounts.id.renderButton(buttonContainer, {
            theme: "outline",
            size: "large",
            width: 300,
          });
        }
      }
    });
  }, [gisReady, loginWithTauri]);

  const logout = useCallback(async () => {
    pollAbortRef.current?.abort();
    pollAbortRef.current = null;

    if (state.token) {
      await logoutFromServer(state.token);
    }
    if (!isTauriEnvironment() && state.user?.email && window.google) {
      window.google.accounts.id.revoke(state.user.email, () => {});
    }
    clearSession();
  }, [state.token, state.user, clearSession]);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      pollAbortRef.current?.abort();
    };
  }, []);

  const clearError = useCallback(() => setError(null), []);

  const getAuthHeader = useCallback((): Record<string, string> => {
    if (!state.token) return {};
    return { Authorization: `Bearer ${state.token}` };
  }, [state.token]);

  return (
    <AuthContext.Provider
      value={{
        ...state,
        isLoading,
        error,
        login,
        logout,
        clearError,
        getAuthHeader,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
