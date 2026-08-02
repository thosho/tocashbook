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
  if (storedHash && storedHash.length === 64 && /^[0-9a-fA-F]+$/.test(storedHash)) {
    const hashed = await hashPIN(plainPin);
    return hashed === storedHash;
  }
  return plainPin === storedHash;
};

// ─── PIN Security Lockout Logic ─────────────────────────────────────────────

const LOCKOUT_KEY = 'tcb_pin_lockout';
const MAX_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 60000; // 60 seconds

export const getLockoutStatus = () => {
  try {
    const data = JSON.parse(localStorage.getItem(LOCKOUT_KEY) || '{"count":0,"lockedUntil":0}');
    if (data.lockedUntil > Date.now()) {
      return { locked: true, remainingSeconds: Math.ceil((data.lockedUntil - Date.now()) / 1000) };
    }
    return { locked: false, remainingSeconds: 0 };
  } catch (e) {
    return { locked: false, remainingSeconds: 0 };
  }
};

export const recordFailedAttempt = () => {
  try {
    const data = JSON.parse(localStorage.getItem(LOCKOUT_KEY) || '{"count":0,"lockedUntil":0}');
    // If we are past the lock time, reset count before incrementing
    if (data.lockedUntil > 0 && data.lockedUntil <= Date.now()) {
      data.count = 0;
    }
    data.count += 1;
    if (data.count >= MAX_ATTEMPTS) {
      data.lockedUntil = Date.now() + LOCKOUT_DURATION_MS;
    }
    localStorage.setItem(LOCKOUT_KEY, JSON.stringify(data));
    return getLockoutStatus();
  } catch (e) {
    return { locked: false, remainingSeconds: 0 };
  }
};

export const resetFailedAttempts = () => {
  localStorage.removeItem(LOCKOUT_KEY);
};

// Global App Info — centralized so Settings, Splash, and Sidebar always match perfectly
export const APP_NAME = "Open Cashbook";
export const APP_TAGLINE = "Your financial data stays truly yours.";
export const APP_VERSION = "v1.0";

/**
 * Case-insensitive role validation to support Admin, Boss, Owner, or lowercased variations from Sheets.
 */
export const isAdminRole = (role) => {
  if (!role) return false;
  const r = String(role).trim().toLowerCase();
  return ['admin', 'boss', 'owner'].includes(r);
};
