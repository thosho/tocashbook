import { useState, useEffect, useCallback } from 'react';
import { X, ZoomIn, ZoomOut, Download, RotateCw } from 'lucide-react';

/**
 * Fullscreen receipt / image viewer modal.
 * Usage: <ImageViewer src={url} onClose={() => setImageUrl(null)} />
 */
export default function ImageViewer({ src, alt = 'Receipt', onClose }) {
  const [scale, setScale] = useState(1);
  const [rotation, setRotation] = useState(0);

  // Close on Escape key
  const handleKey = useCallback((e) => {
    if (e.key === 'Escape') onClose();
  }, [onClose]);

  useEffect(() => {
    document.addEventListener('keydown', handleKey);
    document.body.style.overflow = 'hidden'; // prevent scroll behind modal
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.body.style.overflow = '';
    };
  }, [handleKey]);

  const zoom = (delta) => setScale(s => Math.min(4, Math.max(0.5, s + delta)));

  const handleDownload = () => {
    const a = document.createElement('a');
    a.href = src;
    a.download = alt.replace(/\s/g, '_') + '_receipt';
    a.target = '_blank';
    a.click();
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(0,0,0,0.92)',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        padding: '16px',
        paddingTop: 'max(16px, env(safe-area-inset-top))',
        paddingBottom: 'max(16px, env(safe-area-inset-bottom))',
      }}
    >
      {/* Toolbar */}
      <div
        onClick={e => e.stopPropagation()}
        style={{
          position: 'fixed', top: 'max(12px, env(safe-area-inset-top))', left: 0, right: 0,
          display: 'flex', justifyContent: 'center', gap: '8px', zIndex: 10000, padding: '0 16px'
        }}
      >
        <div style={{
          display: 'flex', gap: '6px',
          background: 'rgba(30,30,40,0.85)', backdropFilter: 'blur(12px)',
          borderRadius: '40px', padding: '8px 16px', border: '1px solid rgba(255,255,255,0.1)'
        }}>
          <button onClick={() => zoom(-0.25)} title="Zoom out"
            style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer', padding: '6px', borderRadius: '8px', minWidth: '36px', minHeight: '36px' }}>
            <ZoomOut size={18} />
          </button>
          <span style={{ color: 'rgba(255,255,255,0.6)', fontSize: '0.8rem', alignSelf: 'center', minWidth: '40px', textAlign: 'center' }}>
            {Math.round(scale * 100)}%
          </span>
          <button onClick={() => zoom(0.25)} title="Zoom in"
            style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer', padding: '6px', borderRadius: '8px', minWidth: '36px', minHeight: '36px' }}>
            <ZoomIn size={18} />
          </button>
          <div style={{ width: '1px', background: 'rgba(255,255,255,0.15)', margin: '4px 4px' }} />
          <button onClick={() => setRotation(r => (r + 90) % 360)} title="Rotate"
            style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer', padding: '6px', borderRadius: '8px', minWidth: '36px', minHeight: '36px' }}>
            <RotateCw size={18} />
          </button>
          <button onClick={handleDownload} title="Open / Download"
            style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer', padding: '6px', borderRadius: '8px', minWidth: '36px', minHeight: '36px' }}>
            <Download size={18} />
          </button>
          <div style={{ width: '1px', background: 'rgba(255,255,255,0.15)', margin: '4px 4px' }} />
          <button onClick={onClose} title="Close"
            style={{ background: 'none', border: 'none', color: 'rgba(255,120,120,0.9)', cursor: 'pointer', padding: '6px', borderRadius: '8px', minWidth: '36px', minHeight: '36px' }}>
            <X size={18} />
          </button>
        </div>
      </div>

      {/* Image */}
      <div
        onClick={e => e.stopPropagation()}
        style={{ marginTop: '64px', overflow: 'auto', maxWidth: '100%', maxHeight: 'calc(100vh - 120px)' }}
      >
        <img
          src={src}
          alt={alt}
          style={{
            maxWidth: '100%',
            maxHeight: 'calc(100vh - 120px)',
            objectFit: 'contain',
            transform: `scale(${scale}) rotate(${rotation}deg)`,
            transformOrigin: 'center center',
            transition: 'transform 0.2s ease',
            borderRadius: '8px',
            display: 'block',
          }}
          onError={(e) => {
            e.target.style.display = 'none';
            // Show error message
            const msg = document.createElement('div');
            msg.style.cssText = 'color:white;text-align:center;padding:20px;font-family:Outfit,sans-serif;';
            msg.innerHTML = '<p style="font-size:1.1rem;margin:0 0 8px">Could not load image</p><p style="color:rgba(255,255,255,0.5);font-size:0.875rem">The image may have expired or is not accessible. Try the Download button to open in Google Drive.</p>';
            e.target.parentNode.appendChild(msg);
          }}
        />
      </div>

      {/* Tap anywhere to close hint */}
      <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: '0.75rem', marginTop: '12px', pointerEvents: 'none' }}>
        Tap outside to close
      </p>
    </div>
  );
}
