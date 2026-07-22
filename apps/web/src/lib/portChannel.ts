/**
 * Stereo-convention colour for a port, guessed from its name (e.g. "Stereo Out L", "Out R (XLR)",
 * "Combo In 1 (Pedalboard L)") — red for right, white for left, matching the usual RCA/XLR-pair
 * colour code. `\b` word boundaries keep this from matching "L"/"R" inside unrelated words (e.g.
 * the "R" in "XLR").
 */
export function portChannelColor(portName: string): string | null {
  if (/\bR\b/.test(portName)) return '#ef4444';
  if (/\bL\b/.test(portName)) return '#f8fafc';
  return null;
}
