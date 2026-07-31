import { useEffect, useState } from 'react';
import { APP_NAME, APP_TAGLINE } from '../services/authUtils';

export default function SplashScreen({ onDone }) {
  const [phase, setPhase] = useState('in'); // 'in' | 'show' | 'out'

  useEffect(() => {
    // Phase timeline: fade-in 600ms → hold 1600ms → fade-out 600ms → done
    const t1 = setTimeout(() => setPhase('show'), 600);
    const t2 = setTimeout(() => setPhase('out'), 2200);
    const t3 = setTimeout(() => onDone(), 2800);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [onDone]);

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'linear-gradient(135deg, #1e1b4b 0%, #312e81 40%, #4f46e5 100%)',
        display: 'flex', flexDirection: 'column',
        justifyContent: 'center', alignItems: 'center',
        opacity: phase === 'out' ? 0 : 1,
        transition: 'opacity 0.6s ease',
        // Safe area for notched phones (APK)
        paddingTop: 'env(safe-area-inset-top)',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      {/* Glowing background orbs */}
      <div style={{
        position: 'absolute', width: '300px', height: '300px', borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(99,102,241,0.3) 0%, transparent 70%)',
        top: '10%', left: '50%', transform: 'translateX(-50%)',
        filter: 'blur(40px)', pointerEvents: 'none'
      }} />
      <div style={{
        position: 'absolute', width: '200px', height: '200px', borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(167,139,250,0.2) 0%, transparent 70%)',
        bottom: '15%', right: '10%',
        filter: 'blur(30px)', pointerEvents: 'none'
      }} />

      {/* Logo Icon */}
      <div
        style={{
          width: '96px', height: '96px', borderRadius: '28px',
          background: 'linear-gradient(135deg, rgba(255,255,255,0.2), rgba(255,255,255,0.05))',
          border: '1.5px solid rgba(255,255,255,0.25)',
          backdropFilter: 'blur(12px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          marginBottom: '28px',
          boxShadow: '0 8px 32px rgba(0,0,0,0.3), 0 0 0 1px rgba(255,255,255,0.1)',
          opacity: phase === 'in' ? 0 : 1,
          transform: phase === 'in' ? 'scale(0.7) translateY(10px)' : 'scale(1) translateY(0)',
          transition: 'all 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)',
        }}
      >
        {/* Wallet SVG icon */}
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 12V22H4V12" />
          <path d="M22 7H2v5h20V7z" />
          <path d="M12 22V7" />
          <path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z" />
          <path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z" />
        </svg>
      </div>

      {/* App name */}
      <div
        style={{
          opacity: phase === 'in' ? 0 : 1,
          transform: phase === 'in' ? 'translateY(16px)' : 'translateY(0)',
          transition: 'all 0.6s ease 0.15s',
          textAlign: 'center',
        }}
      >
        <h1 style={{
          color: 'white',
          fontSize: 'clamp(2rem, 8vw, 2.75rem)',
          fontWeight: '700',
          margin: 0,
          letterSpacing: '-0.5px',
          fontFamily: "'Outfit', sans-serif",
          textShadow: '0 2px 20px rgba(0,0,0,0.3)',
        }}>
          {APP_NAME}
        </h1>
        <p style={{
          color: 'rgba(255,255,255,0.75)',
          fontSize: 'clamp(0.8rem, 3.5vw, 0.95rem)',
          margin: '8px 0 0',
          letterSpacing: '0.04em',
          fontWeight: '500',
        }}>
          {APP_TAGLINE}
        </p>
      </div>

      {/* Loading dots */}
      <div
        style={{
          display: 'flex', gap: '8px', marginTop: '48px',
          opacity: phase === 'in' ? 0 : 1,
          transition: 'opacity 0.6s ease 0.3s',
        }}
      >
        {[0, 1, 2].map(i => (
          <div
            key={i}
            style={{
              width: '8px', height: '8px', borderRadius: '50%',
              background: 'rgba(255,255,255,0.6)',
              animation: `bounce 1.2s ease-in-out ${i * 0.2}s infinite`,
            }}
          />
        ))}
      </div>

      {/* Footer branding */}
      <div
        style={{
          position: 'absolute', bottom: 'max(32px, env(safe-area-inset-bottom, 32px))',
          textAlign: 'center',
          opacity: phase === 'in' ? 0 : 1,
          transition: 'opacity 0.6s ease 0.4s',
        }}
      >
        <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.7rem', margin: 0, letterSpacing: '0.08em' }}>
          Designed &amp; Developed by
        </p>
        <a
          href="https://thosho.github.io/"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            color: 'rgba(255,255,255,0.75)', fontSize: '0.8rem',
            fontWeight: '600', textDecoration: 'none', letterSpacing: '0.05em'
          }}
        >
          Thosho Tech
        </a>
      </div>

      <style>{`
        @keyframes bounce {
          0%, 80%, 100% { transform: scale(0.8); opacity: 0.5; }
          40% { transform: scale(1.2); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
