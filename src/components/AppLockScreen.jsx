import { useState, useEffect } from 'react';
import { verifyPIN, getLockoutStatus, recordFailedAttempt, resetFailedAttempts } from '../services/authUtils';
import { Lock } from 'lucide-react';

export default function AppLockScreen({ authUser, onUnlock, onLogout }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');

  const [lockoutTimer, setLockoutTimer] = useState(0);

  useEffect(() => {
    const checkLockout = () => {
      const status = getLockoutStatus();
      setLockoutTimer(status.remainingSeconds);
    };
    checkLockout();
    const interval = setInterval(checkLockout, 1000);
    return () => clearInterval(interval);
  }, []);

  const handleUnlock = async () => {
    if (!pin || lockoutTimer > 0) return;
    
    // For admin, if the PIN is somehow not set or they type it wrong, they can't get in unless they logout.
    const pinMatch = await verifyPIN(pin, String(authUser.PIN));
    
    if (pinMatch) {
      setError('');
      setPin('');
      resetFailedAttempts();
      onUnlock();
    } else {
      const status = recordFailedAttempt();
      if (status.locked) {
        setError(`Locked for ${status.remainingSeconds}s`);
      } else {
        setError('Incorrect PIN');
      }
      setPin('');
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') handleUnlock();
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 99999, background: 'var(--bg-color)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
      <div style={{ background: 'var(--surface-color)', padding: '40px 32px', borderRadius: '24px', boxShadow: '0 20px 40px rgba(0,0,0,0.2)', display: 'flex', flexDirection: 'column', alignItems: 'center', maxWidth: '360px', width: '100%', border: '1px solid var(--border-color)' }}>
        <div style={{ width: '64px', height: '64px', borderRadius: '50%', background: 'rgba(59, 130, 246, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '24px' }}>
          <Lock size={32} color="#3b82f6" />
        </div>
        <h2 style={{ marginBottom: '8px', fontSize: '1.5rem', fontWeight: '700', color: 'var(--text-primary)' }}>App Locked</h2>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '24px', textAlign: 'center', fontSize: '0.9rem' }}>
          Welcome back, {authUser.Name || authUser.Username || 'User'}.<br/>Please enter your PIN.
        </p>
        
        <input 
          type="password" 
          value={pin} 
          onChange={e => setPin(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="••••"
          disabled={lockoutTimer > 0}
          style={{ width: '100%', padding: '16px', fontSize: '1.5rem', textAlign: 'center', borderRadius: '12px', border: '2px solid var(--border-color)', background: 'var(--bg-color)', color: 'var(--text-primary)', marginBottom: '16px', letterSpacing: '8px', outline: 'none', transition: 'border-color 0.2s' }}
          autoFocus
        />
        {error && <p style={{ color: 'var(--danger)', marginBottom: '16px', fontSize: '0.85rem', fontWeight: '500' }}>{error}</p>}
        
        <button 
          className="btn btn-primary" 
          onClick={handleUnlock} 
          disabled={lockoutTimer > 0}
          style={{ width: '100%', padding: '14px', fontSize: '1rem', fontWeight: '600', marginBottom: '16px' }}
        >
          {lockoutTimer > 0 ? `Locked (${lockoutTimer}s)` : 'Unlock'}
        </button>
        <button className="btn btn-outline" onClick={onLogout} style={{ width: '100%', padding: '12px', fontSize: '0.9rem', color: 'var(--text-secondary)', border: 'none' }}>
          Logout instead
        </button>
      </div>
    </div>
  );
}
