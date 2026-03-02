import { useAuth } from "../context/AuthContext";
import { isTauriEnvironment } from "../context/tauri-auth";

export default function Login() {
  const { login, isLoading, error, clearError } = useAuth();
  const isTauri = isTauriEnvironment();

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-header">
          <img
            src="/sahamati-logo.png"
            alt="Sahamati"
            className="login-logo"
          />
          <p>Development Process Framework</p>
        </div>

        <div className="login-body">
          <h2>Sign in</h2>
          <p className="login-hint">
            Use your <strong>@sahamati.org.in</strong> Google account to
            continue.
          </p>

          {error && (
            <div className="login-error">
              <span>{error}</span>
              <button className="login-error-dismiss" onClick={clearError}>
                Dismiss
              </button>
            </div>
          )}

          <button
            className="login-google-btn"
            onClick={login}
            disabled={isLoading}
          >
            <svg width="18" height="18" viewBox="0 0 18 18">
              <path
                d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 01-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"
                fill="#4285F4"
              />
              <path
                d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z"
                fill="#34A853"
              />
              <path
                d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"
                fill="#FBBC05"
              />
              <path
                d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"
                fill="#EA4335"
              />
            </svg>
            {isLoading
              ? isTauri
                ? "Waiting for browser..."
                : "Signing in..."
              : "Sign in with Google"}
          </button>

          {isLoading && isTauri && (
            <p className="login-tauri-hint">
              Complete sign-in in your browser, then return here.
            </p>
          )}

          {!isTauri && (
            <div id="google-signin-fallback" className="login-fallback" />
          )}
        </div>
      </div>
    </div>
  );
}
