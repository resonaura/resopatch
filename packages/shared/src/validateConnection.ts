import {
  CABLE_MEDIUM_PORT_TYPES,
  CONNECTOR_FAMILIES,
  CableType,
  POWER_PORT_TYPES,
  Polarity,
  PortDirection,
  PortType,
} from './enums';
import { PowerProfile } from './types';

export interface ConnectionInput {
  sourcePortType: PortType;
  sourceDirection: PortDirection;
  targetPortType: PortType;
  targetDirection: PortDirection;
  cableType: CableType;
  /** Inline adapter bridging the source and target connectors, if the two don't mate directly. */
  adapter?: { inputType: PortType; outputType: PortType; invertsPolarity?: boolean };
  sourcePower?: PowerProfile;
  targetPower?: PowerProfile;
}

export interface ConnectionValidationResult {
  valid: boolean;
  /** Hard electrical/physical impossibility — blocks the connection. */
  error?: string;
  /** Soft notices (e.g. stereo output feeding a mono input) — never blocks anything.
   *  Plugging a stereo TRS into a mono TS jack is completely normal for headphone-style
   *  monitoring feeds, so format mismatches are informational only, not errors. */
  warnings: string[];
}

const familiesOverlap = (a: PortType, b: PortType): boolean => {
  const famA = CONNECTOR_FAMILIES[a] ?? [];
  const famB = CONNECTOR_FAMILIES[b] ?? [];
  return famA.some((f) => famB.includes(f));
};

/**
 * Implements the wiring constraints that are actual electrical/physical impossibilities:
 * signal direction, cable-medium/port compatibility, physical connector matching (via adapter
 * if present), power/signal isolation, and AC/DC + polarity compatibility on power connections.
 * Everything else (signal format, mono/stereo, impedance) is advisory — see the `warnings` field.
 */
export function validateConnection(input: ConnectionInput): ConnectionValidationResult {
  const { sourcePortType, sourceDirection, targetPortType, targetDirection, cableType, adapter, sourcePower, targetPower } =
    input;
  const warnings: string[] = [];

  if (!(sourceDirection === PortDirection.OUT || sourceDirection === PortDirection.BI)) {
    return { valid: false, error: 'Source port cannot send a signal (not OUT/BI).', warnings };
  }
  if (!(targetDirection === PortDirection.IN || targetDirection === PortDirection.BI)) {
    return { valid: false, error: 'Target port cannot receive a signal (not IN/BI).', warnings };
  }

  const sourceIsPower = POWER_PORT_TYPES.includes(sourcePortType);
  const targetIsPower = POWER_PORT_TYPES.includes(targetPortType);
  if (sourceIsPower || targetIsPower) {
    if (!sourceIsPower || !targetIsPower) {
      return { valid: false, error: 'Power connectors cannot mix with signal connectors.', warnings };
    }
    if (cableType !== CableType.POWER_LINE) {
      return { valid: false, error: 'Power connectors require a POWER_LINE cable.', warnings };
    }
  } else if (cableType === CableType.POWER_LINE) {
    return { valid: false, error: 'POWER_LINE cable used on non-power ports.', warnings };
  }

  if (adapter) {
    if (!familiesOverlap(sourcePortType, adapter.inputType)) {
      return { valid: false, error: 'Adapter input does not match the source connector.', warnings };
    }
    if (!familiesOverlap(adapter.outputType, targetPortType)) {
      return { valid: false, error: 'Adapter output does not match the target connector.', warnings };
    }
  } else if (!familiesOverlap(sourcePortType, targetPortType)) {
    return { valid: false, error: 'Connectors do not mate directly — add an adapter.', warnings };
  }

  const allowedTypes = CABLE_MEDIUM_PORT_TYPES[cableType];
  // An adapter may convert medium (e.g. a DI box turning unbalanced into balanced), so only the
  // source-side port — the cable's "native" end — is held to the declared cable medium.
  const sideToCheck = adapter ? [sourcePortType] : [sourcePortType, targetPortType];
  for (const portType of sideToCheck) {
    if (!allowedTypes.includes(portType)) {
      return { valid: false, error: `${cableType} cable cannot terminate on a ${portType} port.`, warnings };
    }
  }

  if (sourceIsPower && targetIsPower && sourcePower && targetPower) {
    // A plain (non-inverting) inline adapter on a power cable stands in for a transformer/PSU
    // brick (e.g. a 230V-AC-in, 12V-DC-out wall-wart) — exactly the mechanism that's allowed to
    // change current type and voltage, so those two checks don't apply through one. Polarity is
    // handled separately below: it's the one property an adapter must *declare* it fixes
    // (`invertsPolarity`), since otherwise a same-voltage/same-current but wrong-polarity plug
    // is a real, silent way to kill gear.
    if (
      !adapter &&
      sourcePower.currentType &&
      targetPower.currentType &&
      sourcePower.currentType !== targetPower.currentType
    ) {
      return {
        valid: false,
        error: `AC/DC mismatch: source is ${sourcePower.currentType}, target expects ${targetPower.currentType}.`,
        warnings,
      };
    }
    const srcPolarity = sourcePower.polarity;
    const dstPolarity = targetPower.polarity;
    if (
      srcPolarity &&
      dstPolarity &&
      srcPolarity !== Polarity.ANY &&
      dstPolarity !== Polarity.ANY &&
      srcPolarity !== dstPolarity &&
      !adapter?.invertsPolarity
    ) {
      return {
        valid: false,
        error: `Polarity mismatch: source is ${srcPolarity}, target expects ${dstPolarity}. Add a polarity-inverting adapter.`,
        warnings,
      };
    }
    if (
      !adapter &&
      sourcePower.voltageV != null &&
      targetPower.voltageV != null &&
      Math.abs(sourcePower.voltageV - targetPower.voltageV) > 0.01
    ) {
      warnings.push(`Voltage mismatch: source provides ${sourcePower.voltageV}V, target expects ${targetPower.voltageV}V.`);
    }
  }

  return { valid: true, warnings };
}
