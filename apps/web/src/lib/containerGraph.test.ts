import { describe, expect, it } from 'vitest';
import {
  DeviceType,
  HostUsbType,
  InventoryStatus,
  PortDirection,
  PortType,
  PowerSourceType,
  type CableType,
  type PortDto,
} from '@resopatch/shared';
import type { GraphCable, GraphDevice } from '../api/client';
import { buildPortNodeMap, containerInternalGraph, splitMainCanvasGraph } from './containerGraph';

let portSeq = 0;

function dev(id: string, overrides: Partial<GraphDevice> & { ports?: PortDto[] } = {}): GraphDevice {
  return {
    id,
    setupId: 'setup',
    name: id,
    type: DeviceType.PEDAL,
    inventoryStatus: InventoryStatus.OWNED_ACTIVE,
    powerRequired: false,
    powerSourceType: PowerSourceType.NONE,
    hostUsbType: HostUsbType.NONE,
    ownerRole: null,
    parentDeviceId: null,
    position: { x: 0, y: 0 },
    power: {},
    pedal: null,
    imageUrl: null,
    notes: null,
    attrs: {},
    furniture: null,
    ports: [],
    ...overrides,
  };
}

function port(deviceId: string, name: string, direction: PortDirection = PortDirection.BI): PortDto {
  return { id: `${deviceId}-${name}-${portSeq++}`, deviceId, name, portType: PortType.TS_14, direction, signalFormat: null, power: {} };
}

function cable(id: string, sourcePortId: string, targetPortId: string): GraphCable {
  return {
    id,
    sourcePortId,
    targetPortId,
    cableType: 'AUDIO_UNBALANCED' as CableType,
    length: 1,
    adapterId: null,
    isUserOwned: true,
    color: null,
    productName: null,
    isPatchCable: false,
    imageUrl: null,
    textureStartUrl: null,
    textureEndUrl: null,
    textureMiddleUrl: null,
    adapterName: null,
  };
}

describe('buildPortNodeMap', () => {
  it('maps a port straight to its own device when that device is in scope', () => {
    const a = dev('a');
    const pa = port('a', 'out');
    a.ports = [pa];
    const map = buildPortNodeMap([a], new Set(['a']));
    expect(map.get(pa.id)).toBe('a');
  });

  it('collapses a nested chain onto the outermost scoped ancestor', () => {
    const board = dev('board');
    const pedal1 = dev('pedal1', { parentDeviceId: 'board' });
    const p1 = port('pedal1', 'in');
    pedal1.ports = [p1];
    const map = buildPortNodeMap([board, pedal1], new Set(['board']));
    expect(map.get(p1.id)).toBe('board');
  });

  it('stops at the nearest scoped ancestor, not necessarily the outermost one', () => {
    const board = dev('board');
    const pedal1 = dev('pedal1', { parentDeviceId: 'board' });
    const p1 = port('pedal1', 'in');
    pedal1.ports = [p1];
    // Drill-down scope: pedal1 itself is in scope, so it doesn't walk further up to `board`.
    const map = buildPortNodeMap([board, pedal1], new Set(['pedal1']));
    expect(map.get(p1.id)).toBe('pedal1');
  });

  it('omits a port whose device has no ancestor in scope at all', () => {
    const orphan = dev('orphan');
    const p = port('orphan', 'in');
    orphan.ports = [p];
    const map = buildPortNodeMap([orphan], new Set(['someone-else']));
    expect(map.has(p.id)).toBe(false);
  });
});

