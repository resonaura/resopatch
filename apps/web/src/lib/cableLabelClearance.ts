/**
 * Spacing budget so cable edge labels can sit on the wire without kissing
 * neighbouring cables or the bend points.
 *
 * Keep the parallel gap modest: too large and dense fan-ins (stagebox etc.) fail
 * to pack and routes look broken. Labels still get a few px of air.
 */

/** Approximate rendered height of the edge label chip (px). */
export const CABLE_LABEL_CHIP_H = 14;

/** Breathing room around the chip, each side, perpendicular to the cable (px). */
export const CABLE_LABEL_PAD = 4;

/**
 * Centre-to-centre gap for parallel cables.
 * Was 16–18 before label-aware spacing; 22 leaves room for the chip without
 * blowing up tight stagebox corridors (28 proved too aggressive).
 */
export const PARALLEL_CABLE_GAP = CABLE_LABEL_CHIP_H + CABLE_LABEL_PAD * 2; // 22

/**
 * Stub comb depth step (near nipples) — slightly tighter than mid-run lanes so
 * multi-port faces stay compact.
 */
export const STUB_LANE_GAP = 16;

/**
 * Minimum straight run length (px) before we place a label.
 * Short stubs never get a caption.
 */
export const MIN_LABEL_RUN_PX = 52;

/**
 * Fraction of the straight run used by the label text/icons.
 * The rest is margin to bends / segment ends.
 */
export const LABEL_RUN_USAGE = 0.85;

/** Max width the label chip may occupy on a given run. */
export function maxLabelWidthForRun(runLen: number): number {
  return Math.max(0, runLen * LABEL_RUN_USAGE - CABLE_LABEL_PAD * 2);
}
