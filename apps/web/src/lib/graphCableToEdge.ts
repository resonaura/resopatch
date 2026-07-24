/**
 * Shared utility: converts a GraphCable + context (portById, deviceByPortId, portToNodeId)
 * into a ReactFlow Edge object. Used by both Constructor and ContainerInsideModal so the
 * visual style (stroke colour, width, dash, power converter annotation, texture) stays
 * perfectly in sync between the two canvas scopes without copy-paste.
 */

import {
    CABLE_COLORS,
    CABLE_DASH,
    CABLE_WIDTH_SCALE,
    CableType,
    DeviceType,
    getPowerCableStyle,
} from '@resopatch/shared';
import type { Edge } from '@xyflow/react';
import type { GraphCable, GraphDevice } from '../api/client';
import { defaultSourceHandle, defaultTargetHandle } from './portHandles';

/** Plug gender on the cable end (mates with the device jack). */
export type CablePlugGender = 'male' | 'female';

/**
 * Gender of the *cable plug* that inserts into this device port.
 * Device XLR-F jack → cable has male plug (папа); XLR-M → female plug (мама).
 */
export function cablePlugGenderForPort(portType: string | undefined | null): CablePlugGender | null {
  if (!portType) return null;
  switch (portType) {
    case 'XLR_F':
    case 'COMBO_XLR_TRS':
      return 'male';
    case 'XLR_M':
      return 'female';
    case 'TRS_14':
    case 'TS_14':
    case 'TRS_18':
    case 'TRRS_18':
    case 'MIDI_DIN':
    case 'USB_A':
    case 'USB_B':
    case 'USB_C':
    case 'DC_BARREL':
    case 'POWER_SCHUKO':
      return 'male';
    case 'POWER_IEC':
      // IEC mains lead: C13 female into device C14 inlet.
      return 'female';
    case 'WIRELESS':
    default:
      return null;
  }
}

/** Meta carried on the edge for labels + canvas filters. */
export type CableEdgeMeta = {
  cableType: string;
  length: number;
  color: string | null;
  productName: string | null;
  isPatchCable: boolean;
  isUserOwned: boolean;
  adapterName: string | null;
  /** Owner zone of the source device (for zone filters). */
  zone: string | null;
  /** Port types at each end (for label icon + gender). */
  sourcePortType: string | null;
  targetPortType: string | null;
  /** Cable plug gender at source end (папа/мама). */
  sourcePlugGender: CablePlugGender | null;
  /** Cable plug gender at target end. */
  targetPlugGender: CablePlugGender | null;
};

export function graphCableToEdge(
  cable: GraphCable,
  portById: Map<string, GraphDevice['ports'][number]>,
  deviceByPortId: Map<string, GraphDevice>,
  portToNodeId: Map<string, string>,
  options: { selected?: boolean } = {},
): Edge {
  const sPort = portById.get(cable.sourcePortId);
  const tPort = portById.get(cable.targetPortId);
  const sDev = deviceByPortId.get(cable.sourcePortId);
  const tDev = deviceByPortId.get(cable.targetPortId);

  const voltage =
    sPort?.power.voltageV ?? tPort?.power.voltageV ?? sDev?.power.voltageV ?? tDev?.power.voltageV;
  const currentType =
    sPort?.power.currentType ??
    tPort?.power.currentType ??
    sDev?.power.currentType ??
    tDev?.power.currentType;

  let stroke = CABLE_COLORS[cable.cableType];
  let widthScale = CABLE_WIDTH_SCALE[cable.cableType] ?? 1;
  let dash = CABLE_DASH[cable.cableType];

  if (cable.cableType === CableType.POWER_LINE) {
    const portType = sPort?.portType ?? tPort?.portType;
    const devType = sDev?.type ?? tDev?.type;
    const powerStyle = getPowerCableStyle(voltage, currentType, portType, devType);
    stroke = powerStyle.stroke;
    widthScale = powerStyle.widthScale;
    dash = powerStyle.dash ?? dash;
  }

  const sIsMains =
    sPort?.portType === 'POWER_SCHUKO' ||
    sPort?.portType === 'POWER_IEC' ||
    sDev?.type === 'POWER_STRIP';
  const tIsMains =
    tPort?.portType === 'POWER_SCHUKO' ||
    tPort?.portType === 'POWER_IEC' ||
    tDev?.type === 'POWER_STRIP';
  const touchesPowerSupplyNode =
    sDev?.type === DeviceType.POWER_SUPPLY || tDev?.type === DeviceType.POWER_SUPPLY;
  const isPowerAdapter =
    cable.cableType === CableType.POWER_LINE &&
    !touchesPowerSupplyNode &&
    ((sIsMains && !tIsMains) || (tIsMains && !sIsMains));

  let powerConverter = null;
  if (isPowerAdapter) {
    const targetVoltage =
      tPort?.power.voltageV ?? sPort?.power.voltageV ?? tDev?.power.voltageV ?? sDev?.power.voltageV ?? 9;
    const targetCurrent =
      tPort?.power.currentType ??
      sPort?.power.currentType ??
      tDev?.power.currentType ??
      sDev?.power.currentType ??
      'DC';
    const styleInfo = getPowerCableStyle(targetVoltage, targetCurrent, null, null);
    powerConverter = {
      fromVoltage: '120V AC',
      toVoltage: `${targetVoltage}V ${targetCurrent}`,
      adapterName: cable.adapterName ?? 'PSU',
      dcColor: styleInfo.stroke,
    };
    if (styleInfo.dash) dash = styleInfo.dash;
  }

  const isSelected = options.selected ?? false;
  const sourcePortType = sPort?.portType ?? null;
  const targetPortType = tPort?.portType ?? null;
  const cableMeta: CableEdgeMeta = {
    cableType: cable.cableType,
    length: cable.length,
    color: cable.color,
    productName: cable.productName,
    isPatchCable: cable.isPatchCable,
    isUserOwned: cable.isUserOwned,
    adapterName: cable.adapterName ?? null,
    zone: sDev?.ownerRole?.trim() || tDev?.ownerRole?.trim() || null,
    sourcePortType,
    targetPortType,
    sourcePlugGender: cablePlugGenderForPort(sourcePortType),
    targetPlugGender: cablePlugGenderForPort(targetPortType),
  };

  return {
    id: cable.id,
    source: portToNodeId.get(cable.sourcePortId) ?? '',
    // Unique dual-nipple ids (see DeviceNode PortRow + portHandles.ts).
    sourceHandle: defaultSourceHandle(cable.sourcePortId),
    target: portToNodeId.get(cable.targetPortId) ?? '',
    targetHandle: defaultTargetHandle(cable.targetPortId),
    selected: isSelected,
    type: 'routed',
    data: {
      powerConverter,
      cableMeta,
      texture:
        cable.textureStartUrl || cable.textureEndUrl || cable.textureMiddleUrl
          ? {
              start: cable.textureStartUrl,
              end: cable.textureEndUrl,
              middle: cable.textureMiddleUrl,
            }
          : undefined,
    },
    style: {
      stroke,
      strokeWidth: (isSelected ? 3 : 1.5) * widthScale,
      strokeDasharray: dash,
    },
    animated: cable.cableType === CableType.CONTROL_LINK,
    // Edges live under the nodes layer (see styles.css).
    zIndex: isSelected ? 2 : 0,
  };
}
