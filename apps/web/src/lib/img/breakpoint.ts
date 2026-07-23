const DEFAULT_BREAKPOINTS = [320, 640, 960, 1280, 1920, 2560, 3840];
const MAX_DPR = 3;

/** Picks the smallest cached breakpoint that covers containerWidth * dpr (capped at MAX_DPR). */
export function pickBreakpoint(containerWidth: number, dpr: number, breakpoints: number[]): number {
  const list = breakpoints.length ? breakpoints : DEFAULT_BREAKPOINTS;
  const targetWidth = containerWidth * Math.min(dpr, MAX_DPR);
  return list.find((bp) => bp >= targetWidth) ?? list[list.length - 1];
}

export { DEFAULT_BREAKPOINTS };
