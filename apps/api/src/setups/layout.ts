import dagre from '@dagrejs/dagre';
import { DeviceType, InventoryStatus } from '@resopatch/shared';
import { Device } from '../database/entities/device.entity';
import { Cable } from '../database/entities/cable.entity';
import { Port } from '../database/entities/port.entity';

const FALLBACK_WIDTH = 220;
const FALLBACK_HEIGHT = 90;
const COLUMN_GAP = 120;
const ROW_GAP = 60;
const SUBSECTION_GAP = 90;
const ZONE_GAP_X = 420;
const ZONE_GAP_Y = 280;
const ACCESSORY_OFFSET_X = 24;
const ACCESSORY_OFFSET_Y = 20;
const ACCESSORY_ROW_WIDTH = 110;
const ACCESSORY_HEIGHT_FALLBACK = 40;

type ZoneName = 'andrey' | 'barabanschik' | 'vokal' | 'service' | 'inactive';

/** Not a signal-flow diagram — a stage map. Each band member gets their own independent
 *  top-to-bottom chain (own dagre pass, not sharing rank with anyone else's), and the four
 *  islands sit where they'd actually stand: Andrey stage left, Даня-барабанщик upstage centre
 *  (drawn top since he's furthest from the audience), Даня-вокал downstage centre (drawn
 *  underneath him — closest to the audience), and a service column stage right for gear that
 *  isn't any one person's (stage box, venue outlet, the playback laptop). Inactive/planned gear
 *  isn't part of the stage at all, so it gets its own shelf below everything instead of a spot
 *  in the floor plan. */
function zoneOf(device: Device): ZoneName {
  if (device.inventoryStatus === InventoryStatus.OWNED_INACTIVE || device.inventoryStatus === InventoryStatus.PLANNED_NOT_OWNED) return 'inactive';
  if (device.type === DeviceType.STAGE_BOX) return 'service';
  if (device.type === DeviceType.LAPTOP && device.ownerRole === 'Даня-барабанщик') return 'service';
  if (device.ownerRole === 'Андрей') return 'andrey';
  if (device.ownerRole === 'Даня-барабанщик') return 'barabanschik';
  if (device.ownerRole === 'Даня-вокал') return 'vokal';
  return 'service';
}

/** Pure power-distribution infrastructure (wall strips, isolated PSUs, splitters) — the "current
 *  path" drawn as its own block underneath each zone's "signal path" (instruments, interfaces,
 *  effects, mics — everything else, even though most of it also needs power via one of its own
 *  ports). A device that merely *has* a power port doesn't qualify; its whole reason for existing
 *  has to be distributing power. */
function isPowerInfra(device: Device): boolean {
  return device.type === DeviceType.POWER_SUPPLY || device.type === DeviceType.POWER_SPLITTER || device.type === DeviceType.POWER_STRIP;
}

export interface LayoutResult {
  positions: Map<string, { x: number; y: number }>;
}

interface SizedDevice {
  id: string;
  width: number;
  height: number;
}

interface ZoneLayout {
  positions: Map<string, { x: number; y: number }>;
  width: number;
  height: number;
}

/**
 * Lays out one zone's devices top-to-bottom by their own signal flow, split into a "signal"
 * block (instruments, interfaces, effects) stacked above a "power" block (extension cords,
 * isolated PSUs), each snapped onto its own fixed-size grid: row = dagre rank (how many hops
 * down the chain, computed from cables *within this zone only*), column = a collision index that
 * only increments when two devices land on the same rank (parallel branches, or nothing
 * connecting them at all). Column width and row height are each one fixed size per block (the
 * largest device in it, plus a generous gap), so spacing is uniform and predictable rather than
 * packed as tight as each device's actual pixel size allows.
 */
