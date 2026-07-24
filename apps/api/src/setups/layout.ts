import dagre from '@dagrejs/dagre';
import { DeviceType, InventoryStatus } from '@resopatch/shared';
import { Device } from '../database/entities/device.entity.js';
import { Cable } from '../database/entities/cable.entity.js';
import { Port } from '../database/entities/port.entity.js';
import { greedySwapMinimize } from './crossings.js';

/** Safely checks if a device's name (plain string or bilingual JSON) contains a substring. */
function nameIncludes(device: Device, substr: string): boolean {
  const raw = device.name ?? '';
  // Try to parse as JSON first (bilingual: { en, ru })
  try {
    const parsed = JSON.parse(raw) as Record<string, string>;
    return Object.values(parsed).some((v) => v.toLowerCase().includes(substr.toLowerCase()));
  } catch {
    return raw.toLowerCase().includes(substr.toLowerCase());
  }
}

const FALLBACK_WIDTH = 260;
const FALLBACK_HEIGHT = 240;
const COLUMN_GAP = 180;
const ROW_GAP = 160;
const CHAIN_GAP_X = 220;
const ZONE_GAP_X = 520;
const ZONE_GAP_Y = 480;

type ZoneName = 'andrii' | 'drummer' | 'vox' | 'service' | 'inactive';

function zoneOf(device: Device): ZoneName {
  if (device.inventoryStatus === InventoryStatus.OWNED_INACTIVE || device.inventoryStatus === InventoryStatus.PLANNED_NOT_OWNED) return 'inactive';
  if (device.type === DeviceType.STAGE_BOX) return 'service';
  if (device.ownerRole === 'andrii') return 'andrii';
  if (device.ownerRole === 'danDrummer') return 'drummer';
  if (device.ownerRole === 'danVox') return 'vox';
  return 'service';
}

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

