import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getUsers, getApiLink, setApiLink, initDb, getSettings, getApiSecret, setApiSecret } from '../services/localDb';
import { fetchAllData } from '../services/sheetsApi';
import { verifyPIN, APP_NAME, APP_TAGLINE, isAdminRole } from '../services/authUtils';
import { Wallet, Settings, Link as LinkIcon, LogIn, Building2, ChevronDown, Plus, Trash2, Key } from 'lucide-react';
import localforage from 'localforage';
import { useTranslation } from 'react-i18next';
import LanguageSelector from './LanguageSelector';
import { useGoogleLogin } from '@react-oauth/google';
import { setupGoogleBackend } from '../services/googleSetup';

// Branch management helpers (stored separately from main data)
const getBranches = async () => (await localforage.getItem('branches')) || [];
const saveBranches = async (b) => localforage.setItem('branches', b);

export default function Login({ setAuthUser, setSessionTimeout }) {
  const [username, setUsername] = useState('');
  const [pin, setPin] = useState('');
  const [apiLinkState, setApiLinkState] = useState('');
  const [apiSecretState, setApiSecretState] = useState('');
  const [showSetup, setShowSetup] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Multi-branch state
  const [branches, setBranches] = useState([]);
  const [activeBranch, setActiveBranch] = useState(null);
  const [showBranchPicker, setShowBranchPicker] = useState(false);
  const [newBranchName, setNewBranchName] = useState('');
  const [newBranchUrl, setNewBranchUrl] = useState('');
  const [addingBranch, setAddingBranch] = useState(false);

  const { t } = useTranslation();
  const navigate = useNavigate();

  const handleGoogleSetup = useGoogleLogin({
    onSuccess: async (tokenResponse) => {
      setLoading(true);
      setError('');
      try {
        const { webAppUrl, apiSecret } = await setupGoogleBackend(tokenResponse.access_token);
        setApiLinkState(webAppUrl);
        setApiSecretState(apiSecret);
        
        await setApiLink(webAppUrl);
        await setApiSecret(apiSecret);
        await initDb();
        await fetchAllData();
        setShowSetup(false);
      } catch (err) {
        console.error(err);
        if (err.message.includes('https://script.google.com/home/usersettings')) {
          setError(
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <strong>Google requires one final step:</strong>
              <span>Please click the link below to allow your account to create the script, turn the switch to <b>ON</b>, and then click Automated Setup again.</span>
              <a href="https://script.google.com/home/usersettings" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--primary)', fontWeight: 'bold', textDecoration: 'underline' }}>
                👉 Open Apps Script Settings
              </a>
            </div>
          );
        } else {
          setError('Google Setup failed: ' + err.message);
        }
      }
      setLoading(false);
    },
    scope: 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/script.projects https://www.googleapis.com/auth/script.deployments https://www.googleapis.com/auth/drive.file'
  });

  useEffect(() => {
    initializeLogin();
  }, []);

  const initializeLogin = async () => {
    const savedBranches = await getBranches();
    setBranches(savedBranches);

    const link = await getApiLink();
    const secret = await getApiSecret();
    if (!link) {
      setShowSetup(true);
    } else {
      setApiLinkState(link);
      setApiSecretState(secret || '');
      // Find active branch from saved link
      const match = savedBranches.find(b => b.url === link);
      setActiveBranch(match || null);
    }
  };

  const handleSetup = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await setApiLink(apiLinkState);
      await setApiSecret(apiSecretState);
      await initDb();
      await fetchAllData();
      setShowSetup(false);
    } catch (err) {
      setError('Failed to connect: ' + err.message);
    }
    setLoading(false);
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    const users = await getUsers();

    // If no users are set up yet, guide them to the setup screen
    if (users.length === 0) {
      setError('No account found. Please connect your Google Sheet using the "API Link" button below.');
      return;
    }

    // Find user by Phone, Username, or Name (case-insensitive & safe against undefined)
    const cleanUsername = String(username).trim().toLowerCase();
    const user = users.find(u => 
      String(u.Phone || '').trim().toLowerCase() === cleanUsername ||
      String(u.Username || '').trim().toLowerCase() === cleanUsername ||
      String(u.Name || '').trim().toLowerCase() === cleanUsername
    );
    if (!user) { setError('Invalid phone/username or PIN'); return; }
    if (user.IsActive === 'FALSE' || user.IsActive === false) {
      setError('Account is disabled. Contact your boss.'); return;
    }

    // Verify PIN (supports both hashed and legacy plain-text)
    const pinMatch = await verifyPIN(pin, String(user.PIN));
    if (!pinMatch) { setError('Invalid username or PIN'); setPin(''); return; } // BUG-L1 FIX: Clear PIN on fail

    // Load session timeout from settings
    const settings = await getSettings();
    if (setSessionTimeout) setSessionTimeout(parseInt(settings.SessionTimeout || '30', 10));

    setAuthUser(user);
    navigate(isAdminRole(user.Role) ? '/dashboard' : '/staff-entry');
  };

  // ─── Branch Management ────────────────────────────────────────────────────
  const handleAddBranch = async () => {
    if (!newBranchName.trim() || !newBranchUrl.trim()) return;
    setAddingBranch(true);
    try {
      const branch = { id: 'br_' + Date.now(), name: newBranchName.trim(), url: newBranchUrl.trim() };
      const updated = [...branches, branch];
      await saveBranches(updated);
      setBranches(updated);
      setNewBranchName('');
      setNewBranchUrl('');
    } catch (err) {
      setError('Could not save branch: ' + err.message);
    }
    setAddingBranch(false);
  };

  const handleSwitchBranch = async (branch) => {
    const pSync = (await localforage.getItem('pendingSync')) || [];
    const pEdits = (await localforage.getItem('pendingEdits')) || [];
    const pDeletes = (await localforage.getItem('pendingDeletes')) || [];
    if (pSync.length > 0 || pEdits.length > 0 || pDeletes.length > 0) {
      setError('⚠️ You have unsynced offline transactions! Please connect to the internet and sync before switching branches.');
      return;
    }

    setLoading(true);
    try {
      await setApiLink(branch.url);
      // BUG-L2 FIX: Clear local transactions/users when switching branches to prevent data mixing
      await localforage.setItem('transactions', []);
      await localforage.setItem('users', []);
      await localforage.setItem('pendingSync', []);
      await localforage.setItem('pendingEdits', []);
      await localforage.setItem('pendingDeletes', []);
      await localforage.setItem('activeBookId', 'book_main');
      await fetchAllData();
      setActiveBranch(branch);
      setApiLinkState(branch.url);
      setShowSetup(false);
      setShowBranchPicker(false);
      setError('');
    } catch (err) {
      setError('Could not switch to "' + branch.name + '": ' + err.message);
    }
    setLoading(false);
  };

  const handleDeleteBranch = async (id) => {
    const updated = branches.filter(b => b.id !== id);
    await saveBranches(updated);
    setBranches(updated);
  };

  return (
    <div className="container" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100dvh', padding: '16px' }}>
      <div className="glass card animate-fade-in" style={{ width: '100%', maxWidth: '420px', padding: '36px 32px' }}>

        {/* Logo */}
        <div className="text-center mb-4">
          <div style={{
            width: '64px', height: '64px', margin: '0 auto 16px',
            borderRadius: '18px', background: 'linear-gradient(135deg, #4f46e5, #7c3aed)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 8px 24px rgba(79,70,229,0.35)'
          }}>
            <Wallet size={30} color="white" />
          </div>
          <h1 style={{ fontSize: '1.75rem', margin: '0 0 4px', fontWeight: '700' }}>{APP_NAME}</h1>
          <p style={{ color: 'var(--primary)', fontSize: '0.8rem', fontWeight: '600', margin: '0 0 6px 0', letterSpacing: '0.3px' }}>
            {APP_TAGLINE}
          </p>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', margin: 0 }}>
            {showSetup ? 'Connect your business' : t('login.title')}
          </p>
        </div>

        {/* Language Switcher */}
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '24px' }}>
          <LanguageSelector />
        </div>

        {/* Active Branch Indicator */}
        {!showSetup && branches.length > 0 && (
          <button
            onClick={() => setShowBranchPicker(!showBranchPicker)}
            style={{
              width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              gap: '8px', padding: '10px 14px', marginBottom: '16px',
              background: 'var(--bg-color)', border: '1.5px solid var(--border-color)',
              borderRadius: '10px', cursor: 'pointer', fontFamily: 'inherit'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Building2 size={16} color="var(--primary)" />
              <span style={{ fontWeight: '600', fontSize: '0.875rem', color: 'var(--text-primary)' }}>
                {activeBranch?.name || 'Default Branch'}
              </span>
            </div>
            <ChevronDown size={16} color="var(--text-secondary)" style={{ transform: showBranchPicker ? 'rotate(180deg)' : '', transition: '0.2s' }} />
          </button>
        )}

        {/* Branch Picker */}
        {showBranchPicker && (
          <div className="animate-fade-in" style={{ background: 'var(--bg-color)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '12px', marginBottom: '16px' }}>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '10px', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Your Branches
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '12px' }}>
              {branches.map(b => (
                <div key={b.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', borderRadius: '8px', background: activeBranch?.id === b.id ? 'rgba(79,70,229,0.1)' : 'transparent', border: activeBranch?.id === b.id ? '1px solid var(--primary)' : '1px solid transparent' }}>
                  <button onClick={() => handleSwitchBranch(b)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontWeight: '600', color: activeBranch?.id === b.id ? 'var(--primary)' : 'var(--text-primary)', fontFamily: 'inherit', fontSize: '0.875rem' }}>
                    {b.name} {activeBranch?.id === b.id && '✓'}
                  </button>
                  <button onClick={() => handleDeleteBranch(b.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', padding: '2px 4px' }}>
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
            {/* Add new branch */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', paddingTop: '10px', borderTop: '1px solid var(--border-color)' }}>
              <p style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', margin: '0 0 4px' }}>Add another branch / location:</p>
              <input value={newBranchName} onChange={e => setNewBranchName(e.target.value)} placeholder="Branch name (e.g. Main Store)" style={{ padding: '8px 10px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--surface-color)', color: 'var(--text-primary)', fontFamily: 'inherit', fontSize: '0.82rem' }} />
              <input value={newBranchUrl} onChange={e => setNewBranchUrl(e.target.value)} placeholder="API Link for this branch" style={{ padding: '8px 10px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--surface-color)', color: 'var(--text-primary)', fontFamily: 'inherit', fontSize: '0.82rem' }} />
              <button onClick={handleAddBranch} disabled={addingBranch || !newBranchName || !newBranchUrl} className="btn btn-outline" style={{ padding: '8px', fontSize: '0.82rem', gap: '6px' }}>
                <Plus size={14} /> Add Branch
              </button>
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div style={{ backgroundColor: 'var(--danger-bg)', color: 'var(--danger)', padding: '12px', borderRadius: '10px', marginBottom: '16px', fontSize: '0.875rem' }}>
            {error}
          </div>
        )}

        {/* Setup Form */}
        {showSetup ? (
          <form onSubmit={handleSetup}>
            <div style={{ marginBottom: '24px', textAlign: 'center' }}>
              <button 
                type="button" 
                onClick={() => handleGoogleSetup()} 
                className="btn w-full" 
                style={{ 
                  background: 'white', color: '#333', minHeight: '48px', 
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px',
                  border: '1px solid #ddd'
                }} 
                disabled={loading}
              >
                <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" width="20" alt="Google" />
                Automated Setup (Sign in with Google)
              </button>
              <div style={{ margin: '16px 0', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                — OR MANUAL SETUP —
              </div>
            </div>

            <div className="input-group">
              <label>Google Apps Script API Link</label>
              <div style={{ position: 'relative' }}>
                <LinkIcon size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} />
                <input
                  type="url"
                  value={apiLinkState}
                  onChange={e => setApiLinkState(e.target.value)}
                  placeholder="https://script.google.com/macros/s/..."
                  style={{ paddingLeft: '36px', width: '100%' }}
                  required
                />
              </div>
            </div>
            <div className="input-group">
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Key size={16} /> API Secret Key (Optional)
              </label>
              <input
                type="password"
                value={apiSecretState}
                onChange={e => setApiSecretState(e.target.value)}
                placeholder="Enter APP_SECRET (if configured)"
                style={{ width: '100%' }}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <input
                placeholder="Branch name (optional, e.g. Main Store)"
                value={newBranchName}
                onChange={e => setNewBranchName(e.target.value)}
                style={{ padding: '10px 12px', borderRadius: '10px', border: '1px solid var(--border-color)', background: 'var(--surface-color)', color: 'var(--text-primary)', fontFamily: 'inherit', fontSize: '0.875rem' }}
              />
            </div>
            <button type="submit" className="btn btn-primary w-full" style={{ marginTop: '16px', minHeight: '48px' }} disabled={loading}>
              {loading ? 'Connecting...' : 'Connect to Business'}
            </button>
            {!loading && (
              <button type="button" className="btn btn-outline w-full" style={{ marginTop: '8px' }} onClick={() => setShowSetup(false)}>
                Back to Login
              </button>
            )}
          </form>
        ) : (
          <form onSubmit={handleLogin}>
            <div className="input-group">
              <label>{t('login.phone')} / Username</label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="text"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  placeholder="Enter phone or username"
                  style={{ flex: 1 }}
                  required
                />
              </div>
            </div>
            <div className="input-group">
              <label>{t('login.pin')}</label>
              <input
                type="password"
                value={pin}
                onChange={e => setPin(e.target.value)}
                placeholder="Enter PIN / Password"
                required
              />
            </div>
            <button type="submit" className="btn btn-primary w-full" style={{ marginTop: '16px', minHeight: '48px', gap: '8px' }} disabled={loading}>
              <LogIn size={20} />
              {loading ? t('common.loading') : t('login.login_btn')}
            </button>
            <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
              <button type="button" className="btn btn-outline w-full" style={{ fontSize: '0.8rem', gap: '6px' }} onClick={() => setShowSetup(true)}>
                <Settings size={14} /> API Link
              </button>
              {branches.length === 0 && (
                <button type="button" className="btn btn-outline w-full" style={{ fontSize: '0.8rem', gap: '6px' }} onClick={() => { setNewBranchName(''); setShowBranchPicker(true); }}>
                  <Building2 size={14} /> Add Branch
                </button>
              )}
            </div>
          </form>
        )}

        <p style={{ textAlign: 'center', marginTop: '24px', fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
          Designed by{' '}
          <a href="https://thosho.github.io/" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--primary)', fontWeight: '600', textDecoration: 'none' }}>
            Thosho Tech
          </a>
        </p>
      </div>
    </div>
  );
}
