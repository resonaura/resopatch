import dagre from '@dagrejs/dagre';
import { DeviceType, InventoryStatus } from '@resopatch/shared';
import { Device } from '../database/entities/device.entity';
import { Cable } from '../database/entities/cable.entity';
import { Port } from '../database/entities/port.entity';

const FALLBACK_WIDTH = 220;
const FALLBACK_HEIGHT = 90;
const COLUMN_GAP = 120;
const ROW_GAP = 60;
const CHAIN_GAP_X = 160;
const ZONE_GAP_X = 420;
const ZONE_GAP_Y = 280;

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
 * Places one already-ranked chain (either the zone's power block or its signal block) top-to-
 * bottom starting at a given x offset: row = dense rank (how many hops down that chain), column =
 * a collision index that only increments when two devices land on the same rank (parallel
 * branches, or nothing connecting them at all). Column width and row height are each one fixed
 * size for the whole chain (the largest device in it, plus a generous gap), so spacing is uniform
 * and predictable rather than packed as tight as each device's actual pixel size allows.
 */
function placeChain(chain: Device[], rankOf: Map<string, number>, sizeOf: (id: string) => SizedDevice, xOffset: number): ZoneLayout {
  const positions = new Map<string, { x: number; y: number }>();
  if (chain.length === 0) return { positions, width: 0, height: 0 };

  const sized: SizedDevice[] = chain.map((d) => sizeOf(d.id));
  const columnWidth = Math.max(...sized.map((d) => d.width), FALLBACK_WIDTH) + COLUMN_GAP;
  const rowHeight = Math.max(...sized.map((d) => d.height), FALLBACK_HEIGHT) + ROW_GAP;
  const colsUsedAtRank = new Map<number, number>();
  let maxRank = 0;
  let chainWidth = 0;
  for (const d of sized) {
    const rank = rankOf.get(d.id)!;
    maxRank = Math.max(maxRank, rank);
    const col = colsUsedAtRank.get(rank) ?? 0;
    colsUsedAtRank.set(rank, col + 1);
    const x = xOffset + col * columnWidth;
    positions.set(d.id, { x, y: rank * rowHeight });
    chainWidth = Math.max(chainWidth, x - xOffset + d.width);
  }

  return { positions, width: chainWidth, height: (maxRank + 1) * rowHeight - ROW_GAP };
}

/**
 * Lays out one zone as two independent top-to-bottom chains side by side: the "power" chain
 * (extension cords, isolated PSUs — the electrical path) on the left, the "signal" chain
 * (instruments, interfaces, effects, mics — the audio path) on the right, each ranked by its own
 * cables *within this zone only* via dagre so each column reads as its own sequential flow.
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
  // *relative order* matters here, so densify to consecutive integers, separately per chain below
  // (power and signal are visually independent columns, each restarting at row 0).
  const rawRankOf = new Map<string, number>();
  for (const d of zoneDevices) rawRankOf.set(d.id, g.node(d.id).rank ?? 0);

  const power = zoneDevices.filter(isPowerInfra).sort((a, b) => rawRankOf.get(a.id)! - rawRankOf.get(b.id)!);
  const signal = zoneDevices.filter((d) => !isPowerInfra(d)).sort((a, b) => rawRankOf.get(a.id)! - rawRankOf.get(b.id)!);

  const densify = (chain: Device[]): Map<string, number> => {
    const distinct = [...new Set(chain.map((d) => rawRankOf.get(d.id)!))].sort((a, b) => a - b);
    const denseIndex = new Map(distinct.map((raw, i) => [raw, i]));
    return new Map(chain.map((d) => [d.id, denseIndex.get(rawRankOf.get(d.id)!)!]));
  };

  const powerChain = placeChain(power, densify(power), sizeOf, 0);
  const signalX = powerChain.width + (power.length > 0 && signal.length > 0 ? CHAIN_GAP_X : 0);
  const signalChain = placeChain(signal, densify(signal), sizeOf, signalX);

  for (const [id, pos] of powerChain.positions) positions.set(id, pos);
  for (const [id, pos] of signalChain.positions) positions.set(id, pos);

  return {
    positions,
    width: Math.max(powerChain.width, signalX + signalChain.width),
    height: Math.max(powerChain.height, signalChain.height),
  };
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

  // A device with a parent renders nested inside that parent's card instead of as its own node —
  // see DeviceNode.tsx — *unless* it has real ports of its own (e.g. a power brick strapped to a
  // pedalboard): those still need a genuine position since their cables have to land somewhere.
  const devicesWithPorts = new Set(ports.map((p) => p.deviceId));
  const mainDevices = devices.filter((d) => !d.parentDeviceId || devicesWithPorts.has(d.id));

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

  return { positions };
}
