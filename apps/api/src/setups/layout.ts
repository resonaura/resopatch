import dagre from '@dagrejs/dagre';
import { DeviceType, InventoryStatus } from '@resopatch/shared';
import { Device } from '../database/entities/device.entity';
import { Cable } from '../database/entities/cable.entity';
import { Port } from '../database/entities/port.entity';

const FALLBACK_WIDTH = 220;
const FALLBACK_HEIGHT = 70;
const NODE_SEP = 60;
const RANK_SEP = 140;
const ROW_GAP = 28;
const LANE_GAP = 90;
const LANE_LABEL_GAP = 30;
const SHELF_MIN_GAP_X = 40;
const ACCESSORY_OFFSET_X = 24;
const ACCESSORY_OFFSET_Y = 14;
const ACCESSORY_ROW_WIDTH = 100;
const ACCESSORY_HEIGHT_FALLBACK = 36;

/** Five bands, top to bottom: Andrey's own rig, Даня-барабанщик's rig, Даня-вокал's rig, a
 *  shared/service row for stage-wide infrastructure (stage box, the playback laptop — gear that
 *  isn't any one person's, even if it's physically parked near the drummer), and finally
 *  everything not currently patched in (inactive/planned) pulled into its own row so it doesn't
 *  clutter the live signal chain. */
function laneOf(device: Device): number {
  if (device.inventoryStatus === InventoryStatus.OWNED_INACTIVE || device.inventoryStatus === InventoryStatus.PLANNED_NOT_OWNED) return 4;
  if (device.type === DeviceType.STAGE_BOX) return 3;
  if (device.type === DeviceType.LAPTOP && device.ownerRole === 'Даня-барабанщик') return 3;
  if (device.ownerRole === 'Андрей') return 0;
  if (device.ownerRole === 'Даня-барабанщик') return 1;
  if (device.ownerRole === 'Даня-вокал') return 2;
  return 3;
}

export interface LayoutResult {
  positions: Map<string, { x: number; y: number }>;
}

/**
 * Two-phase layout:
 *  1. ONE global dagre pass (rankdir LR) over every main device and every cable between them —
 *     this is what makes the x-axis genuinely "sequential": a device's column reflects its real
 *     topological position in the signal chain, and that's consistent across owners, so a
 *     cross-lane cable (e.g. Andrey's power strip feeding Даня-вокал's Volt 276) draws as a
 *     sensible diagonal instead of connecting two unrelated coordinate spaces.
 *  2. Within each owner lane, shelf-pack devices into rows ordered by that x — this is what makes
 *     it "grouped" (one visual band per person, an inactive/planned band at the bottom) without
 *     ever overlapping, because a shelf only accepts a node once the previous one's right edge
 *     plus a gap has cleared.
 * Accessories (parentDeviceId set) have no ports/cables of their own, so they're excluded from
 * both phases and just pinned under whichever device they belong to, after that device lands.
 *
 * `sizes` are the *actual* rendered pixel dimensions from the browser (React Flow's measured
 * node size) — guessing them from port count alone consistently produced overlapping nodes,
 * since real height depends on font metrics, badges, and owner-line wrapping that aren't
 * reproducible from the data model.
 */
