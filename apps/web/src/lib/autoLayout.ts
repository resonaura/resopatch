/**
 * Frontend auto-layout for the patch canvas.
 *
 * All node positioning lives here (not on the API). The backend only persists
 * whatever positions the browser sends after a layout pass or a manual drag.
 *
 * Zones are sacred: each owner role gets its own anchored region. Overlap
 * resolution and crossing swaps never move a card into another zone.
 */
import { DeviceType, InventoryStatus } from '@resopatch/shared';
import {
    countCrossings,
    findFreeSlot,
    greedySwapMinimize,
    resolveNodeOverlaps,
} from './crossings';

export interface LayoutDevice {
  id: string;
  name: string;
  type: DeviceType;
  inventoryStatus: InventoryStatus;
  ownerRole: string | null;
  parentDeviceId: string | null;
  imageUrl?: string | null;
  imageUrls?: string[] | null;
  ports: { id: string }[];
}

export interface LayoutCable {
  sourcePortId: string;
  targetPortId: string;
  /** When set, used to separate audio signal-flow ranks from power-chain ranks. */
  cableType?: string;
}

export interface LayoutResult {
  positions: Map<string, { x: number; y: number }>;
}

/** Fingerprint of graph structure (not positions). When this changes, saved layout is stale. */
export function graphTopologyKey(devices: LayoutDevice[], cables: LayoutCable[]): string {
  const devs = devices
    .map(
      (d) =>
        `${d.id}:${d.parentDeviceId ?? ''}:${d.ownerRole ?? ''}:${d.type}:${d.inventoryStatus}`,
    )
    .sort()
    .join('|');
  const cabs = cables
    .map((c) => `${c.sourcePortId}->${c.targetPortId}`)
    .sort()
    .join('|');
  return `${devs}#${cabs}`;
}

function nameIncludes(device: LayoutDevice, substr: string): boolean {
  const raw = device.name ?? '';
  try {
    const parsed = JSON.parse(raw) as Record<string, string>;
    return Object.values(parsed).some((v) => v.toLowerCase().includes(substr.toLowerCase()));
  } catch {
    return raw.toLowerCase().includes(substr.toLowerCase());
  }
}

/** Flattened lower-case name (handles i18n JSON blobs). */
export function deviceNameLower(device: LayoutDevice): string {
  const raw = device.name ?? '';
  try {
    const parsed = JSON.parse(raw) as Record<string, string>;
    return Object.values(parsed).join(' ').toLowerCase();
  } catch {
    return raw.toLowerCase();
  }
}

function isPowerInfra(device: LayoutDevice): boolean {
  return (
    device.type === DeviceType.POWER_SUPPLY ||
    device.type === DeviceType.POWER_SPLITTER ||
    device.type === DeviceType.POWER_STRIP
  );
}

/**
 * Logical signal family inside a role zone.
 * Vocal chain and guitar chain stay on separate rows; IO/FOH cluster together, etc.
 */
export type LogicalFamily =
  | 'guitar'
  | 'vocal'
  | 'keys'
  | 'laptop'
  | 'io'
  | 'power'
  | 'other';

/** Top→bottom order of family rows inside a zone. */
const FAMILY_ORDER: LogicalFamily[] = [
  'guitar',
  'vocal',
  'keys',
  'laptop',
  'io',
  'other',
  'power',
];

/**
 * Classify a device into a logical family for within-zone packing.
 * Heuristics use type + name (combo mic → guitar, SM58 → vocal, MOTU/stagebox → io).
 */
export function logicalFamily(device: LayoutDevice): LogicalFamily {
  if (isPowerInfra(device)) return 'power';

  const n = deviceNameLower(device);
  const t = device.type;

  // --- Guitar chain (instrument → pedals → amp → cab mic) ---
  if (t === DeviceType.PEDALBOARD || t === DeviceType.PEDAL) return 'guitar';
  if (t === DeviceType.AMPLIFIER) return 'guitar';
  if (t === DeviceType.INSTRUMENT) {
    if (/\bbass\b|бас/.test(n) || /guitar|гитар|squier|jackson|mustang|dinky|jb-/.test(n)) {
      return 'guitar';
    }
    return 'guitar';
  }
  // Mic that mics a combo sits with the amp, not the vocal chain.
  if (
    t === DeviceType.MICROPHONE &&
    (n.includes('combo') || n.includes('e835') || n.includes('cab mic') || n.includes('amp mic'))
  ) {
    return 'guitar';
  }

  // --- Vocal chain ---
  if (t === DeviceType.VOCAL_PROCESSOR) return 'vocal';
  if (t === DeviceType.MICROPHONE) return 'vocal';
  if (t === DeviceType.MONITOR && (n.includes('iem') || n.includes('earphone') || n.includes('in-ear'))) {
    return 'vocal';
  }
  // Volt / UA interface often sits in the vocal path for Dan.
  if (t === DeviceType.AUDIO_INTERFACE && (n.includes('volt') || n.includes('vocal'))) {
    return 'vocal';
  }

  // --- Keys / synths ---
  if (t === DeviceType.KEYBOARD || t === DeviceType.MIDI_DEVICE) return 'keys';
  if (t === DeviceType.LAPTOP && (n.includes('synth') || n.includes('keys') || n.includes('клав'))) {
    return 'keys';
  }

  // --- Laptop / playback ---
  if (t === DeviceType.LAPTOP) return 'laptop';

  // --- Stage IO / FOH rack ---
  if (
    t === DeviceType.STAGE_BOX ||
    t === DeviceType.AUDIO_INTERFACE ||
    t === DeviceType.MIXER ||
    t === DeviceType.MONITOR_CONTROLLER ||
    t === DeviceType.MONITOR
  ) {
    return 'io';
  }
  if (n.includes('motu') || n.includes('stage box') || n.includes('стейдж') || n.includes('stagebox')) {
    return 'io';
  }

  if (t === DeviceType.LIGHT) return 'other';
  return 'other';
}

const FALLBACK_WIDTH = 260;
const FALLBACK_HEIGHT = 240;
/** One port row in DeviceNode (py-1.5 + icon line ≈ 28px). */
const PORT_ROW_H = 28;
/** Header / chips / padding above the port list. */
const CARD_CHROME_H = 72;
/** "Show all ports" / collapse control row when list is long. */
const EXPAND_CTRL_H = 28;
/** Image banner on cards that have photos. */
const IMAGE_BANNER_H = 140;

/**
 * Spacing for Arrange. Vertical gaps always assume a card may be fully expanded
 * (all ports visible) so neighbours never collide when the user opens the list.
 * Bump LAYOUT_REVISION when packing rules change so old saves re-arrange once.
 */
