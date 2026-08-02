// src/services/tokenRefresh.js
// ─────────────────────────────────────────────────────────────────────────────
// Automatic Google OAuth Token Refresh
//
// Google access tokens expire after 1 hour. This hook:
//   1. Checks on every app open/page load if the token is near expiry.
//   2. Refreshes silently 10 minutes BEFORE it expires (user never notices).
//   3. Listens for 401 "token expired" events fired from sheetsApi.js and
//      immediately gets a fresh token, then retries all pending syncs.
//
// Works on both web (via @react-oauth/google silent prompt) and Android
// (via native GoogleSignIn silent cached credentials).
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useCallback, useRef } from 'react';
import { useGoogleLogin } from '@react-oauth/google';
import localforage from 'localforage';
import { Capacitor } from '@capacitor/core';
import { GoogleSignIn } from '@capawesome/capacitor-google-sign-in';
import { syncOfflineTransactions, syncPendingEdits, syncPendingDeletes } from './sheetsApi';

const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/script.projects',
  'https://www.googleapis.com/auth/script.deployments',
  'https://www.googleapis.com/auth/drive.file',
].join(' ');

// How many ms before expiry to proactively refresh (10 minutes)
const REFRESH_BUFFER_MS = 10 * 60 * 1000;
// How often to check if the token is nearing expiry (every 5 minutes)
const CHECK_INTERVAL_MS = 5 * 60 * 1000;

/**
 * After a fresh token is saved, immediately retry all pending syncs.
 * Entries that were "Pending" due to an expired token sync within seconds.
 */
const retryPendingSync = async () => {
  try {
    await syncOfflineTransactions();
    await syncPendingEdits();
    await syncPendingDeletes();
    console.log('[TokenRefresh] Retried pending syncs after token refresh.');
  } catch (e) {
    console.warn('[TokenRefresh] Pending sync retry failed:', e.message);
  }
};

/**
 * useAutoTokenRefresh
 *
 * Drop this hook in App.jsx (inside GoogleOAuthProvider) to automatically
 * keep the Google OAuth token fresh for as long as the app is open.
 */
export function useAutoTokenRefresh() {
  const isRefreshing = useRef(false);

  // ── Web: silent token refresh via @react-oauth/google ──────────────────────
  const webRefresh = useGoogleLogin({
    onSuccess: async (tokenResponse) => {
      console.log('[TokenRefresh] Token refreshed silently (web).');
      await localforage.setItem('googleAccessToken', tokenResponse.access_token);
      await localforage.setItem('googleTokenExpiry', Date.now() + 55 * 60 * 1000);
      isRefreshing.current = false;
      retryPendingSync();
    },
    onError: (err) => {
      console.warn('[TokenRefresh] Silent web refresh failed:', err);
      isRefreshing.current = false;
    },
    scope: SCOPES,
    // Empty prompt = completely silent, no popup, no UI at all.
    // Google will use the cached consent from the original sign-in.
    prompt: '',
    flow: 'implicit',
  });

  // ── Android: silent refresh via native GoogleSignIn ─────────────────────────
  const nativeRefresh = useCallback(async () => {
    try {
      console.log('[TokenRefresh] Attempting native silent sign-in...');
      const result = await GoogleSignIn.signIn();
      if (result.accessToken) {
        await localforage.setItem('googleAccessToken', result.accessToken);
        await localforage.setItem('googleTokenExpiry', Date.now() + 55 * 60 * 1000);
        console.log('[TokenRefresh] Token refreshed silently (Android native).');
        retryPendingSync();
      }
    } catch (err) {
      console.warn('[TokenRefresh] Native silent refresh failed:', err.message);
    } finally {
      isRefreshing.current = false;
    }
  }, []);

  // ── Main refresh dispatcher ─────────────────────────────────────────────────
  const doRefresh = useCallback(async () => {
    if (isRefreshing.current) return; // prevent concurrent attempts

    const spreadsheetId = await localforage.getItem('spreadsheetId');
    if (!spreadsheetId) return; // Google setup not done yet

    isRefreshing.current = true;
    console.log('[TokenRefresh] Refreshing Google access token...');

    if (Capacitor.isNativePlatform()) {
      await nativeRefresh();
    } else {
      webRefresh({ prompt: '' });
    }
  }, [webRefresh, nativeRefresh]);

  // ── Token expiry check ──────────────────────────────────────────────────────
  const checkAndRefresh = useCallback(async () => {
    const spreadsheetId = await localforage.getItem('spreadsheetId');
    if (!spreadsheetId) return; // not set up yet

    const expiry = await localforage.getItem('googleTokenExpiry');
    if (!expiry) {
      doRefresh(); // no expiry stored, refresh immediately to be safe
      return;
    }

    const msLeft = expiry - Date.now();
    if (msLeft < REFRESH_BUFFER_MS) {
      console.log(`[TokenRefresh] Token expires in ${Math.round(msLeft / 60000)} min, refreshing now.`);
      doRefresh();
    }
  }, [doRefresh]);

  useEffect(() => {
    // Check immediately on mount (covers page loads and app opens)
    checkAndRefresh();

    // Check every 5 minutes in the background
    const interval = setInterval(checkAndRefresh, CHECK_INTERVAL_MS);

    // Listen for 401 signals dispatched by sheetsApi.js when a sync fails
    const onTokenExpired = () => {
      console.log('[TokenRefresh] 401 received — refreshing token immediately.');
      doRefresh();
    };
    window.addEventListener('google-token-expired', onTokenExpired);

    // Refresh when the user returns to the tab after a long absence
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') checkAndRefresh();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      clearInterval(interval);
      window.removeEventListener('google-token-expired', onTokenExpired);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [checkAndRefresh, doRefresh]);
}
