// ─── Notification Service for ToCashBook ────────────────────────────────────
// Uses ntfy.sh (free, no account needed) — boss sets a unique topic
// and subscribes. Apps Script POSTs there when staff adds an entry.

export const NTFY_BASE = 'https://ntfy.sh';

/**
 * Subscribe to push notifications for a given ntfy topic.
 * Returns true if permission granted, false otherwise.
 */
export const subscribePush = async (topic) => {
  if (!('Notification' in window)) return false;
  if (!topic) return false;

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return false;

  // Register service worker to handle push messages from ntfy
  if ('serviceWorker' in navigator) {
    try {
      const reg = await navigator.serviceWorker.ready;
      // Subscribe to ntfy via EventSource (Server-Sent Events) handled in SW
      // We store the topic so SW knows where to listen
      await reg.active?.postMessage({ type: 'NTFY_SUBSCRIBE', topic });
    } catch (_) {}
  }

  return true;
};

/**
 * Show a local notification immediately (used for testing).
 */
export const showLocalNotification = (title, body) => {
  if (Notification.permission === 'granted') {
    new Notification(title, {
      body,
      icon: '/pwa-192x192.png',
      badge: '/pwa-192x192.png',
    });
  }
};

/**
 * Check current notification permission state.
 */
export const getNotificationPermission = () => {
  if (!('Notification' in window)) return 'unsupported';
  return Notification.permission; // 'granted' | 'denied' | 'default'
};
