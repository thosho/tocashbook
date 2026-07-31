// ─── PIN Hashing Utility ─────────────────────────────────────────────────────
// Uses Web Crypto API (SHA-256) — built into every browser, zero dependencies.
// Works offline. APK-compatible.

/**
 * Hash a plain-text PIN using SHA-256.
 * Returns a hex string like "a665a45920422f9d417e4867efdc4fb8a04a1f3fff1fa07e998e86f7f7a27ae3"
 */
export const hashPIN = async (pin) => {
  const str = String(pin);
  if (typeof crypto !== 'undefined' && crypto.subtle && typeof crypto.subtle.digest === 'function') {
    try {
      const encoder = new TextEncoder();
      const data = encoder.encode(str);
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    } catch (e) {
      console.warn('crypto.subtle failed, using pure-JS fallback', e);
    }
  }
  // Pure-JS deterministic 64-char hex string fallback for plain HTTP local network testing
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
  }
  const part = Math.abs(hash).toString(16).padStart(8, '0');
  return (part + 'f0e1d2c3b4a59687' + part + '0a1b2c3d4e5f6071' + part + '89abcdef01234567').slice(0, 64);
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

// Global App Info — centralized so Settings and Sidebar version numbers always match perfectly
export const APP_NAME = "ToCashBook";
export const APP_VERSION = "v1.0";
