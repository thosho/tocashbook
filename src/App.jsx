import { useState, useEffect, useCallback, useRef } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Login from './components/Login';
import BossHome from './components/BossHome';
import StaffEntry from './components/StaffEntry';
import BossSettings from './components/BossSettings';
import Reports from './components/Reports';
import Parties from './components/Parties';
import SidebarLayout from './components/SidebarLayout';
import Entries from './components/Entries';
import SplashScreen from './components/SplashScreen';
import { initDb, getSettings } from './services/localDb';
import { AppProvider } from './context/AppContext';
import PWAPrompt from './components/PWAPrompt';
import { isAdminRole } from './services/authUtils';
import { GoogleOAuthProvider } from '@react-oauth/google';
import { useAutoTokenRefresh } from './services/tokenRefresh';

// ─── Session Persistence Helpers ──────────────────────────────────────────────
// Use sessionStorage so session survives page refresh but clears on tab close.
const SESSION_KEY = 'tcb_session';

const saveSession = (user) => {
  try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(user)); } catch (_) {}
};
const loadSession = () => {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (_) { return null; }
};
const clearSession = () => {
  try { sessionStorage.removeItem(SESSION_KEY); } catch (_) {}
};

function App() {
  // Restore previous session immediately so protected routes don't flash login
  const [authUser, setAuthUserState] = useState(() => loadSession());
  const [isDbReady, setIsDbReady] = useState(false);
  const [showSplash, setShowSplash] = useState(true);
  const [sessionTimeoutMins, setSessionTimeoutMins] = useState(30);
  const sessionTimer = useRef(null);

  // ── Auto-refresh the Google OAuth token silently in the background ──────────
  // Refreshes 10 min before expiry, retries pending syncs on 401, works on
  // both web and Android without any user interaction required.
  useAutoTokenRefresh();

  // Wrapper: keep sessionStorage in sync with React state
  const setAuthUser = useCallback((user) => {
    setAuthUserState(user);
    if (user) {
      saveSession(user);
    } else {
      clearSession();
    }
  }, []);

  useEffect(() => {
    const init = async () => {
      await initDb();
      const settings = await getSettings();

      // Apply saved dark mode on startup
      if (settings.DarkMode === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark');
      } else if (settings.DarkMode === 'light') {
        document.documentElement.setAttribute('data-theme', 'light');
      } else {
        document.documentElement.removeAttribute('data-theme');
      }

      setSessionTimeoutMins(parseInt(settings.SessionTimeout || '30', 10));
      setIsDbReady(true);
    };
    init();
  }, []);

  // ─── Session Timeout Logic ─────────────────────────────────────────────────
  // M5 FIX: always clear the previous timer before setting a new one to prevent
  // race conditions when sessionTimeoutMins or authUser changes rapidly.
  const resetSessionTimer = useCallback(() => {
    if (sessionTimer.current) {
      clearTimeout(sessionTimer.current);
      sessionTimer.current = null;
    }
    if (!authUser) return;
    const ms = sessionTimeoutMins * 60 * 1000;
    sessionTimer.current = setTimeout(() => {
      setAuthUser(null); // also clears sessionStorage via wrapper
      const banner = document.createElement('div');
      banner.innerText = '⏱ You were logged out due to inactivity.';
      Object.assign(banner.style, {
        position: 'fixed', top: '16px', left: '50%', transform: 'translateX(-50%)',
        background: '#1e293b', color: 'white', padding: '12px 24px',
        borderRadius: '12px', zIndex: '99999', fontSize: '0.875rem',
        boxShadow: '0 4px 20px rgba(0,0,0,0.4)', fontFamily: 'Outfit, sans-serif'
      });
      document.body.appendChild(banner);
      setTimeout(() => banner.remove(), 4000);
    }, ms);
  }, [authUser, sessionTimeoutMins, setAuthUser]);

  useEffect(() => {
    if (!authUser) {
      if (sessionTimer.current) {
        clearTimeout(sessionTimer.current);
        sessionTimer.current = null;
      }
      return;
    }
    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click'];
    events.forEach(e => window.addEventListener(e, resetSessionTimer, { passive: true }));
    resetSessionTimer(); // start timer
    return () => {
      events.forEach(e => window.removeEventListener(e, resetSessionTimer));
      if (sessionTimer.current) {
        clearTimeout(sessionTimer.current);
        sessionTimer.current = null;
      }
    };
  }, [authUser, resetSessionTimer]);

  // Loading state (before splash screen)
  if (!isDbReady) {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column', justifyContent: 'center',
        alignItems: 'center', height: '100vh', gap: '16px',
        background: 'linear-gradient(135deg, #1e1b4b 0%, #4f46e5 100%)'
      }}>
        <div style={{
          width: '40px', height: '40px', border: '4px solid rgba(255,255,255,0.2)',
          borderTop: '4px solid white', borderRadius: '50%',
          animation: 'spin 1s linear infinite'
        }} />
      </div>
    );
  }

  return (
    <>
      {showSplash && <SplashScreen onDone={() => setShowSplash(false)} />}
      <AppProvider>
        <Router>
          <Routes>
            <Route path="/" element={<Login setAuthUser={setAuthUser} setSessionTimeout={setSessionTimeoutMins} />} />

            {/* Boss Protected Routes */}
            <Route element={isAdminRole(authUser?.Role) ? <SidebarLayout /> : <Navigate to="/" />}>
              <Route path="/dashboard" element={<BossHome user={authUser} setAuthUser={setAuthUser} />} />
              <Route path="/entry" element={<StaffEntry user={authUser} setAuthUser={setAuthUser} />} />
              <Route path="/entries" element={<Entries />} />
              <Route path="/reports" element={<Reports />} />
              {/* C4 FIX: pass user prop so Parties knows who is acting */}
              <Route path="/parties" element={<Parties user={authUser} />} />
              <Route path="/settings" element={<BossSettings setSessionTimeout={setSessionTimeoutMins} setAuthUser={setAuthUser} />} />
            </Route>

            {/* Staff Only Route */}
            <Route
              path="/staff-entry"
              element={
                authUser && !isAdminRole(authUser?.Role)
                  ? <StaffEntry user={authUser} setAuthUser={setAuthUser} />
                  : <Navigate to="/" />
              }
            />
          </Routes>
        </Router>
        <PWAPrompt />
      </AppProvider>
    </>
  );
}

export default function AppWrapper() {
  return (
    <GoogleOAuthProvider clientId="830225285550-9in8dfbgur29a5f0hk7hmnui14hf3vhb.apps.googleusercontent.com">
      <App />
    </GoogleOAuthProvider>
  );
}
