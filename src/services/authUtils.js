// ─── PIN Hashing Utility ─────────────────────────────────────────────────────
// Uses Web Crypto API (SHA-256) — built into every browser, zero dependencies.
// Works offline. APK-compatible.

/**
 * Hash a plain-text PIN using SHA-256.
 * Returns a hex string like "a665a45920422f9d417e4867efdc4fb8a04a1f3fff1fa07e998e86f7f7a27ae3"
 */
export const hashPIN = async (pin) => {
  const encoder = new TextEncoder();
  const data = encoder.encode(String(pin));
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
};

/**
 * Verify a plain-text PIN against a stored hash.
 */
export const verifyPIN = async (plainPin, storedHash) => {
  // Support legacy plain-text PINs (no hash prefix)
  // If stored value looks like a 64-char hex string, compare hashes
  if (storedHash && storedHash.length === 64 && /^[0-9a-f]+$/.test(storedHash)) {
    const inputHash = await hashPIN(plainPin);
    return inputHash === storedHash;
  }
  // Legacy fallback: plain-text comparison (will be upgraded on next save)
  return String(plainPin) === String(storedHash);
};