const COLUMN_GAP = 140;
/** Air between stacked ranks — expanded card height already reserves port rows. */
const ROW_GAP = 72;
/** Gap between disconnected components inside one family. */
const CHAIN_GAP = 96;
/** Vertical gap between logical families (guitar / vocal / io) — keep readable, not sparse. */
const FAMILY_GAP = 100;
/** Hard separation between role zones — never eroded by overlap pushes. */
const ZONE_GAP_X = 420;
const ZONE_GAP_Y = 280;
const PIN_GAP = 56;
/** Base keep-out between boxes; extra clearance scales with port fan-out. */
const OVERLAP_GAP = 48;
/** Extra px of keep-out per port beyond 2 (I/O-heavy cards need more copper air). */
const CLEARANCE_PER_PORT = 10;
const CLEARANCE_PORT_CAP = 140;

/** Bump when zone packing changes — triggers one client re-layout for old saves. */
export const LAYOUT_REVISION = '11-free-slot-outward-pack';

/** How much empty margin a card needs around itself for stubs/lanes. */
export function fanoutClearance(portRows: number): number {
  return Math.min(CLEARANCE_PORT_CAP, Math.max(0, portRows - 2) * CLEARANCE_PER_PORT);
}

const isPowerCable = (c: LayoutCable): boolean =>
  (c.cableType ?? '').toUpperCase() === 'POWER_LINE';

const isAudioishCable = (c: LayoutCable): boolean => {
  const t = (c.cableType ?? '').toUpperCase();
  if (!t) return true; // unknown → treat as signal for ranking
  return t !== 'POWER_LINE';
};

/**
 * Longest-path ranks along directed edges (source → target = connection order).
 * Roots (no incoming) sit at rank 0; each hop increments rank — so a pedalboard
 * daisy-chain becomes columns L→R in patch order.
 */
export function computeFlowRanks(
  nodeIds: readonly string[],
  directed: ReadonlyArray<readonly [string, string]>,
): Map<string, number> {
  const ids = new Set(nodeIds);
  const outgoing = new Map<string, string[]>();
  const indeg = new Map<string, number>();
  for (const id of nodeIds) {
    outgoing.set(id, []);
    indeg.set(id, 0);
  }
  for (const [s, t] of directed) {
    if (!ids.has(s) || !ids.has(t) || s === t) continue;
    outgoing.get(s)!.push(t);
    indeg.set(t, (indeg.get(t) ?? 0) + 1);
  }

  const rank = new Map<string, number>();
  for (const id of nodeIds) rank.set(id, 0);

  const remaining = new Map(indeg);
  const queue = nodeIds.filter((id) => (remaining.get(id) ?? 0) === 0);
  const visited = new Set<string>();

  const enqueueReady = () => {
    // no-op helper for cycle break below
  };
  void enqueueReady;

  while (visited.size < nodeIds.length) {
    if (queue.length === 0) {
      // Cycle or unreachable: start from any unvisited with lowest current rank.
      const rest = nodeIds
        .filter((id) => !visited.has(id))
        .sort((a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0) || a.localeCompare(b));
      if (rest.length === 0) break;
      queue.push(rest[0]);
    }
    const u = queue.shift()!;
    if (visited.has(u)) continue;
    visited.add(u);
    for (const v of outgoing.get(u) ?? []) {
      rank.set(v, Math.max(rank.get(v) ?? 0, (rank.get(u) ?? 0) + 1));
      remaining.set(v, (remaining.get(v) ?? 1) - 1);
      if ((remaining.get(v) ?? 0) <= 0 && !visited.has(v)) queue.push(v);
    }
  }
  return rank;
}

/** Type-based seed when a device has no cables yet (still reads left→right sensibly). */
function seedAudioRank(device: LayoutDevice): number {
  switch (device.type) {
    case DeviceType.INSTRUMENT:
    case DeviceType.MICROPHONE:
      return 0;
    case DeviceType.PEDAL:
    case DeviceType.PEDALBOARD:
      return 1;
    case DeviceType.AMPLIFIER:
    case DeviceType.VOCAL_PROCESSOR:
      return 2;
    case DeviceType.KEYBOARD:
    case DeviceType.MIDI_DEVICE:
      return 2;
    case DeviceType.AUDIO_INTERFACE:
    case DeviceType.MIXER:
    case DeviceType.STAGE_BOX:
      return 3;
    case DeviceType.MONITOR_CONTROLLER:
      return 4;
    case DeviceType.MONITOR:
    case DeviceType.LAPTOP:
      return 5;
    default:
      return 3;
  }
}

function seedPowerRank(device: LayoutDevice): number {
  const n = deviceNameLower(device);
  // Wall outlet first, then extension, then bricks / ISO supplies.
  if (device.type === DeviceType.POWER_STRIP) {
    if (n.includes('venue') || n.includes('outlet') || n.includes('розет')) return 0;
    return 1; // Anker etc.
  }
  if (device.type === DeviceType.POWER_SPLITTER) return 2;
  if (device.type === DeviceType.POWER_SUPPLY) return 3;
  return 2;
}

/**
 * Merge flow ranks with type seeds: devices on the graph keep flow ranks;
 * isolates get seeded so a lone guitar still sits left of a lone amp.
 */
function ranksForDevices(
  devices: LayoutDevice[],
  directed: ReadonlyArray<readonly [string, string]>,
  seed: (d: LayoutDevice) => number,
): Map<string, number> {
  const ids = devices.map((d) => d.id);
  const flow = computeFlowRanks(ids, directed);
  const used = new Set<string>();
  for (const [s, t] of directed) {
    used.add(s);
    used.add(t);
  }
  const out = new Map<string, number>();
  for (const d of devices) {
    if (used.has(d.id)) {
      out.set(d.id, flow.get(d.id) ?? 0);
    } else {
      out.set(d.id, seed(d));
    }
  }
  // Re-base so densify works well even when seeds and flow mix.
  return out;
}

export type ZoneName = 'andrii' | 'drummer' | 'vox' | 'service' | 'inactive';

/**
 * Normalize free-text ownerRole (RU/EN/slug) into a zone key.
 * Same aliases as formatOwnerRole — without this, everything dumps into service.
 */