export function computeAutoLayout(
  devices: Device[],
  ports: Port[],
  cables: Cable[],
  sizes: Map<string, { width: number; height: number }>,
): LayoutResult {
  const portToDevice = new Map<string, string>();
  for (const p of ports) portToDevice.set(p.id, p.deviceId);

  const mainDevices = devices.filter((d) => !d.parentDeviceId);
  const accessories = devices.filter((d) => d.parentDeviceId);

  const sizeOf = (id: string) => sizes.get(id) ?? { width: FALLBACK_WIDTH, height: FALLBACK_HEIGHT };

  // --- Phase 1: global rank (x) from the whole graph -----------------------------------------
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'LR', nodesep: NODE_SEP, ranksep: RANK_SEP, marginx: 0, marginy: 0 });
  g.setDefaultEdgeLabel(() => ({}));

  const mainIds = new Set(mainDevices.map((d) => d.id));
  for (const d of mainDevices) {
    const { width, height } = sizeOf(d.id);
    g.setNode(d.id, { width, height });
  }
  for (const c of cables) {
    const sourceDeviceId = portToDevice.get(c.sourcePortId);
    const targetDeviceId = portToDevice.get(c.targetPortId);
    if (!sourceDeviceId || !targetDeviceId) continue;
    if (!mainIds.has(sourceDeviceId) || !mainIds.has(targetDeviceId)) continue;
    if (sourceDeviceId === targetDeviceId) continue;
    g.setEdge(sourceDeviceId, targetDeviceId);
  }
  dagre.layout(g);

  const xOf = new Map<string, number>();
  for (const d of mainDevices) {
    const n = g.node(d.id);
    xOf.set(d.id, n.x - n.width / 2);
  }

  // --- Phase 2: shelf-pack each lane's devices (sorted by x) into non-overlapping rows -------
  const lanes: Device[][] = [[], [], [], [], []];
  for (const d of mainDevices) lanes[laneOf(d)].push(d);

  const positions = new Map<string, { x: number; y: number }>();
  let laneYCursor = 0;

  for (const laneDevices of lanes) {
    if (laneDevices.length === 0) continue;
    const sorted = [...laneDevices].sort((a, b) => xOf.get(a.id)! - xOf.get(b.id)!);

    const shelves: { rightEdge: number }[] = [];
    const shelfOfDevice = new Map<string, number>();
    for (const d of sorted) {
      const x = xOf.get(d.id)!;
      const { width } = sizeOf(d.id);
      let shelfIndex = shelves.findIndex((s) => x >= s.rightEdge + SHELF_MIN_GAP_X);
      if (shelfIndex === -1) {
        shelfIndex = shelves.length;
        shelves.push({ rightEdge: -Infinity });
      }
      shelves[shelfIndex].rightEdge = x + width;
      shelfOfDevice.set(d.id, shelfIndex);
    }

    // Row height per shelf = tallest node actually placed on it.
    const shelfHeights = shelves.map(() => 0);
    for (const d of sorted) {
      const shelfIndex = shelfOfDevice.get(d.id)!;
      shelfHeights[shelfIndex] = Math.max(shelfHeights[shelfIndex], sizeOf(d.id).height);
    }
    const shelfYOffsets: number[] = [];
    let cursor = LANE_LABEL_GAP;
    for (const h of shelfHeights) {
      shelfYOffsets.push(cursor);
      cursor += h + ROW_GAP;
    }

    for (const d of sorted) {
      const shelfIndex = shelfOfDevice.get(d.id)!;
      positions.set(d.id, { x: xOf.get(d.id)!, y: laneYCursor + shelfYOffsets[shelfIndex] });
    }

    laneYCursor += cursor + LANE_GAP;
  }

  // --- Accessories: pinned under their parent, spread out so siblings don't stack exactly ----
  const siblingIndex = new Map<string, number>();
  for (const a of accessories) {
    if (!a.parentDeviceId) continue;
    const parentPos = positions.get(a.parentDeviceId);
    if (!parentPos) continue;
    const parentHeight = sizeOf(a.parentDeviceId).height;
    const i = siblingIndex.get(a.parentDeviceId) ?? 0;
    siblingIndex.set(a.parentDeviceId, i + 1);
    const accessoryHeight = sizes.get(a.id)?.height ?? ACCESSORY_HEIGHT_FALLBACK;
    positions.set(a.id, {
      x: parentPos.x + ACCESSORY_OFFSET_X + i * ACCESSORY_ROW_WIDTH,
      y: parentPos.y + parentHeight + ACCESSORY_OFFSET_Y + accessoryHeight / 2,
    });
  }

  return { positions };
}
