import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "crypto";

const ALGO = "aes-256-gcm";
const KEY_LEN = 32;
const NONCE_LEN = 12;
const TAG_LEN = 16;
const SCRYPT_SALT = "sahamati-cred-v1";

let cachedKey: Buffer | null = null;

export function getKey(): Buffer {
  if (cachedKey) return cachedKey;
  const secret = process.env.SAHAMATI_CRED_KEY;
  if (!secret || secret.length < 16) {
    throw new Error(
      "SAHAMATI_CRED_KEY is missing or too short. Set a strong secret (>=16 chars) in agent-server/.env to enable scan credentials."
    );
  }
  cachedKey = scryptSync(secret, SCRYPT_SALT, KEY_LEN);
  return cachedKey;
}

export function _resetKeyCacheForTests() {
  cachedKey = null;
}

export function encryptToken(plaintext: string): { ciphertext: Buffer; nonce: Buffer } {
  const nonce = randomBytes(NONCE_LEN);
  const cipher = createCipheriv(ALGO, getKey(), nonce);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { ciphertext: Buffer.concat([encrypted, tag]), nonce };
}

export function decryptToken(ciphertext: Buffer, nonce: Buffer): string {
  if (ciphertext.length < TAG_LEN) throw new Error("ciphertext too short");
  const tag = ciphertext.subarray(ciphertext.length - TAG_LEN);
  const body = ciphertext.subarray(0, ciphertext.length - TAG_LEN);
  const decipher = createDecipheriv(ALGO, getKey(), nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
}

/**
 * Constant-time fingerprint comparison helper. Inputs must be hex strings of
 * identical length.
 */
export function fingerprintsEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}
