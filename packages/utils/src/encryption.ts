import CryptoJS from "crypto-js";

// ─────────────────────────────────────────────
// Encryption utilities for OTP codes and sensitive data
// Uses AES-256 with a key derived from environment
// ─────────────────────────────────────────────

/**
 * Encrypt a string value (e.g., OTP code) using AES-256-CBC.
 * Returns a base64-encoded ciphertext string.
 */
export function encrypt(plaintext: string, key: string): string {
  const encrypted = CryptoJS.AES.encrypt(plaintext, key).toString();
  return encrypted;
}

/**
 * Decrypt an AES-256-CBC ciphertext string back to plaintext.
 */
export function decrypt(ciphertext: string, key: string): string {
  const decrypted = CryptoJS.AES.decrypt(ciphertext, key);
  return decrypted.toString(CryptoJS.enc.Utf8);
}

/**
 * Hash a value using SHA-256 (one-way, for API key storage etc.).
 */
export function sha256(value: string): string {
  return CryptoJS.SHA256(value).toString();
}

/**
 * Generate a random hex string of the given byte length.
 */
export function randomHex(byteLength: number): string {
  return CryptoJS.lib.WordArray.random(byteLength).toString();
}