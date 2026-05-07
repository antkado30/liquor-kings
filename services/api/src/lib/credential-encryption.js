import crypto from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH_BYTES = 12;
const KEY_LENGTH_BYTES = 32;
const VERSION = "v1";

/**
 * AES-256-GCM credential encryption.
 *
 * Storage format: "v1:<iv_hex>:<authTag_hex>:<ciphertext_hex>"
 * - iv (12 bytes) is randomly generated per encryption call (never reuse with same key)
 * - authTag (16 bytes) authenticates ciphertext — required for decryption
 * - ciphertext is variable length
 *
 * Key MUST be 32 bytes (64 hex chars) supplied via LK_CREDENTIAL_ENCRYPTION_KEY env var.
 * Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 *
 * NEVER log plaintext or ciphertext. NEVER persist the key in source.
 */

function getKey() {
  const hex = process.env.LK_CREDENTIAL_ENCRYPTION_KEY;
  if (!hex) {
    throw new Error("LK_CREDENTIAL_ENCRYPTION_KEY env var not set");
  }
  if (hex.length !== KEY_LENGTH_BYTES * 2) {
    throw new Error(
      `LK_CREDENTIAL_ENCRYPTION_KEY must be ${KEY_LENGTH_BYTES * 2} hex chars (got ${hex.length})`,
    );
  }
  if (!/^[0-9a-fA-F]+$/.test(hex)) {
    throw new Error("LK_CREDENTIAL_ENCRYPTION_KEY must be pure hex");
  }
  return Buffer.from(hex, "hex");
}

export function encryptCredential(plaintext) {
  if (typeof plaintext !== "string" || plaintext === "") {
    throw new Error("encryptCredential requires non-empty string");
  }
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return `${VERSION}:${iv.toString("hex")}:${authTag.toString("hex")}:${ciphertext.toString("hex")}`;
}

export function decryptCredential(encoded) {
  if (typeof encoded !== "string" || !encoded.startsWith(`${VERSION}:`)) {
    throw new Error(`decryptCredential expects ${VERSION}-encoded string`);
  }
  const parts = encoded.split(":");
  if (parts.length !== 4) {
    throw new Error(
      "Malformed encrypted credential — expected 4 colon-delimited parts",
    );
  }
  const [, ivHex, authTagHex, ciphertextHex] = parts;
  if (!ivHex || !authTagHex || !ciphertextHex) {
    throw new Error("Malformed encrypted credential — missing component(s)");
  }
  const key = getKey();
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const ciphertext = Buffer.from(ciphertextHex, "hex");
  if (iv.length !== IV_LENGTH_BYTES) {
    throw new Error(`Decryption IV must be ${IV_LENGTH_BYTES} bytes`);
  }
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}

export function isEncryptedCredentialFormat(value) {
  return (
    typeof value === "string" &&
    value.startsWith(`${VERSION}:`) &&
    value.split(":").length === 4
  );
}

export function generateEncryptionKey() {
  return crypto.randomBytes(KEY_LENGTH_BYTES).toString("hex");
}