export function normalizeOwnerZone(ownerRole: string | null | undefined): ZoneName | null {
  if (!ownerRole) return null;
  const t = ownerRole.trim().toLowerCase().replace(/\s+/g, ' ');
  if (
    t === 'andrii' ||
    t === 'андрей' ||
    t === 'andrey' ||
    t === 'андрій'
  ) {
    return 'andrii';
  }
  if (
    t === 'danvox' ||
    t === 'dan-vox' ||
    t === 'dan' ||
    t === 'даня-вокал' ||
    t === 'даня вокал' ||
    t === 'даня' ||
    t === 'vox'
  ) {
    return 'vox';
  }
  if (
    t === 'dandrummer' ||
    t === 'dan-drummer' ||
    t === 'dan drummer' ||
    t === 'даня-барабанщик' ||
    t === 'даня барабанщик' ||
    t === 'drummer'
  ) {
    return 'drummer';
  }
  return null;
}

export function zoneOf(device: LayoutDevice): ZoneName {
  if (
    device.inventoryStatus === InventoryStatus.OWNED_INACTIVE ||
    device.inventoryStatus === InventoryStatus.PLANNED_NOT_OWNED
  ) {
    return 'inactive';
  }
  // Owner wins over type — a stage box belonging to Andrii stays in Andrii's zone.
  const byOwner = normalizeOwnerZone(device.ownerRole);
  if (byOwner) return byOwner;
  if (device.type === DeviceType.STAGE_BOX) return 'service';
  return 'service';
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
 * Place a chain left→right by densified rank (signal flow).
 * Same-rank order is taken from `rankOf` + optional pre-sorted chain order
 * (barycenter), then stacked top→bottom.
 */
function placeChain(
  chain: LayoutDevice[],
  rankOf: Map<string, number>,
  sizeOf: (id: string) => SizedDevice,
  xOffset: number,
  yOffset: number,
  /** Preferred order within each rank (barycenter). Falls back to chain order. */
  orderHint: Map<string, number> = new Map(),
): ZoneLayout {
  const positions = new Map<string, { x: number; y: number }>();
  if (chain.length === 0) return { positions, width: 0, height: 0 };

  let maxRank = 0;
  const rankDevices = new Map<number, LayoutDevice[]>();
  for (const d of chain) {
    const rank = rankOf.get(d.id) ?? 0;
    maxRank = Math.max(maxRank, rank);
    const list = rankDevices.get(rank) ?? [];
    list.push(d);
    rankDevices.set(rank, list);
  }

  // Sort each rank by barycenter hint, then id for stability.
  for (const [r, list] of rankDevices) {
    list.sort((a, b) => {
      const oa = orderHint.get(a.id) ?? 0;
      const ob = orderHint.get(b.id) ?? 0;
      if (oa !== ob) return oa - ob;
      return a.id.localeCompare(b.id);
    });
    rankDevices.set(r, list);
  }

  const rankX = new Map<number, number>();
  let currentX = xOffset;
  for (let r = 0; r <= maxRank; r++) {
    rankX.set(r, currentX);
    const devicesInRank = rankDevices.get(r) ?? [];
    const maxW =
      devicesInRank.length > 0
        ? Math.max(...devicesInRank.map((d) => sizeOf(d.id).width))
        : FALLBACK_WIDTH;
    currentX += maxW + COLUMN_GAP;
  }

  let chainHeight = 0;
  let chainRight = xOffset;
  for (let r = 0; r <= maxRank; r++) {
    const siblings = rankDevices.get(r) ?? [];
    let y = yOffset;
    for (const d of siblings) {
      const s = sizeOf(d.id);
      const x = rankX.get(r) ?? xOffset;
      positions.set(d.id, { x, y });
      chainHeight = Math.max(chainHeight, y - yOffset + s.height);
      chainRight = Math.max(chainRight, x + s.width);
      y += s.height + ROW_GAP;
    }
  }

  return {
    positions,
    width: Math.max(0, chainRight - xOffset),
    height: chainHeight,
  };
}

function densifyRanks(chain: LayoutDevice[], rawRankOf: Map<string, number>): Map<string, number> {
  const distinct = [...new Set(chain.map((d) => rawRankOf.get(d.id) ?? 0))].sort((a, b) => a - b);
  const denseIndex = new Map(distinct.map((raw, i) => [raw, i]));
  return new Map(chain.map((d) => [d.id, denseIndex.get(rawRankOf.get(d.id) ?? 0)!]));
}

/** Total Manhattan wire length between device centres for edges fully inside the set. */
function totalWireLength(
  edges: ReadonlyArray<readonly [string, string]>,
  positions: Map<string, { x: number; y: number }>,
  sizeOf: (id: string) => SizedDevice,
): number {
  let len = 0;
  for (const [s, t] of edges) {
    const ps = positions.get(s);
    const pt = positions.get(t);
    if (!ps || !pt) continue;
    const ss = sizeOf(s);
    const st = sizeOf(t);
    const cx = ps.x + ss.width / 2;
    const cy = ps.y + ss.height / 2;
    const dx = pt.x + st.width / 2;
    const dy = pt.y + st.height / 2;
    len += Math.abs(dx - cx) + Math.abs(dy - cy);
  }
  return len;
}

/**
 * Within a zone: swap node positions when it shortens cables (and doesn't worsen
 * crossings too much). Complements greedySwapMinimize which only looks at crossings.
 */
function greedyWireMinimize(
  nodeIds: readonly string[],
  edges: ReadonlyArray<readonly [string, string]>,
  positions: Map<string, { x: number; y: number }>,
  sizeOf: (id: string) => SizedDevice,
  maxPasses = 10,
): void {
  if (nodeIds.length < 2 || edges.length === 0) return;
  const sizeMap = new Map(nodeIds.map((id) => [id, sizeOf(id)] as const));
  const relevant = edges.filter(([s, t]) => positions.has(s) && positions.has(t));
  if (relevant.length === 0) return;

  for (let pass = 0; pass < maxPasses; pass++) {
    let improved = false;
    for (let i = 0; i < nodeIds.length; i++) {
      for (let j = i + 1; j < nodeIds.length; j++) {
        const idA = nodeIds[i];
        const idB = nodeIds[j];
        const posA = positions.get(idA);
        const posB = positions.get(idB);
        if (!posA || !posB) continue;

        const before = totalWireLength(relevant, positions, sizeOf);
        const centersBefore = buildCenterMapLocal(positions, sizeMap);
        const crossBefore = countCrossingsLocal(relevant, centersBefore);

        positions.set(idA, posB);
        positions.set(idB, posA);

        const after = totalWireLength(relevant, positions, sizeOf);
        const centersAfter = buildCenterMapLocal(positions, sizeMap);
        const crossAfter = countCrossingsLocal(relevant, centersAfter);

        // Accept if shorter wires and crossings not worse (or crossings drop).
        if (after + 1 < before && crossAfter <= crossBefore + 0) {
          improved = true;
        } else if (crossAfter < crossBefore && after <= before * 1.05) {
          improved = true;
        } else {
          positions.set(idA, posA);
          positions.set(idB, posB);
        }
      }
    }
    if (!improved) break;
  }
}

function buildCenterMapLocal(
  positions: Map<string, { x: number; y: number }>,
  sizes: Map<string, SizedDevice>,
): Map<string, { x: number; y: number }> {
  const centers = new Map<string, { x: number; y: number }>();
  for (const [id, pos] of positions) {
    const s = sizes.get(id);
    if (!s) continue;
    centers.set(id, { x: pos.x + s.width / 2, y: pos.y + s.height / 2 });
  }
  return centers;
}

function countCrossingsLocal(
  edges: ReadonlyArray<readonly [string, string]>,
  center: Map<string, { x: number; y: number }>,
): number {
  // Thin re-export path — use crossings module when available via import.
  return countCrossings(edges, center);
}

/** Barycenter order for nodes in a rank given neighbor positions (Sugiyama). */
function barycenterOrder(
  nodes: LayoutDevice[],
  neighborsOf: Map<string, string[]>,
  orderOf: Map<string, number>,
): Map<string, number> {
  const scores = new Map<string, number>();
  for (const d of nodes) {
    const nbs = neighborsOf.get(d.id) ?? [];
    if (nbs.length === 0) {
      scores.set(d.id, orderOf.get(d.id) ?? 0);
      continue;
    }
    let sum = 0;
    let n = 0;
    for (const nb of nbs) {
      if (orderOf.has(nb)) {
        sum += orderOf.get(nb)!;
        n++;
      }
    }
    scores.set(d.id, n > 0 ? sum / n : (orderOf.get(d.id) ?? 0));
  }
  const sorted = [...nodes].sort(
    (a, b) => (scores.get(a.id) ?? 0) - (scores.get(b.id) ?? 0) || a.id.localeCompare(b.id),
  );
  const out = new Map<string, number>();
  sorted.forEach((d, i) => out.set(d.id, i));
  return out;
}

/**
 * Layout one connected component L→R with barycenter ordering.
 * Returns local positions (relative to x0,y0) and bbox size.
 */
function layoutComponent(
  comp: LayoutDevice[],
  rawRankOf: Map<string, number>,
  zoneEdges: [string, string][],
  sizeOf: (id: string) => SizedDevice,
  x0: number,
  y0: number,
): ZoneLayout {
  if (comp.length === 0) return { positions: new Map(), width: 0, height: 0 };

  const ranks = densifyRanks(comp, rawRankOf);
  const maxR = Math.max(0, ...[...ranks.values()]);

  const neighborsOf = new Map<string, string[]>();
  for (const d of comp) neighborsOf.set(d.id, []);
  for (const [s, t] of zoneEdges) {
    if (!ranks.has(s) || !ranks.has(t)) continue;
    neighborsOf.get(s)!.push(t);
    neighborsOf.get(t)!.push(s);
  }

  let orderHint = new Map<string, number>();
  for (const d of comp) orderHint.set(d.id, ranks.get(d.id) ?? 0);

  for (let pass = 0; pass < 4; pass++) {
    const forward = pass % 2 === 0;
    const rankList = forward
      ? Array.from({ length: maxR + 1 }, (_, r) => r)
      : Array.from({ length: maxR + 1 }, (_, r) => maxR - r);

    const nextOrder = new Map(orderHint);
    for (const r of rankList) {
      const nodesAtR = comp.filter((d) => ranks.get(d.id) === r);
      const localNeighbors = new Map<string, string[]>();
      for (const d of nodesAtR) {
        const nbs = (neighborsOf.get(d.id) ?? []).filter((nb) => {
          const nr = ranks.get(nb) ?? -1;
          return forward ? nr < r : nr > r;
        });
        localNeighbors.set(d.id, nbs.length > 0 ? nbs : (neighborsOf.get(d.id) ?? []));
      }
      const ordered = barycenterOrder(nodesAtR, localNeighbors, nextOrder);
      for (const [id, o] of ordered) nextOrder.set(id, r * 1000 + o);
    }
    orderHint = nextOrder;
  }

  const flatHint = new Map<string, number>();
  for (let r = 0; r <= maxR; r++) {
    const nodesAtR = comp
      .filter((d) => ranks.get(d.id) === r)
      .sort((a, b) => (orderHint.get(a.id) ?? 0) - (orderHint.get(b.id) ?? 0));
    nodesAtR.forEach((d, i) => flatHint.set(d.id, i));
  }

  return placeChain(comp, ranks, sizeOf, x0, y0, flatHint);
}

/** Connected components within a set of devices using undirected zone edges. */
function connectedComponents(
  devices: LayoutDevice[],
  zoneEdges: [string, string][],
  rankOf: Map<string, number>,
): LayoutDevice[][] {
  const ids = new Set(devices.map((d) => d.id));
  const adj = new Map<string, Set<string>>();
  for (const d of devices) adj.set(d.id, new Set());
  for (const [s, t] of zoneEdges) {
    if (ids.has(s) && ids.has(t)) {
      adj.get(s)!.add(t);
      adj.get(t)!.add(s);
    }
  }

  const visited = new Set<string>();
  const comps: LayoutDevice[][] = [];
  for (const d of devices) {
    if (visited.has(d.id)) continue;
    const comp: LayoutDevice[] = [];
    const queue = [d.id];
    visited.add(d.id);
    while (queue.length > 0) {
      const curr = queue.shift()!;
      const dev = devices.find((x) => x.id === curr);
      if (dev) comp.push(dev);
      for (const neighbor of adj.get(curr) ?? []) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }
    comp.sort(
      (a, b) => (rankOf.get(a.id) ?? 0) - (rankOf.get(b.id) ?? 0) || a.id.localeCompare(b.id),
    );
    comps.push(comp);
  }
  comps.sort((a, b) => b.length - a.length || a[0].id.localeCompare(b[0].id));
  return comps;
}

/**
 * Layout one role zone in local coordinates (origin top-left).
 *
 * Structure:
 *   - Logical families stack top→bottom (guitar, vocal, keys, laptop, io…).
 *   - Inside a family: devices L→R in **connection order** (cable source→target).
 *   - Power family: L→R by power chain (outlet → strip → PSU), not a random stack.
 */
function layoutZone(
  zoneDevices: LayoutDevice[],
  cables: LayoutCable[],
  portToDevice: Map<string, string>,
  sizeOf: (id: string) => SizedDevice,
): ZoneLayout {
  const positions = new Map<string, { x: number; y: number }>();
  if (zoneDevices.length === 0) return { positions, width: 0, height: 0 };

  const ids = new Set(zoneDevices.map((d) => d.id));

  // Directed device edges from cables (source port device → target port device).
  const allDirected: [string, string][] = [];
  const audioDirected: [string, string][] = [];
  const powerDirected: [string, string][] = [];
  for (const c of cables) {
    const s = portToDevice.get(c.sourcePortId);
    const t = portToDevice.get(c.targetPortId);
    if (!s || !t || s === t || !ids.has(s) || !ids.has(t)) continue;
    allDirected.push([s, t]);
    if (isPowerCable(c)) powerDirected.push([s, t]);
    if (isAudioishCable(c)) audioDirected.push([s, t]);
  }
  // Undirected view for component finding / polish.
  const zoneEdges: [string, string][] = allDirected.map(([a, b]) => [a, b]);

  // Audio ranks: pure signal flow (ignore power hops so an Anker doesn't pull pedals left).
  const audioRankOf = ranksForDevices(zoneDevices, audioDirected, seedAudioRank);
  // Power ranks: outlet → extension → brick.
  const powerRankOf = ranksForDevices(
    zoneDevices.filter(isPowerInfra),
    powerDirected.length > 0 ? powerDirected : allDirected,
    seedPowerRank,
  );

  // Bucket by logical family.
  const byFamily = new Map<LogicalFamily, LayoutDevice[]>();
  for (const d of zoneDevices) {
    const fam = logicalFamily(d);
    const list = byFamily.get(fam) ?? [];
    list.push(d);
    byFamily.set(fam, list);
  }

  // --- Power chain as a TOP row (L→R: outlet → strip → brick) ---
  // Sitting power on the left forced a tall empty gutter and stretched zones vertically.
  const power = byFamily.get('power') ?? [];
  let powerBlockHeight = 0;
  if (power.length > 0) {
    const pRanks = densifyRanks(power, powerRankOf);
    const powerComps = connectedComponents(
      power,
      powerDirected.length ? powerDirected : zoneEdges,
      pRanks,
    );
    let py = 0;
    let pw = 0;
    for (let i = 0; i < powerComps.length; i++) {
      const chain = placeChain(powerComps[i], densifyRanks(powerComps[i], pRanks), sizeOf, 0, py);
      for (const [id, pos] of chain.positions) positions.set(id, pos);
      pw = Math.max(pw, chain.width);
      py += chain.height + (i < powerComps.length - 1 ? CHAIN_GAP : 0);
    }
    powerBlockHeight = py + FAMILY_GAP;
  }

  // Signal families pack from y = powerBlockHeight, x = 0.
  // Dense zones (Andrii): place two short families side-by-side when both fit.
  type FamilyBlock = { fam: LogicalFamily; width: number; height: number; positions: Map<string, { x: number; y: number }> };
  const familyBlocks: FamilyBlock[] = [];

  for (const fam of FAMILY_ORDER) {
    if (fam === 'power') continue;
    const members = byFamily.get(fam);
    if (!members || members.length === 0) continue;

    const famAudioEdges = audioDirected.filter(
      ([s, t]) => members.some((d) => d.id === s) && members.some((d) => d.id === t),
    );
    const famRankOf = ranksForDevices(members, famAudioEdges, seedAudioRank);
    const comps = connectedComponents(
      members,
      famAudioEdges.length > 0 ? famAudioEdges : zoneEdges,
      famRankOf,
    );

    const local = new Map<string, { x: number; y: number }>();
    let familyHeight = 0;
    let familyWidth = 0;
    for (let ci = 0; ci < comps.length; ci++) {
      const chain = layoutComponent(
        comps[ci],
        famRankOf,
        famAudioEdges.length > 0 ? famAudioEdges : zoneEdges,
        sizeOf,
        0,
        familyHeight,
      );
      for (const [id, pos] of chain.positions) local.set(id, pos);
      familyWidth = Math.max(familyWidth, chain.width);
      familyHeight += chain.height + (ci < comps.length - 1 ? CHAIN_GAP : 0);
    }
    familyBlocks.push({ fam, width: familyWidth, height: familyHeight, positions: local });
  }

  // Pack family blocks: try horizontal pairing (guitar|io, keys|laptop) to cut vertical sprawl.
  let cursorY = powerBlockHeight;
  let cursorX = 0;
  let rowH = 0;
  let zoneW = 0;
  const canPair = (a: LogicalFamily, b: LogicalFamily) =>
    (a === 'guitar' && b === 'io') ||
    (a === 'io' && b === 'guitar') ||
    (a === 'keys' && b === 'laptop') ||
    (a === 'laptop' && b === 'keys') ||
    (a === 'vocal' && b === 'laptop') ||
    (a === 'laptop' && b === 'vocal');

  let i = 0;
  while (i < familyBlocks.length) {
    const cur = familyBlocks[i];
    const next = familyBlocks[i + 1];
    const pair =
      next &&
      canPair(cur.fam, next.fam) &&
      cur.width + COLUMN_GAP + next.width < 2200;

    if (pair && next) {
      for (const [id, pos] of cur.positions) {
        positions.set(id, { x: pos.x + cursorX, y: pos.y + cursorY });
      }
      for (const [id, pos] of next.positions) {
        positions.set(id, {
          x: pos.x + cursorX + cur.width + COLUMN_GAP,
          y: pos.y + cursorY,
        });
      }
      const rowWidth = cur.width + COLUMN_GAP + next.width;
      const rowHeight = Math.max(cur.height, next.height);
      zoneW = Math.max(zoneW, rowWidth);
      cursorY += rowHeight + FAMILY_GAP;
      i += 2;
    } else {
      for (const [id, pos] of cur.positions) {
        positions.set(id, { x: pos.x + cursorX, y: pos.y + cursorY });
      }
      zoneW = Math.max(zoneW, cur.width);
      cursorY += cur.height + FAMILY_GAP;
      i += 1;
    }
    rowH = cursorY;
  }
  if (familyBlocks.length > 0) {
    cursorY = Math.max(0, cursorY - FAMILY_GAP);
  }
  let blockHeight = Math.max(cursorY, powerBlockHeight > 0 ? powerBlockHeight - FAMILY_GAP : 0);

  // Leftovers (shouldn't happen).
  for (const d of zoneDevices) {
    if (!positions.has(d.id)) {
      const s = sizeOf(d.id);
      positions.set(d.id, { x: 0, y: blockHeight });
      blockHeight += s.height + ROW_GAP;
    }
  }
  void rowH;
  void zoneW;

  const zoneIds = zoneDevices.map((d) => d.id);
  const sizeMap = new Map(zoneIds.map((id) => [id, sizeOf(id)] as const));
  resolveNodeOverlaps(zoneIds, positions, sizeMap, OVERLAP_GAP);

  // Polish only inside each family — and only swap nodes in the *same* flow rank
  // so we never reverse connection order (guitar after amp, etc.).
  for (const fam of FAMILY_ORDER) {
    const members = byFamily.get(fam);
    if (!members || members.length < 2) continue;
    const famIds = members.map((d) => d.id);
    const rankMap = fam === 'power' ? powerRankOf : audioRankOf;
    // Group by rank; polish within rank only.
    const byRank = new Map<number, string[]>();
    for (const id of famIds) {
      const r = rankMap.get(id) ?? 0;
      const list = byRank.get(r) ?? [];
      list.push(id);
      byRank.set(r, list);
    }
    const famEdges = zoneEdges.filter(([s, t]) => famIds.includes(s) && famIds.includes(t));
    for (const [, rankIds] of byRank) {
      if (rankIds.length < 2) continue;
      const subEdges = famEdges.filter(([s, t]) => rankIds.includes(s) || rankIds.includes(t));
      greedySwapMinimize(rankIds, subEdges.length ? subEdges : famEdges, positions, sizeMap, 8);
    }
    resolveNodeOverlaps(famIds, positions, sizeMap, OVERLAP_GAP);
  }
  resolveNodeOverlaps(zoneIds, positions, sizeMap, OVERLAP_GAP);

  // After polish: enforce X monotonicity along directed edges (connection order).
  enforceFlowOrderX(zoneIds, audioDirected.concat(powerDirected), positions, sizeOf);

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const id of zoneIds) {
    const p = positions.get(id);
    if (!p) continue;
    const s = sizeOf(id);
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x + s.width);
    maxY = Math.max(maxY, p.y + s.height);
  }
  if (!Number.isFinite(minX)) {
    return { positions, width: 0, height: 0 };
  }

  if (minX !== 0 || minY !== 0) {
    for (const id of zoneIds) {
      const p = positions.get(id);
      if (!p) continue;
      positions.set(id, { x: p.x - minX, y: p.y - minY });
    }
    maxX -= minX;
    maxY -= minY;
  }

  return {
    positions,
    width: Math.max(0, maxX),
    height: Math.max(0, maxY),
  };
}

