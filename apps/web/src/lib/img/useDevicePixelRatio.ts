import { useEffect, useState } from 'react';

function currentDpr(): number {
  return typeof window !== 'undefined' ? window.devicePixelRatio : 1;
}

/**
 * Tracks window.devicePixelRatio reactively. A plain read only reflects the DPR at
 * mount time — dragging the window to a display with a different pixel ratio (no
 * resize event involved) would otherwise leave images pinned to the old, wrong DPR
 * until something else happens to re-render. matchMedia's `resolution` query is the
 * standard way to observe DPR changes: each match is tied to an exact ratio, so on
 * change we re-subscribe at the new ratio.
 */
export function useDevicePixelRatio(): number {
  const [dpr, setDpr] = useState(currentDpr);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;

    const mql = window.matchMedia(`(resolution: ${dpr}dppx)`);
    const handleChange = () => setDpr(currentDpr());

    mql.addEventListener('change', handleChange);
    return () => mql.removeEventListener('change', handleChange);
  }, [dpr]);

  return dpr;
}
