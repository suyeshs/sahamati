import { TOTP, Secret } from "otpauth";

const ISSUER = "Sahamati";
const ALGORITHM = "SHA1";
const DIGITS = 6;
const PERIOD = 30;

/**
 * Generate a new TOTP secret (base32-encoded).
 */
export function generateTotpSecret(): string {
  const secret = new Secret({ size: 20 });
  return secret.base32;
}

/**
 * Build the otpauth:// URI for provisioning into an authenticator app.
 */
export function buildTotpUri(secret: string, email: string): string {
  const totp = new TOTP({
    issuer: ISSUER,
    label: email,
    algorithm: ALGORITHM,
    digits: DIGITS,
    period: PERIOD,
    secret: Secret.fromBase32(secret),
  });
  return totp.toString();
}

/**
 * Verify a TOTP code. Returns true if valid within a +-1 window.
 */
export function verifyTotpCode(secret: string, code: string): boolean {
  const totp = new TOTP({
    issuer: ISSUER,
    algorithm: ALGORITHM,
    digits: DIGITS,
    period: PERIOD,
    secret: Secret.fromBase32(secret),
  });

  const delta = totp.validate({ token: code, window: 1 });
  return delta !== null;
}
