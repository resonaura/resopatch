import { DeviceType, InventoryStatus } from '@resopatch/shared';
import { describe, expect, it } from 'vitest';
import {
    computeAutoLayout,
    computeFlowRanks,
    logicalFamily,
    normalizeOwnerZone,
    zoneOf,
    type LayoutDevice,
} from './autoLayout';

function dev(
  partial: Partial<LayoutDevice> & { id: string; ownerRole?: string | null },
): LayoutDevice {
  return {
    name: partial.name ?? partial.id,
    type: partial.type ?? DeviceType.ACCESSORY,
    inventoryStatus: partial.inventoryStatus ?? InventoryStatus.OWNED_ACTIVE,
    ownerRole: partial.ownerRole ?? null,
    parentDeviceId: partial.parentDeviceId ?? null,
    ports: partial.ports ?? [{ id: `${partial.id}-p1` }],
    ...partial,
  };
}

describe('normalizeOwnerZone / zoneOf', () => {
  it('maps RU/EN aliases to role zones', () => {
    expect(normalizeOwnerZone('andrii')).toBe('andrii');
    expect(normalizeOwnerZone('Андрей')).toBe('andrii');
    expect(normalizeOwnerZone('danVox')).toBe('vox');
    expect(normalizeOwnerZone('Даня-вокал')).toBe('vox');
    expect(normalizeOwnerZone('danDrummer')).toBe('drummer');
    expect(normalizeOwnerZone('Даня-барабанщик')).toBe('drummer');
  });

  it('keeps owned stage box in owner zone (not force service)', () => {
    expect(
      zoneOf(
        dev({
          id: 'sb',
          type: DeviceType.STAGE_BOX,
          ownerRole: 'andrii',
        }),
      ),
    ).toBe('andrii');
  });

  it('unowned stage box goes to service', () => {
    expect(
      zoneOf(
        dev({
          id: 'sb',
          type: DeviceType.STAGE_BOX,
          ownerRole: null,
        }),
      ),
    ).toBe('service');
  });

  it('inactive inventory is always inactive zone', () => {
    expect(
      zoneOf(
        dev({
          id: 'x',
          ownerRole: 'andrii',
          inventoryStatus: InventoryStatus.OWNED_INACTIVE,
        }),
      ),
    ).toBe('inactive');
  });
});

describe('logicalFamily', () => {
  it('splits vocal vs guitar gear', () => {
    expect(
      logicalFamily(dev({ id: 'sm58', type: DeviceType.MICROPHONE, name: 'Shure SM58 Vocal Microphone' })),
    ).toBe('vocal');
    expect(
      logicalFamily(dev({ id: 'fex', type: DeviceType.VOCAL_PROCESSOR, name: 'Behringer FEX800' })),
    ).toBe('vocal');
    expect(
      logicalFamily(dev({ id: 'gtr', type: DeviceType.INSTRUMENT, name: 'Jackson JS22-7' })),
    ).toBe('guitar');
    expect(
      logicalFamily(dev({ id: 'amp', type: DeviceType.AMPLIFIER, name: 'Egnater Tweaker' })),
    ).toBe('guitar');
    expect(
      logicalFamily(
        dev({ id: 'mic', type: DeviceType.MICROPHONE, name: 'Sennheiser e835s (Combo mic)' }),
      ),
    ).toBe('guitar');
  });

  it('groups laptop, keys, and stage IO', () => {
    expect(logicalFamily(dev({ id: 'mb', type: DeviceType.LAPTOP, name: 'MacBook Pro Playback' }))).toBe(
      'laptop',
    );
    expect(logicalFamily(dev({ id: 'kl', type: DeviceType.KEYBOARD, name: 'Arturia KeyLab' }))).toBe(
      'keys',
    );
    expect(logicalFamily(dev({ id: 'motu', type: DeviceType.AUDIO_INTERFACE, name: 'MOTU UltraLite' }))).toBe(
      'io',
    );
    expect(logicalFamily(dev({ id: 'sb', type: DeviceType.STAGE_BOX, name: 'Venue Stage Box' }))).toBe(
      'io',
    );
  });
});

