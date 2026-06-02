import { createRemoteJWKSet, jwtVerify } from "jose";
import { AUTH_CONFIG } from "./config.js";

const JWKS = createRemoteJWKSet(new URL(AUTH_CONFIG.googleJwksUri));

interface GoogleTokenResponse {
  access_token: string;
  id_token: string;
  expires_in: number;
  token_type: string;
  scope: string;
  refresh_token?: string;
}

export interface GoogleIdTokenPayload {
  iss: string;
  azp: string;
  aud: string;
  sub: string;
  email: string;
  email_verified: boolean;
  name: string;
  picture: string;
  hd: string;
  nonce: string;
  iat: number;
  exp: number;
}

export async function exchangeCodeForTokens(
  code: string,
  codeVerifier: string
): Promise<GoogleTokenResponse> {
  const body = new URLSearchParams({
    code,
    client_id: AUTH_CONFIG.googleClientId,
    client_secret: AUTH_CONFIG.googleClientSecret,
    redirect_uri: AUTH_CONFIG.callbackUrl,
    grant_type: "authorization_code",
    code_verifier: codeVerifier,
  });

  const response = await fetch(AUTH_CONFIG.googleTokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`Token exchange failed: ${response.status} - ${errBody}`);
  }

  return response.json() as Promise<GoogleTokenResponse>;
}

export async function verifyIdToken(
  idToken: string,
  expectedNonce: string
): Promise<GoogleIdTokenPayload> {
  const { payload } = await jwtVerify(idToken, JWKS, {
    issuer: ["https://accounts.google.com", "accounts.google.com"],
    audience: AUTH_CONFIG.googleClientId,
  });

  const claims = payload as unknown as GoogleIdTokenPayload;

  if (claims.nonce !== expectedNonce) {
    throw new Error("Nonce mismatch - possible replay attack");
  }

  if (!claims.email_verified) {
    throw new Error("Email not verified");
  }

  if (claims.hd !== AUTH_CONFIG.allowedDomain) {
    throw new Error(
      `Access restricted to @${AUTH_CONFIG.allowedDomain} accounts. Got: @${claims.hd ?? "unknown"}`
    );
  }

  return claims;
}

/**
 * Verify a Google ID token presented on an ordinary API request (not the login
 * handshake). Identical to verifyIdToken but without the one-time login nonce —
 * jwtVerify still enforces the signature, issuer, audience, and expiry, and we
 * re-check the verified-email and domain claims. This is the trust anchor for
 * authMiddleware: identity comes from here, never from a client-supplied header.
 */
export async function verifySessionToken(
  idToken: string
): Promise<GoogleIdTokenPayload> {
  const { payload } = await jwtVerify(idToken, JWKS, {
    issuer: ["https://accounts.google.com", "accounts.google.com"],
    audience: AUTH_CONFIG.googleClientId,
  });

  const claims = payload as unknown as GoogleIdTokenPayload;

  if (!claims.email_verified) {
    throw new Error("Email not verified");
  }

  if (claims.hd !== AUTH_CONFIG.allowedDomain) {
    throw new Error(
      `Access restricted to @${AUTH_CONFIG.allowedDomain} accounts. Got: @${claims.hd ?? "unknown"}`
    );
  }

  return claims;
}
