/**
 * Frontend auto-layout for the patch canvas.
 *
 * All node positioning lives here (not on the API). The backend only persists
 * whatever positions the browser sends after a layout pass or a manual drag.
 * Layout is intentionally re-run whenever the graph topology (devices / cables /
 * ownership) changes so the saved positions never lag behind the schema.
 */
import dagre from '@dagrejs/dagre';
import { DeviceType, InventoryStatus } from '@resopatch/shared';
import { greedySwapMinimize, resolveNodeOverlaps } from './crossings';

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

const FALLBACK_WIDTH = 260;
const FALLBACK_HEIGHT = 240;
/**
 * Default spacing for Arrange / first auto-layout.
 * Wide corridors leave room for orthogonal cables (avoid-nodes) without stacking cards.
 * Bump LAYOUT_REVISION in Constructor when these change so existing setups re-arrange once.
 */
const COLUMN_GAP = 260;
const ROW_GAP = 220;
const CHAIN_GAP_X = 320;
const ZONE_GAP_X = 720;
const ZONE_GAP_Y = 640;
const PIN_GAP = 96;
const OVERLAP_GAP = 72;

/** Bump when default gaps / zone packing change — triggers one client re-layout for old saves. */
export const LAYOUT_REVISION = '3-wide-corridors';

type ZoneName = 'andrii' | 'drummer' | 'vox' | 'service' | 'inactive';

function zoneOf(device: LayoutDevice): ZoneName {
  if (
    device.inventoryStatus === InventoryStatus.OWNED_INACTIVE ||
    device.inventoryStatus === InventoryStatus.PLANNED_NOT_OWNED
  ) {
    return 'inactive';
  }
  if (device.type === DeviceType.STAGE_BOX) return 'service';
  if (device.ownerRole === 'andrii') return 'andrii';
  if (device.ownerRole === 'danDrummer') return 'drummer';
  if (device.ownerRole === 'danVox') return 'vox';
  return 'service';
}