/** Places one chain of devices vertically, accumulating real device heights per rank so no overlaps ever occur. */
function placeChain(chain: Device[], rankOf: Map<string, number>, sizeOf: (id: string) => SizedDevice, xOffset: number): ZoneLayout {
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

  const rawRankOf = new Map<string, number>();
  for (const d of zoneDevices) rawRankOf.set(d.id, g.node(d.id).rank ?? 0);

  const power = zoneDevices.filter(isPowerInfra).sort((a, b) => rawRankOf.get(a.id)! - rawRankOf.get(b.id)!);
  const signal = zoneDevices.filter((d) => !isPowerInfra(d)).sort((a, b) => rawRankOf.get(a.id)! - rawRankOf.get(b.id)!);

  const densify = (chain: Device[]): Map<string, number> => {
    const distinct = [...new Set(chain.map((d) => rawRankOf.get(d.id)!))].sort((a, b) => a - b);
    const denseIndex = new Map(distinct.map((raw, i) => [raw, i]));
    return new Map(chain.map((d) => [d.id, denseIndex.get(rawRankOf.get(d.id)!)!]));
  };

  // Group signal devices into independent connected chains (e.g. Vocal Chain vs. Guitar Chain)
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
  const signalComponents: Device[][] = [];
  for (const d of signal) {
    if (visited.has(d.id)) continue;
    const comp: Device[] = [];
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
  children: Device[],
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

  return positions;
}

export function computeAutoLayout(
  devices: Device[],
  ports: Port[],
  cables: Cable[],
  sizes: Map<string, { width: number; height: number }>,
): LayoutResult {
  const deviceById = new Map(devices.map((d) => [d.id, d]));
  const topAncestorId = (device: Device): string => {
    let current = device;
    while (current.parentDeviceId) {
      const parent = deviceById.get(current.parentDeviceId);
      if (!parent) break;
      current = parent;
    }
    return current.id;
  };
  const portToDevice = new Map<string, string>();
  for (const p of ports) {
    const device = deviceById.get(p.deviceId);
    portToDevice.set(p.id, device ? topAncestorId(device) : p.deviceId);
  }

  const mainDevices = devices.filter((d) => !d.parentDeviceId);

  const sizeOf = (id: string) => {
    const dev = deviceById.get(id);
    const measured = sizes.get(id);
    const portCount = dev ? ports.filter((p) => p.deviceId === dev.id).length : 0;
    const hasImage = dev && dev.type !== DeviceType.PEDALBOARD && (dev.imageUrl || (dev.imageUrls && dev.imageUrls.length > 0));
    const minHeight = (hasImage ? 140 : 0) + 60 + portCount * 23;
    const height = Math.max(measured?.height ?? FALLBACK_HEIGHT, minHeight);
    const width = Math.max(measured?.width ?? FALLBACK_WIDTH, 240);
    return { width, height };
  };
  const sizedOf = (id: string): SizedDevice => ({ id, ...sizeOf(id) });

  const groups: Record<ZoneName, Device[]> = { andrii: [], drummer: [], vox: [], service: [], inactive: [] };
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

  // Post-process each zone: minimise cable crossings by swapping node positions
  // within the zone. Edges that cross zone boundaries also contribute to the cost,
  // so we pass the full cable list — greedySwapMinimize only moves nodes that
  // are in the provided nodeIds set.
  const sizeMap = new Map(
    mainDevices.map((d) => {
      const { width, height } = sizeOf(d.id);
      return [d.id, { width, height }];
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
  for (const [zoneIds, _] of zoneGroups) {
    if (zoneIds.length < 2) continue;
    greedySwapMinimize(zoneIds, allEdges, positions, sizeMap);
  }

  // Ensure amp microphone (Sennheiser e835s) sits directly next to Danya-vocal's guitar combo amp (Egnater Tweaker 40W)
  const egnaterCombo = mainDevices.find(
    (d) => nameIncludes(d, 'Egnater') || (d.ownerRole === 'danVox' && d.type === DeviceType.AMPLIFIER),
  );
  const ampMicDev = mainDevices.find(
    (d) => nameIncludes(d, 'e835s') || nameIncludes(d, 'combo amp') || (nameIncludes(d, 'Sennheiser') && d.ownerRole === 'danVox'),
  );

  if (egnaterCombo && ampMicDev) {
    const comboPos = positions.get(egnaterCombo.id);
    if (comboPos) {
      const comboSize = sizedOf(egnaterCombo.id);
      positions.set(ampMicDev.id, {
        x: comboPos.x + comboSize.width + 60,
        y: comboPos.y,
      });
    }
  }

  // Same idea as the amp mic above: the combo's own dedicated venue outlet is cabled straight to
  // it (not through an Anker), so pin it directly next to the combo too rather than leaving it
  // wherever the generic power-infra column lands it.
  const comboOutletDev = mainDevices.find((d) => nameIncludes(d, 'venue outlet') && d.name.toLowerCase().includes('combo'));
  if (egnaterCombo && comboOutletDev) {
    const comboPos = positions.get(egnaterCombo.id);
    if (comboPos) {
      const comboSize = sizedOf(egnaterCombo.id);
      positions.set(comboOutletDev.id, {
        x: comboPos.x,
        y: comboPos.y + comboSize.height + 60,
      });
    }
  }

  // Pin venue wall outlets, and any device's own charger/PSU node, directly next to whichever
  // Anker extension cord they actually belong to (by owner) — otherwise power-infra devices just
  // get shelf-packed together in rank order, with no relation to which Anker they're plugged into.
  for (const role of ['andrii', 'danVox']) {
    const anker = mainDevices.find((d) => nameIncludes(d, 'Anker') && d.ownerRole === role);
    if (!anker) continue;
    const ankerPos = positions.get(anker.id);
    if (!ankerPos) continue;
    const ankerSize = sizedOf(anker.id);

    // Stack the outlet and PSU directly below the Anker (same x, increasing y) rather than
    // to its left — placing them left relied on Math.max(0,...) which clamps to 0 when the
    // Anker itself is at x=0, making the outlet overlap the Anker exactly.
    let stackY = ankerPos.y + ankerSize.height + 60;

    const outlet = mainDevices.find((d) => nameIncludes(d, 'venue outlet') && !nameIncludes(d, 'combo') && d.ownerRole === role);
    if (outlet) {
      positions.set(outlet.id, { x: ankerPos.x, y: stackY });
      stackY += sizedOf(outlet.id).height + 60;
    }

    const psu = mainDevices.find((d) => (nameIncludes(d, 'PSU') || nameIncludes(d, 'Single')) && d.type === DeviceType.POWER_SUPPLY && d.ownerRole === role);
    if (psu) {
      positions.set(psu.id, { x: ankerPos.x, y: stackY });
    }
  }

  const childrenByParent = new Map<string, Device[]>();
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
