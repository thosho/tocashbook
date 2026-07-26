import { useState, useEffect } from 'react';
import { WifiOff, Wifi } from 'lucide-react';

export default function OfflineBanner() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [showRestored, setShowRestored] = useState(false);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      setShowRestored(true);
      setTimeout(() => setShowRestored(false), 3000);
    };
    const handleOffline = () => {
      setIsOnline(false);
      setShowRestored(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  if (isOnline && !showRestored) return null;

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      padding: '10px 16px',
      borderRadius: '10px',
      marginBottom: '12px',
      fontSize: '0.85rem',
      fontWeight: '600',
      background: isOnline ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)',
      border: `1px solid ${isOnline ? 'var(--success)' : 'var(--danger)'}`,
      color: isOnline ? 'var(--success)' : 'var(--danger)',
      animation: 'fadeIn 0.4s ease',
    }}>
      {isOnline
        ? <><Wifi size={16} /> Connection restored! Syncing pending entries...</>
        : <><WifiOff size={16} /> You are offline. New entries will sync automatically when connected.</>
      }
    </div>
  );
}
