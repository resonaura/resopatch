import dagre from '@dagrejs/dagre';
import { DeviceType, InventoryStatus } from '@resopatch/shared';
import { Device } from '../database/entities/device.entity';
import { Cable } from '../database/entities/cable.entity';
import { Port } from '../database/entities/port.entity';

const FALLBACK_WIDTH = 260;
const FALLBACK_HEIGHT = 240;
const COLUMN_GAP = 180;
const ROW_GAP = 160;
const CHAIN_GAP_X = 220;
const ZONE_GAP_X = 520;
const ZONE_GAP_Y = 480;

type ZoneName = 'andrey' | 'barabanschik' | 'vokal' | 'service' | 'inactive';

function zoneOf(device: Device): ZoneName {
  if (device.inventoryStatus === InventoryStatus.OWNED_INACTIVE || device.inventoryStatus === InventoryStatus.PLANNED_NOT_OWNED) return 'inactive';
  if (device.type === DeviceType.STAGE_BOX) return 'service';
  if (device.ownerRole === 'Даня-барабанщик' && (device.type === DeviceType.LAPTOP || device.type === DeviceType.AUDIO_INTERFACE)) return 'service';
  if (device.ownerRole === 'Андрей') return 'andrey';
  if (device.ownerRole === 'Даня-барабанщик') return 'barabanschik';
  if (device.ownerRole === 'Даня-вокал') return 'vokal';
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

  place(andrey, 0, 0);
  const vokalX = andrey.width > 0 ? andrey.width + ZONE_GAP_X : 0;
  place(vokal, vokalX, 0);
  const drumsX = vokalX + (vokal.width > 0 ? vokal.width + ZONE_GAP_X : 0);
  place(barabanschik, drumsX, 0);
  const serviceX = drumsX + (barabanschik.width > 0 ? barabanschik.width + ZONE_GAP_X : 0);
  place(service, serviceX, 0);

  const tallestColumn = Math.max(andrey.height, vokal.height, barabanschik.height, service.height);
  place(inactive, 0, tallestColumn + ZONE_GAP_Y);

  // Ensure amp microphone (Sennheiser e835s) sits directly next to Danya-vocal's guitar combo amp (Egnater Tweaker 40W)
  const egnaterCombo = mainDevices.find(
    (d) => d.name.includes('Egnater') || (d.ownerRole === 'Даня-вокал' && d.type === DeviceType.AMPLIFIER),
  );
  const ampMicDev = mainDevices.find(
    (d) => d.name.includes('e835s') || d.name.includes('комбика') || (d.name.includes('Sennheiser') && d.ownerRole === 'Даня-вокал'),
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

  // Pin venue wall outlets directly next to their respective Anker extension cords
  for (const role of ['Андрей', 'Даня-вокал']) {
    const anker = mainDevices.find((d) => d.name.includes('Anker') && d.ownerRole === role);
    const outlet = mainDevices.find((d) => d.name.includes('Розетка площадки') && d.ownerRole === role);
    if (anker && outlet) {
      const ankerPos = positions.get(anker.id);
      if (ankerPos) {
        const outletSize = sizedOf(outlet.id);
        positions.set(outlet.id, {
          x: Math.max(0, ankerPos.x - outletSize.width - 60),
          y: ankerPos.y,
        });
      }
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
