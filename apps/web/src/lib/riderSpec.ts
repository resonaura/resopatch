/** Convention for the rider-relevant fields that live inside `Device.attrs` (a free-form
 *  `Record<string, unknown>` — see packages/shared/src/types.ts). None of this is enforced by the
 *  zod schema (attrs stays a catch-all on purpose, see docs/stage-setup.md §13), so these are
 *  read defensively and simply omitted from the rider sheet when absent or the wrong shape.
 *
 *  Recognized keys, all optional:
 *   - manufacturer, model: string — free-text identification beyond `device.name`.
 *   - color: string — finish/colorway (e.g. guitars/basses), rendered as a swatch + label.
 *   - controls: string[] — one entry per knob/switch, e.g. "DRIVE — уровень насыщения и гейна".
 *   - footswitch: string — prose describing footswitch behavior (short click / hold / LED colors).
 *   - algorithms: string[] — effect/amp-model list for multi-mode units (delay types, cab sims…).
 */
export interface RiderAttrs {
  manufacturer?: string;
  model?: string;
  color?: string;
  controls?: string[];
  footswitch?: string;
  algorithms?: string[];
}

const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');

export function readRiderAttrs(attrs: Record<string, unknown>): RiderAttrs {
  return {
    manufacturer: typeof attrs.manufacturer === 'string' ? attrs.manufacturer : undefined,
    model: typeof attrs.model === 'string' ? attrs.model : undefined,
    color: typeof attrs.color === 'string' ? attrs.color : undefined,
    controls: isStringArray(attrs.controls) ? attrs.controls : undefined,
    footswitch: typeof attrs.footswitch === 'string' ? attrs.footswitch : undefined,
    algorithms: isStringArray(attrs.algorithms) ? attrs.algorithms : undefined,
  };
}