describe('computeAutoLayout zones', () => {
  it('places different owner roles in separated horizontal regions', () => {
    const devices = [
      dev({ id: 'a1', ownerRole: 'andrii', ports: [{ id: 'a1p' }] }),
      dev({ id: 'a2', ownerRole: 'Андрей', ports: [{ id: 'a2p' }] }),
      dev({ id: 'v1', ownerRole: 'danVox', ports: [{ id: 'v1p' }] }),
      dev({ id: 'd1', ownerRole: 'danDrummer', ports: [{ id: 'd1p' }] }),
      dev({ id: 's1', ownerRole: null, type: DeviceType.STAGE_BOX, ports: [{ id: 's1p' }] }),
    ];
    const cables = [
      { sourcePortId: 'a1p', targetPortId: 'a2p' },
    ];
    const { positions } = computeAutoLayout(devices, cables, {});

    const a1 = positions.get('a1')!;
    const a2 = positions.get('a2')!;
    const v1 = positions.get('v1')!;
    const d1 = positions.get('d1')!;
    const s1 = positions.get('s1')!;

    // Andrii cluster left of Vox, Vox left of Drummer.
    expect(Math.max(a1.x, a2.x)).toBeLessThan(v1.x);
    expect(v1.x).toBeLessThan(d1.x);

    // Service sits below the top row (not mixed into andrii X band only).
    const topMaxY = Math.max(a1.y, a2.y, v1.y, d1.y);
    expect(s1.y).toBeGreaterThan(topMaxY + 200);

    // Same-zone devices stay near each other horizontally vs other zones.
    expect(Math.abs(a1.x - a2.x)).toBeLessThan(Math.abs(a1.x - v1.x));
  });

  it('keeps vocal and guitar chains on separate rows inside one zone', () => {
    const devices = [
      dev({
        id: 'sm58',
        ownerRole: 'danVox',
        type: DeviceType.MICROPHONE,
        name: 'Shure SM58',
        ports: [{ id: 'sm58p' }],
      }),
      dev({
        id: 'fex',
        ownerRole: 'danVox',
        type: DeviceType.VOCAL_PROCESSOR,
        name: 'FEX800',
        ports: [{ id: 'fexp' }],
      }),
      dev({
        id: 'gtr',
        ownerRole: 'danVox',
        type: DeviceType.INSTRUMENT,
        name: 'Jackson JS22',
        ports: [{ id: 'gtrp' }],
      }),
      dev({
        id: 'amp',
        ownerRole: 'danVox',
        type: DeviceType.AMPLIFIER,
        name: 'Egnater Tweaker',
        ports: [{ id: 'ampp' }],
      }),
      dev({
        id: 'cmic',
        ownerRole: 'danVox',
        type: DeviceType.MICROPHONE,
        name: 'Sennheiser e835s (Combo mic)',
        ports: [{ id: 'cmicp' }],
      }),
    ];
    const cables = [
      { sourcePortId: 'sm58p', targetPortId: 'fexp' },
      { sourcePortId: 'gtrp', targetPortId: 'ampp' },
    ];
    const { positions } = computeAutoLayout(devices, cables, {});

    const sm58 = positions.get('sm58')!;
    const fex = positions.get('fex')!;
    const gtr = positions.get('gtr')!;
    const amp = positions.get('amp')!;
    const cmic = positions.get('cmic')!;

    // Guitar row above vocal row (FAMILY_ORDER: guitar then vocal) — rows separated in Y.
    const guitarY = Math.min(gtr.y, amp.y, cmic.y);
    const vocalY = Math.min(sm58.y, fex.y);
    // One family is clearly above the other (not interleaved).
    expect(Math.abs(guitarY - vocalY)).toBeGreaterThan(80);

    // Combo mic sits next to the amp (affinity pin).
    expect(Math.abs(cmic.y - amp.y)).toBeLessThan(40);
    expect(Math.abs(cmic.x - amp.x)).toBeLessThan(400);

    // Vocal pair near each other vs guitar gear.
    const vocalDist = Math.hypot(sm58.x - fex.x, sm58.y - fex.y);
    const crossDist = Math.hypot(sm58.x - amp.x, sm58.y - amp.y);
    expect(vocalDist).toBeLessThan(crossDist);
  });

  it('pins laptop charger next to laptop', () => {
    const devices = [
      dev({
        id: 'mb',
        ownerRole: 'danVox',
        type: DeviceType.LAPTOP,
        name: 'MacBook Pro Playback',
        ports: [{ id: 'mbp' }],
      }),
      dev({
        id: 'psu',
        ownerRole: 'danVox',
        type: DeviceType.POWER_SUPPLY,
        name: 'Apple 140W USB-C PSU',
        ports: [{ id: 'psup' }],
      }),
      dev({
        id: 'other',
        ownerRole: 'danVox',
        type: DeviceType.MONITOR,
        name: 'KZ IEM',
        ports: [{ id: 'iemp' }],
      }),
    ];
    const { positions } = computeAutoLayout(devices, [], {});
    const mb = positions.get('mb')!;
    const psu = positions.get('psu')!;
    const other = positions.get('other')!;
    const dPsu = Math.hypot(mb.x - psu.x, mb.y - psu.y);
    const dOther = Math.hypot(mb.x - other.x, mb.y - other.y);
    expect(dPsu).toBeLessThan(dOther);
  });

  it('places audio daisy-chain left→right in connection order', () => {
    const devices = [
      dev({
        id: 'gtr',
        ownerRole: 'andrii',
        type: DeviceType.INSTRUMENT,
        name: 'Squier Guitar',
        ports: [{ id: 'gtr-out' }],
      }),
      dev({
        id: 'od',
        ownerRole: 'andrii',
        type: DeviceType.PEDAL,
        name: 'Overdrive',
        ports: [{ id: 'od-in' }, { id: 'od-out' }],
      }),
      dev({
        id: 'delay',
        ownerRole: 'andrii',
        type: DeviceType.PEDAL,
        name: 'Delay',
        ports: [{ id: 'dl-in' }, { id: 'dl-out' }],
      }),
      dev({
        id: 'amp',
        ownerRole: 'andrii',
        type: DeviceType.AMPLIFIER,
        name: 'Amp',
        ports: [{ id: 'amp-in' }],
      }),
    ];
    const cables = [
      { sourcePortId: 'gtr-out', targetPortId: 'od-in', cableType: 'AUDIO_UNBALANCED' },
      { sourcePortId: 'od-out', targetPortId: 'dl-in', cableType: 'AUDIO_UNBALANCED' },
      { sourcePortId: 'dl-out', targetPortId: 'amp-in', cableType: 'AUDIO_UNBALANCED' },
    ];
    const { positions } = computeAutoLayout(devices, cables, {});
    const gtr = positions.get('gtr')!;
    const od = positions.get('od')!;
    const delay = positions.get('delay')!;
    const amp = positions.get('amp')!;
    // Connection order reads left → right.
    expect(gtr.x).toBeLessThan(od.x);
    expect(od.x).toBeLessThan(delay.x);
    expect(delay.x).toBeLessThan(amp.x);
  });

  it('places power chain left→right: outlet → strip → supply', () => {
    const devices = [
      dev({
        id: 'outlet',
        ownerRole: 'andrii',
        type: DeviceType.POWER_STRIP,
        name: 'Venue Outlet',
        ports: [{ id: 'out-s' }],
      }),
      dev({
        id: 'anker',
        ownerRole: 'andrii',
        type: DeviceType.POWER_STRIP,
        name: 'Anker Surge Protector',
        ports: [{ id: 'ank-in' }, { id: 'ank-out' }],
      }),
      dev({
        id: 'iso',
        ownerRole: 'andrii',
        type: DeviceType.POWER_SUPPLY,
        name: 'PowerPlant ISO-12',
        ports: [{ id: 'iso-in' }],
      }),
    ];
    const cables = [
      { sourcePortId: 'out-s', targetPortId: 'ank-in', cableType: 'POWER_LINE' },
      { sourcePortId: 'ank-out', targetPortId: 'iso-in', cableType: 'POWER_LINE' },
    ];
    const { positions } = computeAutoLayout(devices, cables, {});
    const outlet = positions.get('outlet')!;
    const anker = positions.get('anker')!;
    const iso = positions.get('iso')!;
    expect(outlet.x).toBeLessThan(anker.x);
    expect(anker.x).toBeLessThan(iso.x);
  });
});

describe('computeFlowRanks', () => {
  it('assigns increasing ranks along a directed chain', () => {
    const ranks = computeFlowRanks(
      ['a', 'b', 'c'],
      [
        ['a', 'b'],
        ['b', 'c'],
      ],
    );
    expect(ranks.get('a')).toBe(0);
    expect(ranks.get('b')).toBe(1);
    expect(ranks.get('c')).toBe(2);
  });
});
