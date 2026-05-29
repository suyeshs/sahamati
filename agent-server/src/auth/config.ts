export const AUTH_CONFIG = {
  get googleClientId() { return process.env.GOOGLE_CLIENT_ID ?? ""; },
  get googleClientSecret() { return process.env.GOOGLE_CLIENT_SECRET ?? ""; },
  allowedDomain: "sahamati.org.in",
  callbackUrl: "http://localhost:3001/auth/google/callback",
  googleAuthEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
  googleTokenEndpoint: "https://oauth2.googleapis.com/token",
  googleJwksUri: "https://www.googleapis.com/oauth2/v3/certs",
  sessionTtlMs: 5 * 60 * 1000,
  pollCleanupIntervalMs: 60 * 1000,
  // GitHub OAuth
  get githubClientId() { return process.env.GITHUB_CLIENT_ID ?? ""; },
  get githubClientSecret() { return process.env.GITHUB_CLIENT_SECRET ?? ""; },
  githubCallbackUrl: "http://localhost:3001/auth/github/callback",
  githubAuthEndpoint: "https://github.com/login/oauth/authorize",
  githubTokenEndpoint: "https://github.com/login/oauth/access_token",
  githubApiBase: "https://api.github.com",
};