/**
 * Ensure for every directed edge A→B, A is not to the right of B (same family row).
 * Pulls B rightward if order inverted — preserves connection left→right reading.
 */
function enforceFlowOrderX(
  nodeIds: readonly string[],
  directed: ReadonlyArray<readonly [string, string]>,
  positions: Map<string, { x: number; y: number }>,
  sizeOf: (id: string) => SizedDevice,
  gap = COLUMN_GAP,
): void {
  const idSet = new Set(nodeIds);
  // Multi-pass: fixing A→B can break B→C.
  for (let pass = 0; pass < 8; pass++) {
    let moved = false;
    for (const [s, t] of directed) {
      if (!idSet.has(s) || !idSet.has(t)) continue;
      const ps = positions.get(s);
      const pt = positions.get(t);
      if (!ps || !pt) continue;
      const ss = sizeOf(s);
      const minTx = ps.x + ss.width + gap;
      if (pt.x < minTx) {
        positions.set(t, { x: minTx, y: pt.y });
        moved = true;
      }
    }
    if (!moved) break;
  }
}

function layoutContainerChildren(
  children: LayoutDevice[],
  sizeOf: (id: string) => SizedDevice,
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  if (children.length === 0) return positions;

  const power = children.filter(isPowerInfra);
  const signal = children.filter((d) => !isPowerInfra(d));

  const COLS = 4;
  const GAP_X = 340;

  let currentY = 0;
  for (let i = 0; i < signal.length; i += COLS) {
    const rowDevices = signal.slice(i, i + COLS);
    const maxRowH = Math.max(...rowDevices.map((d) => sizeOf(d.id).height), FALLBACK_HEIGHT);
    rowDevices.forEach((d, colIndex) => {
      positions.set(d.id, { x: colIndex * GAP_X, y: currentY });
    });
    currentY += maxRowH + 100;
  }

  power.forEach((d, i) => {
    positions.set(d.id, { x: i * GAP_X, y: currentY });
  });

  const childIds = children.map((d) => d.id);
  const childSizes = new Map(childIds.map((id) => [id, sizeOf(id)] as const));
  resolveNodeOverlaps(childIds, positions, childSizes, 40);

  return positions;
}

