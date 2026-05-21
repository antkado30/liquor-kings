import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  encryptCredential,
  decryptCredential,
  isEncryptedCredentialFormat,
  generateEncryptionKey,
} from "../src/lib/credential-encryption.js";

/**
 * Tests for credential-encryption.js — AES-256-GCM encryption of stored
 * MLCC passwords. Security-critical: a regression here either leaks
 * credentials or silently corrupts them. At hundreds of stores this is
 * hundreds of encrypted passwords riding on this one module.
 *
 * Covered: encrypt/decrypt roundtrip, IV uniqueness (no reuse), tamper
 * detection (GCM auth tag), output format, input validation, and key
 * handling (missing / malformed / wrong key).
 */

const ENV = "LK_CREDENTIAL_ENCRYPTION_KEY";
const TEST_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const OTHER_KEY =
  "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";

let savedKey;
beforeEach(() => {
  savedKey = process.env[ENV];
  process.env[ENV] = TEST_KEY;
});
afterEach(() => {
  if (savedKey === undefined) delete process.env[ENV];
  else process.env[ENV] = savedKey;
});

/** Flip the first hex char of a component to a different valid hex char. */
function flipHexChar(hex) {
  const replacement = hex[0] === "a" ? "b" : "a";
  return replacement + hex.slice(1);
}

describe("encrypt / decrypt roundtrip", () => {
  it("decrypts back to the original plaintext", () => {
    const secret = "myMlccPassword123";
    expect(decryptCredential(encryptCredential(secret))).toBe(secret);
  });

  it("handles unicode and special characters", () => {
    const secret = "p@ss wörd 🔑 \"'<>&;|";
    expect(decryptCredential(encryptCredential(secret))).toBe(secret);
  });

  it("handles a long passphrase", () => {
    const secret = "x".repeat(2000);
    expect(decryptCredential(encryptCredential(secret))).toBe(secret);
  });
});

describe("IV uniqueness — never reuse with the same key", () => {
  it("encrypting the same plaintext twice yields different ciphertext", () => {
    const a = encryptCredential("samePlaintext");
    const b = encryptCredential("samePlaintext");
    expect(a).not.toBe(b);
  });

  it("both independent encryptions still decrypt to the same value", () => {
    const a = encryptCredential("samePlaintext");
    const b = encryptCredential("samePlaintext");
    expect(decryptCredential(a)).toBe("samePlaintext");
    expect(decryptCredential(b)).toBe("samePlaintext");
  });
});

describe("tamper detection (GCM auth tag)", () => {
  it("a modified ciphertext component fails to decrypt — never returns garbage", () => {
    const parts = encryptCredential("realSecret").split(":");
    parts[3] = flipHexChar(parts[3]);
    expect(() => decryptCredential(parts.join(":"))).toThrow();
  });

  it("a modified auth tag fails to decrypt", () => {
    const parts = encryptCredential("realSecret").split(":");
    parts[2] = flipHexChar(parts[2]);
    expect(() => decryptCredential(parts.join(":"))).toThrow();
  });

  it("a modified IV fails to decrypt", () => {
    const parts = encryptCredential("realSecret").split(":");
    parts[1] = flipHexChar(parts[1]);
    expect(() => decryptCredential(parts.join(":"))).toThrow();
  });
});

describe("output format", () => {
  it("produces v1:<hex>:<hex>:<hex>", () => {
    const encoded = encryptCredential("secret");
    expect(encoded).toMatch(/^v1:[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/);
  });

  it("isEncryptedCredentialFormat recognizes its own output", () => {
    expect(isEncryptedCredentialFormat(encryptCredential("secret"))).toBe(true);
  });
});

describe("encryptCredential — input validation", () => {
  it("rejects non-string input", () => {
    expect(() => encryptCredential(123)).toThrow();
    expect(() => encryptCredential(null)).toThrow();
    expect(() => encryptCredential(undefined)).toThrow();
  });

  it("rejects an empty string", () => {
    expect(() => encryptCredential("")).toThrow();
  });
});

describe("decryptCredential — input validation", () => {
  it("rejects a non-v1-prefixed string", () => {
    expect(() => decryptCredential("not-encrypted")).toThrow();
  });

  it("rejects a string with the wrong number of parts", () => {
    expect(() => decryptCredential("v1:onlytwo")).toThrow();
    expect(() => decryptCredential("v1:a:b:c:d:e")).toThrow();
  });

  it("rejects a v1 string with a missing component", () => {
    expect(() => decryptCredential("v1::authtag:ciphertext")).toThrow();
  });
});

describe("isEncryptedCredentialFormat", () => {
  it("is false for plaintext and non-strings", () => {
    expect(isEncryptedCredentialFormat("plaintextpassword")).toBe(false);
    expect(isEncryptedCredentialFormat(null)).toBe(false);
    expect(isEncryptedCredentialFormat(12345)).toBe(false);
  });

  it("is false for a wrong-version prefix", () => {
    expect(isEncryptedCredentialFormat("v2:a:b:c")).toBe(false);
  });
});

describe("generateEncryptionKey", () => {
  it("returns 64 hex characters (32 bytes)", () => {
    const key = generateEncryptionKey();
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });

  it("returns a different key each call", () => {
    expect(generateEncryptionKey()).not.toBe(generateEncryptionKey());
  });

  it("a generated key works for a real encrypt/decrypt roundtrip", () => {
    process.env[ENV] = generateEncryptionKey();
    expect(decryptCredential(encryptCredential("works"))).toBe("works");
  });
});

describe("key handling", () => {
  it("throws when the key env var is not set", () => {
    delete process.env[ENV];
    expect(() => encryptCredential("secret")).toThrow(/not set/i);
  });

  it("throws when the key is the wrong length", () => {
    process.env[ENV] = "tooshort";
    expect(() => encryptCredential("secret")).toThrow(/hex chars/i);
  });

  it("throws when the key is not pure hex", () => {
    process.env[ENV] = "z".repeat(64);
    expect(() => encryptCredential("secret")).toThrow(/hex/i);
  });

  it("a value encrypted with one key cannot be decrypted with another", () => {
    const encoded = encryptCredential("secret");
    process.env[ENV] = OTHER_KEY;
    expect(() => decryptCredential(encoded)).toThrow();
  });
});