function isPowerInfra(device: LayoutDevice): boolean {
  return (
    device.type === DeviceType.POWER_SUPPLY ||
    device.type === DeviceType.POWER_SPLITTER ||
    device.type === DeviceType.POWER_STRIP
  );
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

/** Places one chain of devices by densified rank, using real heights so rows never collide. */
function placeChain(
  chain: LayoutDevice[],
  rankOf: Map<string, number>,
  sizeOf: (id: string) => SizedDevice,
  xOffset: number,
): ZoneLayout {
  const positions = new Map<string, { x: number; y: number }>();
  if (chain.length === 0) return { positions, width: 0, height: 0 };

  const sized: SizedDevice[] = chain.map((d) => sizeOf(d.id));
  const columnWidth = Math.max(...sized.map((d) => d.width), FALLBACK_WIDTH) + COLUMN_GAP;

  let maxRank = 0;
  const rankDevices = new Map<number, SizedDevice[]>();
  for (const d of sized) {
    const rank = rankOf.get(d.id)!;
    maxRank = Math.max(maxRank, rank);
    const list = rankDevices.get(rank) ?? [];
    list.push(d);
    rankDevices.set(rank, list);
  }

  const rankY = new Map<number, number>();
  let currentY = 0;
  for (let r = 0; r <= maxRank; r++) {
    rankY.set(r, currentY);
    const devicesInRank = rankDevices.get(r) ?? [];
    const maxH = devicesInRank.length > 0 ? Math.max(...devicesInRank.map((d) => d.height)) : FALLBACK_HEIGHT;
    currentY += maxH + ROW_GAP;
  }

  const colsUsedAtRank = new Map<number, number>();
  let chainWidth = 0;
  for (const d of sized) {
    const rank = rankOf.get(d.id)!;
    const col = colsUsedAtRank.get(rank) ?? 0;
    colsUsedAtRank.set(rank, col + 1);
    const x = xOffset + col * columnWidth;
    const y = rankY.get(rank) ?? 0;
    positions.set(d.id, { x, y });
    chainWidth = Math.max(chainWidth, x - xOffset + d.width);
  }

  return { positions, width: chainWidth, height: currentY - ROW_GAP };
}

function layoutZone(
  zoneDevices: LayoutDevice[],
  cables: LayoutCable[],
  portToDevice: Map<string, string>,
  sizeOf: (id: string) => SizedDevice,
): ZoneLayout {
  const positions = new Map<string, { x: number; y: number }>();
  if (zoneDevices.length === 0) return { positions, width: 0, height: 0 };

  const ids = new Set(zoneDevices.map((d) => d.id));
  const g = new dagre.graphlib.Graph();
  // Real nodesep/ranksep only affect dagre's internal ranking; we re-place by densified ranks.
  // Slight separation still improves rank assignment for crossing-heavy zones.
  g.setGraph({ rankdir: 'TB', nodesep: 40, ranksep: 80, marginx: 0, marginy: 0 });
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

  const rawRankOf = new Map<string, number>();
  for (const d of zoneDevices) {
    const node = g.node(d.id) as { rank?: number } | undefined;
    rawRankOf.set(d.id, node?.rank ?? 0);
  }

  const power = zoneDevices.filter(isPowerInfra).sort((a, b) => rawRankOf.get(a.id)! - rawRankOf.get(b.id)!);
  const signal = zoneDevices.filter((d) => !isPowerInfra(d)).sort((a, b) => rawRankOf.get(a.id)! - rawRankOf.get(b.id)!);

  const densify = (chain: LayoutDevice[]): Map<string, number> => {
    const distinct = [...new Set(chain.map((d) => rawRankOf.get(d.id)!))].sort((a, b) => a - b);
    const denseIndex = new Map(distinct.map((raw, i) => [raw, i]));
    return new Map(chain.map((d) => [d.id, denseIndex.get(rawRankOf.get(d.id)!)!]));
  };

  const signalIds = new Set(signal.map((d) => d.id));
  const adj = new Map<string, Set<string>>();
  for (const d of signal) adj.set(d.id, new Set());
  for (const c of cables) {
    const s = portToDevice.get(c.sourcePortId);
    const t = portToDevice.get(c.targetPortId);
    if (s && t && s !== t && signalIds.has(s) && signalIds.has(t)) {
      adj.get(s)!.add(t);
      adj.get(t)!.add(s);
    }
  }

  const visited = new Set<string>();
  const signalComponents: LayoutDevice[][] = [];
  for (const d of signal) {
    if (visited.has(d.id)) continue;
    const comp: LayoutDevice[] = [];
    const queue = [d.id];
    visited.add(d.id);
    while (queue.length > 0) {
      const curr = queue.shift()!;
      const dev = signal.find((x) => x.id === curr);
      if (dev) comp.push(dev);
      for (const neighbor of adj.get(curr) ?? []) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }
    comp.sort((a, b) => rawRankOf.get(a.id)! - rawRankOf.get(b.id)!);
    signalComponents.push(comp);
  }

  let currentX = 0;
  let maxHeight = 0;

  if (power.length > 0) {
    const powerChain = placeChain(power, densify(power), sizeOf, currentX);
    for (const [id, pos] of powerChain.positions) positions.set(id, pos);
    currentX += powerChain.width + CHAIN_GAP_X;
    maxHeight = Math.max(maxHeight, powerChain.height);
  }

  for (const comp of signalComponents) {
    const compChain = placeChain(comp, densify(comp), sizeOf, currentX);
    for (const [id, pos] of compChain.positions) positions.set(id, pos);
    currentX += compChain.width + CHAIN_GAP_X;
    maxHeight = Math.max(maxHeight, compChain.height);
  }

  const totalWidth = Math.max(0, currentX - (currentX > 0 ? CHAIN_GAP_X : 0));

  return {
    positions,
    width: totalWidth,
    height: maxHeight,
  };
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

  // Children share a local coordinate space — separate any collisions from uneven heights.
  const childIds = children.map((d) => d.id);
  const childSizes = new Map(childIds.map((id) => [id, sizeOf(id)] as const));
  resolveNodeOverlaps(childIds, positions, childSizes, 40);

  return positions;
}

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

  const sizeOf = (id: string): { width: number; height: number } => {
    const dev = deviceById.get(id);
    const measured = sizeLookup.get(id);
    const portCount = dev?.ports.length ?? 0;
    const hasImage =
      dev &&
      dev.type !== DeviceType.PEDALBOARD &&
      (dev.imageUrl || (dev.imageUrls && dev.imageUrls.length > 0));
    const minHeight = (hasImage ? 140 : 0) + 60 + portCount * 23;
    const height = Math.max(measured?.height ?? FALLBACK_HEIGHT, minHeight);
    const width = Math.max(measured?.width ?? FALLBACK_WIDTH, 240);
    return { width, height };
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
    for (const [id, pos] of zone.positions) positions.set(id, { x: pos.x + anchorX, y: pos.y + anchorY });
  };

  place(andrii, 0, 0);
  const voxX = andrii.width > 0 ? andrii.width + ZONE_GAP_X : 0;
  place(vox, voxX, 0);
  const drumsX = voxX + (vox.width > 0 ? vox.width + ZONE_GAP_X : 0);
  place(drummer, drumsX, 0);
  const serviceX = drumsX + (drummer.width > 0 ? drummer.width + ZONE_GAP_X : 0);
  place(service, serviceX, 0);

  const tallestColumn = Math.max(andrii.height, vox.height, drummer.height, service.height);
  place(inactive, 0, tallestColumn + ZONE_GAP_Y);

  const sizeMap = new Map(
    mainDevices.map((d) => {
      const { width, height } = sizeOf(d.id);
      return [d.id, { width, height }] as const;
    }),
  );
  const allEdges = cables
    .map((c) => [portToDevice.get(c.sourcePortId), portToDevice.get(c.targetPortId)] as const)
    .filter((e): e is [string, string] => e[0] != null && e[1] != null && e[0] !== e[1]);

  const zoneGroups: [string[], ZoneLayout][] = [
    [groups.andrii.map((d) => d.id), andrii],
    [groups.vox.map((d) => d.id), vox],
    [groups.drummer.map((d) => d.id), drummer],
    [groups.service.map((d) => d.id), service],
  ];
  // More swap passes → fewer straight-line crossings inside each role zone before
  // orthogonal routing; zones themselves stay fixed (ownership preserved).
  for (const [zoneIds] of zoneGroups) {
    if (zoneIds.length < 2) continue;
    greedySwapMinimize(zoneIds, allEdges, positions, sizeMap, 16);
  }

  // Prefer amp mic next to Danya-vocal's guitar combo.
  const egnaterCombo = mainDevices.find(
    (d) => nameIncludes(d, 'Egnater') || (d.ownerRole === 'danVox' && d.type === DeviceType.AMPLIFIER),
  );
  const ampMicDev = mainDevices.find(
    (d) =>
      nameIncludes(d, 'e835s') ||
      nameIncludes(d, 'combo amp') ||
      (nameIncludes(d, 'Sennheiser') && d.ownerRole === 'danVox'),
  );

  if (egnaterCombo && ampMicDev) {
    const comboPos = positions.get(egnaterCombo.id);
    if (comboPos) {
      const comboSize = sizedOf(egnaterCombo.id);
      positions.set(ampMicDev.id, {
        x: comboPos.x + comboSize.width + PIN_GAP,
        y: comboPos.y,
      });
    }
  }

  const comboOutletDev = mainDevices.find(
    (d) => nameIncludes(d, 'venue outlet') && d.name.toLowerCase().includes('combo'),
  );
  if (egnaterCombo && comboOutletDev) {
    const comboPos = positions.get(egnaterCombo.id);
    if (comboPos) {
      const comboSize = sizedOf(egnaterCombo.id);
      positions.set(comboOutletDev.id, {
        x: comboPos.x,
        y: comboPos.y + comboSize.height + PIN_GAP,
      });
    }
  }

  // Stack each role's venue outlet + dedicated PSU under its Anker.
  for (const role of ['andrii', 'danVox']) {
    const anker = mainDevices.find((d) => nameIncludes(d, 'Anker') && d.ownerRole === role);
    if (!anker) continue;
    const ankerPos = positions.get(anker.id);
    if (!ankerPos) continue;
    const ankerSize = sizedOf(anker.id);

    let stackY = ankerPos.y + ankerSize.height + PIN_GAP;

    const outlet = mainDevices.find(
      (d) => nameIncludes(d, 'venue outlet') && !nameIncludes(d, 'combo') && d.ownerRole === role,
    );
    if (outlet) {
      positions.set(outlet.id, { x: ankerPos.x, y: stackY });
      stackY += sizedOf(outlet.id).height + PIN_GAP;
    }

    const psu = mainDevices.find(
      (d) =>
        (nameIncludes(d, 'PSU') || nameIncludes(d, 'Single')) &&
        d.type === DeviceType.POWER_SUPPLY &&
        d.ownerRole === role,
    );
    if (psu) {
      positions.set(psu.id, { x: ankerPos.x, y: stackY });
    }
  }

  // Critical: special-case pins + greedy swaps of unequal sizes can stack cards.
  // Resolve AABB overlaps for all top-level nodes before returning.
  const mainIds = mainDevices.map((d) => d.id);
  resolveNodeOverlaps(mainIds, positions, sizeMap, OVERLAP_GAP);

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