/**
 * Anchor zones in a clear stage map:
 *
 *   [ Andrii ] ---- [ Vox ] ---- [ Drummer ]
 *   [ Service .............. ]
 *   [ Inactive ............. ]
 *
 * Gaps are fixed; devices never migrate across zone borders.
 */
export function computeAutoLayout(
  devices: LayoutDevice[],
  cables: LayoutCable[],
  sizes: Map<string, { width: number; height: number }> | Record<string, { width: number; height: number }>,
): LayoutResult {
  const sizeLookup = sizes instanceof Map ? sizes : new Map(Object.entries(sizes));
  const deviceById = new Map(devices.map((d) => [d.id, d]));

  const topAncestorId = (device: LayoutDevice): string => {
    let current = device;
    while (current.parentDeviceId) {
      const parent = deviceById.get(current.parentDeviceId);
      if (!parent) break;
      current = parent;
    }
    return current.id;
  };

  const portToDevice = new Map<string, string>();
  for (const d of devices) {
    const nodeId = topAncestorId(d);
    for (const p of d.ports) portToDevice.set(p.id, nodeId);
  }

  const mainDevices = devices.filter((d) => !d.parentDeviceId);

  // Children ports of containers become boundary rows on the parent card.
  const childPortCountByParent = new Map<string, number>();
  for (const d of devices) {
    if (!d.parentDeviceId) continue;
    childPortCountByParent.set(
      d.parentDeviceId,
      (childPortCountByParent.get(d.parentDeviceId) ?? 0) + d.ports.length,
    );
  }

  /**
   * Card size for packing: always the *expanded* height (every port row visible).
   * Measured size is only used when it is taller (real chrome, accessories, etc.) —
   * never when smaller (collapsed unused ports), so Arrange leaves room to expand.
   */
  const sizeOf = (id: string): { width: number; height: number } => {
    const dev = deviceById.get(id);
    const measured = sizeLookup.get(id);
    const ownPorts = dev?.ports.length ?? 0;
    // Containers show external (boundary) ports from children on the main card.
    const boundaryPorts = childPortCountByParent.get(id) ?? 0;
    const portRows = Math.max(ownPorts + boundaryPorts, ownPorts > 0 || boundaryPorts > 0 ? 1 : 0);
    const hasImage =
      !!dev &&
      dev.type !== DeviceType.PEDALBOARD &&
      !!(dev.imageUrl || (dev.imageUrls && dev.imageUrls.length > 0));

    const portsBlock = portRows * PORT_ROW_H;
    const expandCtrl = portRows > 4 ? EXPAND_CTRL_H : 0;
    // "Open inside" row for containers with ported children.
    const hasPortedChildren = (childPortCountByParent.get(id) ?? 0) > 0;
    const insideBtn = hasPortedChildren ? 40 : 0;

    const expandedH =
      (hasImage ? IMAGE_BANNER_H : 0) +
      CARD_CHROME_H +
      portsBlock +
      expandCtrl +
      insideBtn +
      8;

    // Never trust a short measured height from a collapsed card.
    const bodyH = Math.max(expandedH, measured?.height ?? 0, FALLBACK_HEIGHT);
    const bodyW = Math.max(measured?.width ?? FALLBACK_WIDTH, 240);
    // Inflate packing footprint by port fan-out so neighbours leave air for stubs/lanes.
    // Visual card still draws at top-left; the extra size is empty margin in the layout grid.
    const clear = fanoutClearance(portRows);
    return { width: bodyW + clear, height: bodyH + clear };
  };
  const sizedOf = (id: string): SizedDevice => ({ id, ...sizeOf(id) });

  const groups: Record<ZoneName, LayoutDevice[]> = {
    andrii: [],
    drummer: [],
    vox: [],
    service: [],
    inactive: [],
  };
  for (const d of mainDevices) groups[zoneOf(d)].push(d);

  const andrii = layoutZone(groups.andrii, cables, portToDevice, sizedOf);
  const drummer = layoutZone(groups.drummer, cables, portToDevice, sizedOf);
  const vox = layoutZone(groups.vox, cables, portToDevice, sizedOf);
  const service = layoutZone(groups.service, cables, portToDevice, sizedOf);
  const inactive = layoutZone(groups.inactive, cables, portToDevice, sizedOf);

  const positions = new Map<string, { x: number; y: number }>();
  const place = (zone: ZoneLayout, anchorX: number, anchorY: number) => {
    for (const [id, pos] of zone.positions) {
      positions.set(id, { x: pos.x + anchorX, y: pos.y + anchorY });
    }
  };

  // Top row: role zones left → right with hard corridors.
  let x = 0;
  place(andrii, x, 0);
  x += (andrii.width > 0 ? andrii.width + ZONE_GAP_X : 0);

  place(vox, x, 0);
  x += (vox.width > 0 ? vox.width + ZONE_GAP_X : 0);

  place(drummer, x, 0);
  x += (drummer.width > 0 ? drummer.width + ZONE_GAP_X : 0);

  const topRowHeight = Math.max(andrii.height, vox.height, drummer.height, 0);
  const topRowWidth = Math.max(
    0,
    (andrii.width > 0 ? andrii.width : 0) +
      (andrii.width > 0 && vox.width > 0 ? ZONE_GAP_X : 0) +
      (vox.width > 0 ? vox.width : 0) +
      ((andrii.width > 0 || vox.width > 0) && drummer.width > 0 ? ZONE_GAP_X : 0) +
      (drummer.width > 0 ? drummer.width : 0),
  );

  // Service under the stage roles — own band, not mixed into roles.
  const serviceY = topRowHeight > 0 ? topRowHeight + ZONE_GAP_Y : 0;
  place(service, 0, serviceY);

  // Inactive further down (or under top row if no service).
  const inactiveAnchorY =
    service.height > 0
      ? serviceY + service.height + ZONE_GAP_Y
      : topRowHeight > 0
        ? topRowHeight + ZONE_GAP_Y
        : 0;
  place(inactive, 0, inactiveAnchorY);

  void topRowWidth;

  const sizeMap = new Map(
    mainDevices.map((d) => {
      const { width, height } = sizeOf(d.id);
      return [d.id, { width, height }] as const;
    }),
  );

  const allEdges = cables
    .map((c) => [portToDevice.get(c.sourcePortId), portToDevice.get(c.targetPortId)] as const)
    .filter((e): e is [string, string] => e[0] != null && e[1] != null && e[0] !== e[1]);

  // Light polish only: resolve overlaps by pushing outward. No global swap after
  // family layout — that was cramming satellites into dense clusters.
  const zoneIdLists: string[][] = [
    groups.andrii.map((d) => d.id),
    groups.vox.map((d) => d.id),
    groups.drummer.map((d) => d.id),
    groups.service.map((d) => d.id),
    groups.inactive.map((d) => d.id),
  ];
  for (const zoneIds of zoneIdLists) {
    if (zoneIds.length < 2) continue;
    resolveNodeOverlaps(zoneIds, positions, sizeMap, OVERLAP_GAP);
  }

  /**
   * Pin `sat` near `anchor` into the first free slot (never into occupied space).
   */
  const pinBeside = (
    anchor: LayoutDevice,
    sat: LayoutDevice,
    mode: 'right' | 'below' = 'right',
    allowCrossZone = false,
  ) => {
    if (!allowCrossZone && zoneOf(anchor) !== zoneOf(sat)) return;
    const ap = positions.get(anchor.id);
    if (!ap) return;
    const as = sizedOf(anchor.id);
    const ss = sizedOf(sat.id);
    const preferred =
      mode === 'right'
        ? { x: ap.x + as.width + PIN_GAP, y: ap.y }
        : { x: ap.x, y: ap.y + as.height + PIN_GAP };
    // Cross-zone pins consider all main cards; same-zone pins stay local.
    const obstacleIds = allowCrossZone
      ? mainDevices.map((d) => d.id)
      : groups[zoneOf(anchor)].map((d) => d.id);
    positions.delete(sat.id);
    const free = findFreeSlot(sat.id, preferred, ss, obstacleIds, positions, sizeMap, OVERLAP_GAP);
    positions.set(sat.id, free);
  };

  const reflowZone = (z: ZoneName) => {
    const ids = groups[z].map((d) => d.id);
    if (ids.length < 2) return;
    resolveNodeOverlaps(ids, positions, sizeMap, OVERLAP_GAP);
  };

  // --- Logical affinity pins (related gear stays glued) ---

  // 1) Combo amp + its mic (e835s / "combo mic")
  for (const amp of mainDevices.filter((d) => d.type === DeviceType.AMPLIFIER)) {
    const mic = mainDevices.find(
      (d) =>
        d.type === DeviceType.MICROPHONE &&
        zoneOf(d) === zoneOf(amp) &&
        (nameIncludes(d, 'e835') ||
          nameIncludes(d, 'combo') ||
          nameIncludes(d, 'cab mic') ||
          nameIncludes(d, 'amp mic') ||
          (nameIncludes(d, 'Sennheiser') && normalizeOwnerZone(d.ownerRole) === 'vox')),
    );
    if (mic) {
      pinBeside(amp, mic, 'right');
      reflowZone(zoneOf(amp));
    }
  }

  // 2) Laptop + its USB-C / GaN charger (Apple 140W, Anker 140W, etc.)
  for (const laptop of mainDevices.filter((d) => d.type === DeviceType.LAPTOP)) {
    const charger = mainDevices.find((d) => {
      if (zoneOf(d) !== zoneOf(laptop)) return false;
      if (d.type !== DeviceType.POWER_SUPPLY) return false;
      const n = deviceNameLower(d);
      return (
        n.includes('140w') ||
        n.includes('usb-c') ||
        n.includes('usbc') ||
        n.includes('gan') ||
        n.includes('apple') ||
        (n.includes('anker') && n.includes('charger')) ||
        n.includes('macbook')
      );
    });
    if (charger) {
      pinBeside(laptop, charger, 'right');
      reflowZone(zoneOf(laptop));
    }
  }

  // 3) Pedalboard / pedal cluster: dedicated 9V PSU next to the pedal it names
  for (const psu of mainDevices.filter((d) => d.type === DeviceType.POWER_SUPPLY)) {
    const n = deviceNameLower(psu);
    if (!n.includes('9v') && !n.includes('pedal psu') && !n.includes('psu #')) continue;
    // Prefer cabled consumer; else name-hint (Boss TU-3, Cinders…).
    let consumer: LayoutDevice | undefined;
    for (const c of cables) {
      const a = portToDevice.get(c.sourcePortId);
      const b = portToDevice.get(c.targetPortId);
      if (a === psu.id && b && b !== psu.id) {
        consumer = deviceById.get(b);
        break;
      }
      if (b === psu.id && a && a !== psu.id) {
        consumer = deviceById.get(a);
        break;
      }
    }
    if (!consumer) {
      consumer = mainDevices.find(
        (d) =>
          d.id !== psu.id &&
          zoneOf(d) === zoneOf(psu) &&
          (d.type === DeviceType.PEDAL || d.type === DeviceType.PEDALBOARD) &&
          (n.includes('tu-3') || n.includes('tu3')
            ? nameIncludes(d, 'TU-3') || nameIncludes(d, 'tuner')
            : n.includes('cinders')
              ? nameIncludes(d, 'Cinders')
              : false),
      );
    }
    if (consumer && !consumer.parentDeviceId) {
      pinBeside(consumer, psu, 'below');
      reflowZone(zoneOf(psu));
    }
  }

  // 4) Combo-near venue outlet under the amp
  for (const amp of mainDevices.filter((d) => d.type === DeviceType.AMPLIFIER)) {
    const outlet = mainDevices.find(
      (d) =>
        zoneOf(d) === zoneOf(amp) &&
        nameIncludes(d, 'venue outlet') &&
        (nameIncludes(d, 'combo') || deviceNameLower(d).includes('combo')),
    );
    if (outlet) {
      pinBeside(amp, outlet, 'below');
      reflowZone(zoneOf(amp));
    }
  }

  // 5) Anker strip + wall outlet — keep outlet to the LEFT (power flows outlet → strip).
  //    Do not stack under Anker: that collapses the power chain into one column.
  for (const anker of mainDevices.filter(
    (d) => nameIncludes(d, 'Anker') && d.type === DeviceType.POWER_STRIP,
  )) {
    const zone = zoneOf(anker);
    const ap = positions.get(anker.id);
    if (!ap) continue;
    const outlet = mainDevices.find(
      (d) =>
        zoneOf(d) === zone &&
        nameIncludes(d, 'venue outlet') &&
        !nameIncludes(d, 'combo') &&
        d.id !== anker.id,
    );
    if (outlet) {
      const outSize = sizedOf(outlet.id);
      // Only nudge if outlet is to the right of / on top of Anker (order broken).
      const op = positions.get(outlet.id);
      if (!op || op.x >= ap.x) {
        positions.set(outlet.id, {
          x: ap.x - outSize.width - PIN_GAP,
          y: ap.y,
        });
      }
    }
    reflowZone(zone);
  }

  // 6) Stage box + MOTU — keep close even across service / role zones
  const stageBox = mainDevices.find(
    (d) => d.type === DeviceType.STAGE_BOX || nameIncludes(d, 'stage box') || nameIncludes(d, 'стейдж'),
  );
  const motu = mainDevices.find((d) => nameIncludes(d, 'MOTU') || nameIncludes(d, 'UltraLite'));
  if (stageBox && motu) {
    const sbPos = positions.get(stageBox.id);
    const mPos = positions.get(motu.id);
    if (sbPos && mPos) {
      // Dock: same X column, stagebox just under MOTU (or vice-versa if service is below).
      const motuSize = sizedOf(motu.id);
      if (zoneOf(stageBox) !== zoneOf(motu)) {
        // Align X; place stagebox below MOTU across the zone corridor.
        positions.set(stageBox.id, {
          x: mPos.x,
          y: Math.max(sbPos.y, mPos.y + motuSize.height + PIN_GAP),
        });
        // Keep MOTU where it is; only nudge stagebox under it.
      } else {
        pinBeside(motu, stageBox, 'right');
        reflowZone(zoneOf(motu));
      }
    }
  }

  // Final per-zone overlap cleanup after all pins.
  for (const z of Object.keys(groups) as ZoneName[]) {
    reflowZone(z);
  }

  // NOTE: intentionally NO global resolveNodeOverlaps across all main devices.
  // That was merging role zones into one messy pile.

  const childrenByParent = new Map<string, LayoutDevice[]>();
  for (const d of devices) {
    if (!d.parentDeviceId) continue;
    const list = childrenByParent.get(d.parentDeviceId) ?? [];
    list.push(d);
    childrenByParent.set(d.parentDeviceId, list);
  }

  for (const [, children] of childrenByParent) {
    const childPositions = layoutContainerChildren(children, sizedOf);
    for (const [id, pos] of childPositions) positions.set(id, pos);
  }

  return { positions };
}

/** Convert layout result to a plain object for the API. */
export function positionsToRecord(
  positions: Map<string, { x: number; y: number }>,
): Record<string, { x: number; y: number }> {
  const out: Record<string, { x: number; y: number }> = {};
  for (const [id, pos] of positions) out[id] = { x: pos.x, y: pos.y };
  return out;
}
