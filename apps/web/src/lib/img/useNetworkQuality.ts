import { useEffect, useState } from 'react';

// Not in the standard lib.dom types yet — Chromium/Android only, Safari/Firefox
// simply don't expose `navigator.connection` at all.
interface NetworkInformation extends EventTarget {
  effectiveType?: 'slow-2g' | '2g' | '3g' | '4g';
  saveData?: boolean;
}

function getConnection(): NetworkInformation | undefined {
  if (typeof navigator === 'undefined') return undefined;
  return (navigator as Navigator & { connection?: NetworkInformation }).connection;
}

function isSlow(connection: NetworkInformation | undefined): boolean {
  if (!connection) return false; // unsupported browser — assume a normal connection
  if (connection.saveData) return true;
  return connection.effectiveType === 'slow-2g' || connection.effectiveType === '2g';
}

/**
 * True on a flagged data-saver mode or a 2G-class connection (Network Information
 * API — Chromium/Android only; unsupported browsers, notably Safari, always read
 * as a normal connection since there's no signal to act on). Used to cap image
 * requests at the light 1x tier instead of escalating to the full device-pixel-ratio
 * resolution, so a bad connection stays fast rather than repeating the "light now,
 * sharp later" upgrade with a heavy download it can't afford.
 */
export function useNetworkQuality(): { isSlow: boolean } {
  const connection = getConnection();
  const [slow, setSlow] = useState(() => isSlow(connection));

  useEffect(() => {
    if (!connection) return;
    const handleChange = () => setSlow(isSlow(connection));
    connection.addEventListener('change', handleChange);
    return () => connection.removeEventListener('change', handleChange);
  }, [connection]);

  return { isSlow: slow };
}