function layoutZone(zoneDevices: Device[], cables: Cable[], portToDevice: Map<string, string>, sizeOf: (id: string) => SizedDevice): ZoneLayout {
  const positions = new Map<string, { x: number; y: number }>();
  if (zoneDevices.length === 0) return { positions, width: 0, height: 0 };

  const ids = new Set(zoneDevices.map((d) => d.id));
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'TB', nodesep: 1, ranksep: 1, marginx: 0, marginy: 0 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const d of zoneDevices) {
    const { width, height } = sizeOf(d.id);
    g.setNode(d.id, { width, height });
  }
  for (const c of cables) {
    const s = portToDevice.get(c.sourcePortId);
    const t = portToDevice.get(c.targetPortId);
    if (!s || !t || s === t || !ids.has(s) || !ids.has(t)) continue;
    g.setEdge(s, t);
  }
  dagre.layout(g);

  // dagre's rank numbers frequently have gaps (e.g. 0, 2, 4, 6 — it reserves extra rank slots
  // for edge routing internally) — using them as-is would leave huge empty rows. Only the
  // *relative order* matters here, so densify to consecutive integers, separately per block
  // below (signal and power are visually independent stacks, each restarting at row 0).
  const rawRankOf = new Map<string, number>();
  for (const d of zoneDevices) rawRankOf.set(d.id, g.node(d.id).rank ?? 0);

  const signal = zoneDevices.filter((d) => !isPowerInfra(d)).sort((a, b) => rawRankOf.get(a.id)! - rawRankOf.get(b.id)!);
  const power = zoneDevices.filter(isPowerInfra).sort((a, b) => rawRankOf.get(a.id)! - rawRankOf.get(b.id)!);

  const densify = (block: Device[]): Map<string, number> => {
    const distinct = [...new Set(block.map((d) => rawRankOf.get(d.id)!))].sort((a, b) => a - b);
    const denseIndex = new Map(distinct.map((raw, i) => [raw, i]));
    return new Map(block.map((d) => [d.id, denseIndex.get(rawRankOf.get(d.id)!)!]));
  };

  let yCursor = 0;
  let zoneWidth = 0;
  for (const block of [signal, power]) {
    if (block.length === 0) continue;
    const rankOf = densify(block);
    const sized: SizedDevice[] = block.map((d) => sizeOf(d.id));
    const columnWidth = Math.max(...sized.map((d) => d.width), FALLBACK_WIDTH) + COLUMN_GAP;
    const rowHeight = Math.max(...sized.map((d) => d.height), FALLBACK_HEIGHT) + ROW_GAP;
    const colsUsedAtRank = new Map<number, number>();
    let maxRank = 0;
    for (const d of sized) {
      const rank = rankOf.get(d.id)!;
      maxRank = Math.max(maxRank, rank);
      const col = colsUsedAtRank.get(rank) ?? 0;
      colsUsedAtRank.set(rank, col + 1);
      positions.set(d.id, { x: col * columnWidth, y: yCursor + rank * rowHeight });
      zoneWidth = Math.max(zoneWidth, col * columnWidth + d.width);
    }
    yCursor += (maxRank + 1) * rowHeight + SUBSECTION_GAP;
  }

  return { positions, width: zoneWidth, height: yCursor - SUBSECTION_GAP };
}

/**
 * `sizes` are real rendered pixel dimensions when available (React Flow's measured node size,
 * sent by the "Упорядочить" button) — the seed script instead passes estimated sizes, since
 * there's no browser at seed time to measure real ones.
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
  const sizedOf = (id: string): SizedDevice => ({ id, ...sizeOf(id) });

  const groups: Record<ZoneName, Device[]> = { andrey: [], barabanschik: [], vokal: [], service: [], inactive: [] };
  for (const d of mainDevices) groups[zoneOf(d)].push(d);

  const andrey = layoutZone(groups.andrey, cables, portToDevice, sizedOf);
  const barabanschik = layoutZone(groups.barabanschik, cables, portToDevice, sizedOf);
  const vokal = layoutZone(groups.vokal, cables, portToDevice, sizedOf);
  const service = layoutZone(groups.service, cables, portToDevice, sizedOf);
  const inactive = layoutZone(groups.inactive, cables, portToDevice, sizedOf);

  const positions = new Map<string, { x: number; y: number }>();
  const place = (zone: ZoneLayout, anchorX: number, anchorY: number) => {
    for (const [id, pos] of zone.positions) positions.set(id, { x: pos.x + anchorX, y: pos.y + anchorY });
  };

  // Left: Andrey. Centre column: Даня-барабанщик on top, Даня-вокал underneath. Right: service.
  place(andrey, 0, 0);
  const centerX = andrey.width + ZONE_GAP_X;
  place(barabanschik, centerX, 0);
  place(vokal, centerX, barabanschik.height + ZONE_GAP_Y);
  const centerWidth = Math.max(barabanschik.width, vokal.width);
  const serviceX = centerX + centerWidth + ZONE_GAP_X;
  place(service, serviceX, 0);

  // Not part of the stage at all — a shelf below the tallest column, not a spot in the floor plan.
  const tallestColumn = Math.max(andrey.height, barabanschik.height + ZONE_GAP_Y + vokal.height, service.height);
  place(inactive, 0, tallestColumn + ZONE_GAP_Y);

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
