import { AUTH_CONFIG } from "./config.js";

export interface AuthResult {
  token: string;
  user: {
    email: string;
    name: string;
    picture: string;
    domain: string;
  };
  expiresAt: number;
}

export interface PendingSession {
  sessionId: string;
  state: string;
  nonce: string;
  codeVerifier: string;
  createdAt: number;
  result: AuthResult | null;
  error: string | null;
}

const sessions = new Map<string, PendingSession>();

export function createPendingSession(session: PendingSession): void {
  sessions.set(session.sessionId, session);
}

export function getPendingSession(
  sessionId: string
): PendingSession | undefined {
  return sessions.get(sessionId);
}

export function getPendingSessionByState(
  state: string
): PendingSession | undefined {
  for (const session of sessions.values()) {
    if (session.state === state) return session;
  }
  return undefined;
}

export function updateSessionResult(
  sessionId: string,
  result: AuthResult
): void {
  const session = sessions.get(sessionId);
  if (session) {
    session.result = result;
  }
}

export function updateSessionError(sessionId: string, error: string): void {
  const session = sessions.get(sessionId);
  if (session) {
    session.error = error;
  }
}

export function deleteSession(sessionId: string): void {
  sessions.delete(sessionId);
}

export function startSessionCleanup(): void {
  setInterval(() => {
    const now = Date.now();
    for (const [id, session] of sessions) {
      if (now - session.createdAt > AUTH_CONFIG.sessionTtlMs) {
        sessions.delete(id);
      }
    }
  }, AUTH_CONFIG.pollCleanupIntervalMs);
}
