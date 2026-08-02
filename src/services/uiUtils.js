/**
 * uiUtils.js
 * Helper functions for UI polish and dynamic styling across components.
 */

export const getAdaptiveStyle = (val, baseSize = 1.4) => {
  const digits = String(Math.abs(Math.round(val || 0))).length;
  if (digits >= 9) return { padding: '8px 4px', fontSize: `clamp(0.75rem, 2.6vw, ${baseSize * 0.70}rem)` };
  if (digits >= 7) return { padding: '9px 6px', fontSize: `clamp(0.82rem, 3.1vw, ${baseSize * 0.85}rem)` };
  return { padding: '10px 8px', fontSize: `clamp(0.88rem, 3.5vw, ${baseSize}rem)` };
};

export const getAdaptiveFontSize = (val, baseSize = 1.25) => {
  const digits = String(Math.abs(Math.round(val || 0))).length;
  if (digits >= 9) return `${baseSize * 0.70}rem`;
  if (digits >= 7) return `${baseSize * 0.85}rem`;
  return `${baseSize}rem`;
};