describe('splitMainCanvasGraph', () => {
  it('keeps a cable between two unrelated top-level devices as external, with no boundary ports', () => {
    const a = dev('a');
    const b = dev('b');
    const pa = port('a', 'out');
    const pb = port('b', 'in');
    a.ports = [pa];
    b.ports = [pb];
    const c = cable('c1', pa.id, pb.id);
    const result = splitMainCanvasGraph([a, b], [c]);
    expect(result.externalCables.map((x) => x.id)).toEqual(['c1']);
    expect(result.internalCableIds.size).toBe(0);
    expect(result.boundaryPortsByContainer.size).toBe(0);
  });

  it('treats a cable between two pedals on the same board as internal, not external', () => {
    const board = dev('board');
    const pedal1 = dev('pedal1', { parentDeviceId: 'board' });
    const pedal2 = dev('pedal2', { parentDeviceId: 'board' });
    const out1 = port('pedal1', 'out');
    const in2 = port('pedal2', 'in');
    pedal1.ports = [out1];
    pedal2.ports = [in2];
    const patch = cable('patch', out1.id, in2.id);
    const result = splitMainCanvasGraph([board, pedal1, pedal2], [patch]);
    expect(result.externalCables).toEqual([]);
    expect(result.internalCableIds.has('patch')).toBe(true);
    expect(result.boundaryPortsByContainer.size).toBe(0);
  });

  it('exposes a descendant port as a boundary port when it has an external cable', () => {
    const board = dev('board');
    const pedal1 = dev('pedal1', { parentDeviceId: 'board' });
    const guitar = dev('guitar');
    const guitarOut = port('guitar', 'out');
    const pedalIn = port('pedal1', 'in');
    guitar.ports = [guitarOut];
    pedal1.ports = [pedalIn];
    const lead = cable('lead', guitarOut.id, pedalIn.id);
    const result = splitMainCanvasGraph([board, pedal1, guitar], [lead]);
    expect(result.externalCables.map((x) => x.id)).toEqual(['lead']);
    expect(result.internalCableIds.size).toBe(0);
    expect(result.boundaryPortsByContainer.get('board')?.map((p) => p.id)).toEqual([pedalIn.id]);
    // The guitar itself is top-level, so its own port needs no boundary proxy.
    expect(result.boundaryPortsByContainer.has('guitar')).toBe(false);
  });

  it('handles a container with both internal and external cabling at once (the pedalboard shape)', () => {
    const board = dev('board');
    const pedal1 = dev('pedal1', { parentDeviceId: 'board' });
    const pedal2 = dev('pedal2', { parentDeviceId: 'board' });
    const guitar = dev('guitar');
    const amp = dev('amp');
    const guitarOut = port('guitar', 'out');
    const pedal1In = port('pedal1', 'in');
    const pedal1Out = port('pedal1', 'out');
    const pedal2In = port('pedal2', 'in');
    const pedal2Out = port('pedal2', 'out');
    const ampIn = port('amp', 'in');
    guitar.ports = [guitarOut];
    pedal1.ports = [pedal1In, pedal1Out];
    pedal2.ports = [pedal2In, pedal2Out];
    amp.ports = [ampIn];
    const cables = [
      cable('lead-in', guitarOut.id, pedal1In.id),
      cable('patch', pedal1Out.id, pedal2In.id),
      cable('lead-out', pedal2Out.id, ampIn.id),
    ];
    const result = splitMainCanvasGraph([board, pedal1, pedal2, guitar, amp], cables);
    expect(result.externalCables.map((x) => x.id).sort()).toEqual(['lead-in', 'lead-out']);
    expect(result.internalCableIds).toEqual(new Set(['patch']));
    const boundary = result.boundaryPortsByContainer.get('board')?.map((p) => p.id).sort();
    expect(boundary).toEqual([pedal1In.id, pedal2Out.id].sort());
  });

  it('never lists the same boundary port twice even if it somehow carries two external cables', () => {
    const board = dev('board');
    const pedal1 = dev('pedal1', { parentDeviceId: 'board' });
    const a = dev('a');
    const b = dev('b');
    const aOut = port('a', 'out');
    const bOut = port('b', 'out');
    const pedalIn = port('pedal1', 'in', PortDirection.BI);
    a.ports = [aOut];
    b.ports = [bOut];
    pedal1.ports = [pedalIn];
    const cables = [cable('c1', aOut.id, pedalIn.id), cable('c2', bOut.id, pedalIn.id)];
    const result = splitMainCanvasGraph([board, pedal1, a, b], cables);
    expect(result.boundaryPortsByContainer.get('board')?.map((p) => p.id)).toEqual([pedalIn.id]);
  });
});

describe('containerInternalGraph', () => {
  it('returns the container children as nodes and only their mutual cables as edges', () => {
    const board = dev('board');
    const pedal1 = dev('pedal1', { parentDeviceId: 'board' });
    const pedal2 = dev('pedal2', { parentDeviceId: 'board' });
    const guitar = dev('guitar');
    const amp = dev('amp');
    const guitarOut = port('guitar', 'out');
    const pedal1In = port('pedal1', 'in');
    const pedal1Out = port('pedal1', 'out');
    const pedal2In = port('pedal2', 'in');
    const pedal2Out = port('pedal2', 'out');
    const ampIn = port('amp', 'in');
    guitar.ports = [guitarOut];
    pedal1.ports = [pedal1In, pedal1Out];
    pedal2.ports = [pedal2In, pedal2Out];
    amp.ports = [ampIn];
    const cables = [
      cable('lead-in', guitarOut.id, pedal1In.id),
      cable('patch', pedal1Out.id, pedal2In.id),
      cable('lead-out', pedal2Out.id, ampIn.id),
    ];
    const result = containerInternalGraph([board, pedal1, pedal2, guitar, amp], cables, 'board');
    expect(result.nodes.map((d) => d.id).sort()).toEqual(['pedal1', 'pedal2']);
    expect(result.cables.map((c) => c.id)).toEqual(['patch']);
  });

  it('returns no nodes/cables for a container with no children', () => {
    const board = dev('board');
    const result = containerInternalGraph([board], [], 'board');
    expect(result.nodes).toEqual([]);
    expect(result.cables).toEqual([]);
  });
});
