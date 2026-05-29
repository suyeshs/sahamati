import { describe, it, expect, beforeEach } from "vitest";
import { encryptToken, decryptToken, fingerprintsEqual, _resetKeyCacheForTests } from "./credentials-crypto.js";

describe("credentials envelope encryption", () => {
  beforeEach(() => {
    process.env.SAHAMATI_CRED_KEY = "test-master-key-at-least-sixteen-chars";
    _resetKeyCacheForTests();
  });

  it("round-trips a bearer token", () => {
    const { ciphertext, nonce } = encryptToken("Bearer abc.def.ghi");
    expect(decryptToken(ciphertext, nonce)).toBe("Bearer abc.def.ghi");
  });

  it("produces a fresh nonce per encryption", () => {
    const a = encryptToken("same-plaintext");
    const b = encryptToken("same-plaintext");
    expect(a.nonce.equals(b.nonce)).toBe(false);
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
  });

  it("fails closed on a tampered ciphertext", () => {
    const { ciphertext, nonce } = encryptToken("secret");
    ciphertext[0] ^= 0x01;
    expect(() => decryptToken(ciphertext, nonce)).toThrow();
  });

  it("fails closed on a tampered nonce", () => {
    const { ciphertext, nonce } = encryptToken("secret");
    nonce[0] ^= 0x01;
    expect(() => decryptToken(ciphertext, nonce)).toThrow();
  });

  it("fails closed on a tampered auth tag", () => {
    const { ciphertext, nonce } = encryptToken("secret");
    ciphertext[ciphertext.length - 1] ^= 0x01;
    expect(() => decryptToken(ciphertext, nonce)).toThrow();
  });

  it("refuses to encrypt when SAHAMATI_CRED_KEY is missing", () => {
    delete process.env.SAHAMATI_CRED_KEY;
    _resetKeyCacheForTests();
    expect(() => encryptToken("x")).toThrow(/SAHAMATI_CRED_KEY/);
  });

  it("refuses to encrypt when SAHAMATI_CRED_KEY is too short", () => {
    process.env.SAHAMATI_CRED_KEY = "short";
    _resetKeyCacheForTests();
    expect(() => encryptToken("x")).toThrow(/SAHAMATI_CRED_KEY/);
  });

  it("decrypts with a fresh module load given the same secret (deterministic key derivation)", () => {
    const { ciphertext, nonce } = encryptToken("persistent-token");
    _resetKeyCacheForTests();
    expect(decryptToken(ciphertext, nonce)).toBe("persistent-token");
  });

  it("does NOT decrypt with a different secret", () => {
    const { ciphertext, nonce } = encryptToken("victim-token");
    process.env.SAHAMATI_CRED_KEY = "different-master-key-also-long-enough";
    _resetKeyCacheForTests();
    expect(() => decryptToken(ciphertext, nonce)).toThrow();
  });
});

describe("fingerprintsEqual", () => {
  it("returns true for identical fingerprints", () => {
    expect(fingerprintsEqual("a".repeat(64), "a".repeat(64))).toBe(true);
  });

  it("returns false for mismatched fingerprints of equal length", () => {
    expect(fingerprintsEqual("a".repeat(64), "b".repeat(64))).toBe(false);
  });

  it("returns false for fingerprints of different length", () => {
    expect(fingerprintsEqual("a".repeat(64), "a".repeat(62))).toBe(false);
  });
});
