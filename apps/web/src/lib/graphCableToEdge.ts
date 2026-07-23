/**
 * Shared utility: converts a GraphCable + context (portById, deviceByPortId, portToNodeId)
 * into a ReactFlow Edge object. Used by both Constructor and ContainerInsideModal so the
 * visual style (stroke colour, width, dash, power converter annotation, texture) stays
 * perfectly in sync between the two canvas scopes without copy-paste.
 */

import type { Edge } from '@xyflow/react';
import {
  CABLE_COLORS,
  CABLE_DASH,
  CABLE_WIDTH_SCALE,
  CableType,
  getPowerCableStyle,
} from '@resopatch/shared';
import type { GraphCable, GraphDevice } from '../api/client';

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
  const isPowerAdapter =
    cable.cableType === CableType.POWER_LINE &&
    ((sIsMains && !tIsMains) || (tIsMains && !sIsMains));

  let powerConverter = null;
  if (isPowerAdapter) {
    const targetVoltage =
      tPort?.power.voltageV ?? sPort?.power.voltageV ?? tDev?.power.voltageV ?? sDev?.power.voltageV ?? 9;
    const targetCurrent =
      tPort?.power.currentType ?? sPort?.power.currentType ?? tDev?.power.currentType ?? sDev?.power.currentType ?? 'DC';
    const styleInfo = getPowerCableStyle(targetVoltage, targetCurrent, null, null);
    powerConverter = {
      fromVoltage: '120V AC',
      toVoltage: `${targetVoltage}V ${targetCurrent}`,
      adapterName: 'БП',
      dcColor: styleInfo.stroke,
    };
    if (styleInfo.dash) dash = styleInfo.dash;
  }

  const isSelected = options.selected ?? false;

  return {
    id: cable.id,
    source: portToNodeId.get(cable.sourcePortId) ?? '',
    sourceHandle: cable.sourcePortId,
    target: portToNodeId.get(cable.targetPortId) ?? '',
    targetHandle: cable.targetPortId,
    label: cable.color ?? undefined,
    selected: isSelected,
    type: 'routed',
    data: {
      powerConverter,
      texture:
        cable.textureStartUrl || cable.textureEndUrl || cable.textureMiddleUrl
          ? { start: cable.textureStartUrl, end: cable.textureEndUrl, middle: cable.textureMiddleUrl }
          : undefined,
    },
    style: {
      stroke,
      strokeWidth: (isSelected ? 3 : 1.5) * widthScale,
      strokeDasharray: dash,
    },
    animated: cable.cableType === CableType.CONTROL_LINK,
    zIndex: isSelected ? 1 : 0,
  };
}
