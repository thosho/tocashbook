// ─── Hybrid Notification Service for ToCashBook ──────────────────────────────
// Supports both Native Android (Capacitor LocalNotifications) and Web Browser.
// Completely standalone and fail-safe; will never break core accounting logic.

import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';

export const NTFY_BASE = 'https://ntfy.sh';

// Notification IDs for Scheduled Tasks
const ID_DAILY_NUDGE = 1001;
const ID_WEEKLY_DUE = 1002;
const ID_LOW_BALANCE = 1003;
const ID_STAFF_ALERT = 1004;

/**
 * Request notification permissions across Android & Web.
 */
export const requestNotificationPermission = async () => {
  try {
    if (Capacitor.isNativePlatform()) {
      const res = await LocalNotifications.requestPermissions();
      return res.display === 'granted';
    } else if ('Notification' in window) {
      const permission = await Notification.requestPermission();
      return permission === 'granted';
    }
  } catch (e) {
    console.warn('Failed to request notification permissions:', e);
  }
  return false;
};

/**
 * Check current notification permission state.
 */
export const getNotificationPermission = () => {
  if (Capacitor.isNativePlatform()) {
    return 'granted'; // On native, we query or assume granted after request
  }
  if (!('Notification' in window)) return 'unsupported';
  return Notification.permission;
};

/**
 * Show an instant notification (used for test alerts, low balance, or staff updates).
 */
export const showInstantNotification = async ({ title, body, id = Math.floor(Math.random() * 10000) }) => {
  try {
    if (Capacitor.isNativePlatform()) {
      await LocalNotifications.schedule({
        notifications: [
          {
            title,
            body,
            id,
            schedule: { at: new Date(Date.now() + 1000) }, // fire in 1 sec
            sound: undefined,
            attachments: null,
            actionTypeId: '',
            extra: null,
          }
        ]
      });
    } else if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(title, {
        body,
        icon: '/pwa-192x192.png',
        badge: '/pwa-192x192.png',
      });
    }
  } catch (e) {
    console.warn('Could not fire instant notification:', e);
  }
};

/**
 * Subscribe to push notifications for a given ntfy topic.
 */
export const subscribePush = async (topic) => {
  if (!topic) return false;
  const granted = await requestNotificationPermission();
  if (!granted) return false;

  if (!Capacitor.isNativePlatform() && 'serviceWorker' in navigator) {
    try {
      const reg = await navigator.serviceWorker.ready;
      await reg.active?.postMessage({ type: 'NTFY_SUBSCRIBE', topic });
    } catch (_) {}
  }
  return true;
};

/**
 * Schedule or cancel Daily Evening "Close the Day" Register Reminder.
 */
export const configureDailyNudge = async (enabled, timeString = "20:30") => {
  if (!Capacitor.isNativePlatform()) return;
  try {
    // First clear existing alarm
    await LocalNotifications.cancel({ notifications: [{ id: ID_DAILY_NUDGE }] });

    if (String(enabled) === 'true' || enabled === true) {
      const [hourStr, minStr] = String(timeString).split(':');
      const hour = parseInt(hourStr || "20", 10);
      const minute = parseInt(minStr || "30", 10);

      const now = new Date();
      const scheduledTime = new Date();
      scheduledTime.setHours(hour, minute, 0, 0);
      if (scheduledTime <= now) {
        scheduledTime.setDate(scheduledTime.getDate() + 1);
      }

      await LocalNotifications.schedule({
        notifications: [
          {
            id: ID_DAILY_NUDGE,
            title: "📓 Close the Day Register",
            body: "Did you record today's cash transactions? Tap here to review today's Cash In & Out and reconcile your register!",
            schedule: {
              at: scheduledTime,
              repeats: true,
              every: 'day',
              allowWhileIdle: true
            }
          }
        ]
      });
    }
  } catch (e) {
    console.warn('Failed to configure Daily Nudge:', e);
  }
};

/**
 * Schedule or cancel Weekly Debt & Credit Collection Reminders.
 */
export const configureWeeklyDueAlert = async (enabled) => {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await LocalNotifications.cancel({ notifications: [{ id: ID_WEEKLY_DUE }] });

    if (String(enabled) === 'true' || enabled === true) {
      // Schedule for next Monday at 10:00 AM or 7 days from now at 10:00 AM
      const nextTime = new Date();
      nextTime.setDate(nextTime.getDate() + 7);
      nextTime.setHours(10, 0, 0, 0);

      await LocalNotifications.schedule({
        notifications: [
          {
            id: ID_WEEKLY_DUE,
            title: "⏰ Payment & Debt Reminders",
            body: "Check your customer ledger balances! Tap here to review pending dues and send instant WhatsApp collection notices.",
            schedule: {
              at: nextTime,
              repeats: true,
              every: 'week',
              allowWhileIdle: true
            }
          }
        ]
      });
    }
  } catch (e) {
    console.warn('Failed to configure Weekly Due Alert:', e);
  }
};

/**
 * Check if running balance is below threshold and fire a one-off warning alert.
 */
export const checkAndNotifyLowBalance = async (currentBalance, settings) => {
  try {
    if (String(settings?.LowBalanceAlertEnabled) !== 'true') return;
    const threshold = parseFloat(settings?.LowBalanceThreshold || '500');
    const bal = parseFloat(currentBalance || '0');

    if (bal <= threshold) {
      await showInstantNotification({
        title: "⚠️ Low Cash Warning",
        body: `Alert: Your running physical cashbook balance has dropped to ₹${bal} (Threshold: ₹${threshold}).`,
        id: ID_LOW_BALANCE
      });
    }
  } catch (e) {
    console.warn('Low balance check notification failed:', e);
  }
};

/**
 * Sync all scheduled alarms whenever user updates settings.
 */
export const syncAllNotificationSchedules = async (settings) => {
  try {
    const perm = await requestNotificationPermission();
    if (perm) {
      await configureDailyNudge(settings?.DailyNudgeEnabled === 'true', settings?.DailyNudgeTime || "20:30");
      await configureWeeklyDueAlert(settings?.WeeklyDueAlertsEnabled === 'true');
    }
  } catch (e) {
    console.warn('Sync notifications failed:', e);
  }
};
