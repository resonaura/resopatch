import type { GraphCable, GraphDevice } from '../api/client';

/** Maps every port to the id of whichever device in `scopeIds` should render its Handle: the
 *  nearest ancestor of that port's own device that's a member of `scopeIds` (or the device
 *  itself, if it's already a member). A port whose device has no such ancestor at all — it lives
 *  outside every device in scope — is simply absent from the result.
 *
 *  This one function backs both view scopes the app has: the main canvas, where `scopeIds` is
 *  every top-level device (so a whole nested chain collapses onto its outermost card); and a
 *  single container's drill-down, where `scopeIds` is just that container's direct children (so
 *  each child gets its own node instead of collapsing further). */
export function buildPortNodeMap(devices: GraphDevice[], scopeIds: ReadonlySet<string>): Map<string, string> {
  const byId = new Map(devices.map((d) => [d.id, d]));
  const resolved = new Map<string, string | null>();

  const resolve = (device: GraphDevice): string | null => {
    const cached = resolved.get(device.id);
    if (cached !== undefined) return cached;
    let nodeId: string | null;
    if (scopeIds.has(device.id)) {
      nodeId = device.id;
    } else if (device.parentDeviceId) {
      const parent = byId.get(device.parentDeviceId);
      nodeId = parent ? resolve(parent) : null;
    } else {
      nodeId = null;
    }
    resolved.set(device.id, nodeId);
    return nodeId;
  };

  const portNode = new Map<string, string>();
  for (const device of devices) {
    const nodeId = resolve(device);
    if (nodeId) for (const port of device.ports) portNode.set(port.id, nodeId);
  }
  return portNode;
}

export interface MainCanvasGraph {
  /** Cables to render as edges on the main canvas — anything that isn't fully internal to one
   *  top-level container. */
  externalCables: GraphCable[];
  /** Cable ids excluded from `externalCables` because both ends resolve to the same top-level
   *  device — purely internal wiring (e.g. patch cables between two pedals on the same board),
   *  which would otherwise render as a self-loop tangled on top of that one card. */
  internalCableIds: Set<string>;
  /** Per top-level device, the descendant ports that carry at least one external cable — these
   *  are the ones a collapsed container card needs to expose as its own boundary Handles. Devices
   *  with no ported descendants (or none of them boundary-relevant) are simply absent here. */
  boundaryPortsByContainer: Map<string, GraphDevice['ports']>;
  /** Every port's resolved main-canvas node id (see buildPortNodeMap) — exposed so callers building
   *  edge source/target ids don't need to recompute the same top-level scope a second time. */
  portNode: Map<string, string>;
}

/** Splits the whole graph's cables into what the *main* canvas should draw. A top-level device
 *  with ported children (a container, e.g. a pedalboard) collapses to a single card — this is
 *  what decides which of its descendants' cables count as "external" (drawn on the main canvas,
 *  landing on a boundary Handle on that card) versus "internal" (only ever shown inside that
 *  container's own drill-down view, see containerInternalGraph below). */
export function splitMainCanvasGraph(devices: GraphDevice[], cables: GraphCable[]): MainCanvasGraph {
  const topLevelIds = new Set(devices.filter((d) => !d.parentDeviceId).map((d) => d.id));
  const portNode = buildPortNodeMap(devices, topLevelIds);
  const portById = new Map(devices.flatMap((d) => d.ports.map((p) => [p.id, p] as const)));
  const deviceByPortId = new Map(devices.flatMap((d) => d.ports.map((p) => [p.id, d] as const)));

  const externalCables: GraphCable[] = [];
  const internalCableIds = new Set<string>();
  const boundaryPortsByContainer = new Map<string, GraphDevice['ports']>();

  const markBoundary = (portId: string) => {
    const device = deviceByPortId.get(portId);
    const port = portById.get(portId);
    const nodeId = portNode.get(portId);
    // A top-level device's own port is already directly on the card being rendered — no proxy
    // Handle needed. Only a *descendant's* port (device.parentDeviceId set) needs one.
    if (!device || !port || !device.parentDeviceId || !nodeId) return;
    const list = boundaryPortsByContainer.get(nodeId);
    if (list) {
      if (!list.some((p) => p.id === port.id)) list.push(port);
    } else {
      boundaryPortsByContainer.set(nodeId, [port]);
    }
  };

  for (const cable of cables) {
    const sourceNode = portNode.get(cable.sourcePortId);
    const targetNode = portNode.get(cable.targetPortId);
    if (sourceNode && targetNode && sourceNode === targetNode) {
      internalCableIds.add(cable.id);
      continue;
    }
    externalCables.push(cable);
    markBoundary(cable.sourcePortId);
    markBoundary(cable.targetPortId);
  }

  return { externalCables, internalCableIds, boundaryPortsByContainer, portNode };
}

export interface ContainerInternalGraph {
  /** The container's direct children — what the drill-down view renders as its nodes. */
  nodes: GraphDevice[];
  /** Cables wholly between two of those children. */
  cables: GraphCable[];
  /** Every port's resolved node id within this drill-down's scope (see buildPortNodeMap). */
  portNode: Map<string, string>;
}

/** The flip side of splitMainCanvasGraph's `internalCableIds`: what a specific container's own
 *  drill-down view should render — its direct children as nodes, and the cabling purely between
 *  them as edges. Cables reaching outside the container (to whatever's plugged into a boundary
 *  port) aren't part of this scope; a device isn't visible from both the main canvas and inside
 *  its own container's drill-down at once. */
export function containerInternalGraph(devices: GraphDevice[], cables: GraphCable[], containerId: string): ContainerInternalGraph {
  const nodes = devices.filter((d) => d.parentDeviceId === containerId);
  const scopeIds = new Set(nodes.map((d) => d.id));
  const portNode = buildPortNodeMap(devices, scopeIds);
  const internal = cables.filter((c) => {
    const s = portNode.get(c.sourcePortId);
    const t = portNode.get(c.targetPortId);
    return s != null && t != null;
  });
  return { nodes, cables: internal, portNode };
}
