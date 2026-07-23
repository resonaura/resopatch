import {
  CableType,
  CurrentType,
  DeviceType,
  FurnitureKind,
  HostUsbType,
  InventoryStatus,
  Polarity,
  PortDirection,
  PortType,
  PowerSourceType,
  SignalFormat,
} from './enums';

export interface Position {
  x: number;
  y: number;
}

/** Electrical profile of a power-carrying port or a device's own power input.
 *  All fields optional — an incomplete profile is a normal, valid state (see docs/stage-setup.md §13). */
export interface PowerProfile {
  currentType?: CurrentType;
  voltageV?: number;
  currentMA?: number;
  polarity?: Polarity;
  /** For power SOURCES (PSU/splitter/power strip outlet, or a device's own output group):
   *  the max current that outlet/group can deliver, used for power-budget checks. */
  maxOutputCurrentMA?: number;
  /** Total wattage a power source can deliver across all its outputs (e.g. ISO-12 Pro's 27W
   *  global limit spans mixed-voltage groups, where a plain mA sum wouldn't be meaningful). */
  maxOutputPowerW?: number;
}

/** Pedal-specific metadata — only meaningful when Device.type === 'PEDAL'. */
export interface PedalProfile {
  isStereoIn?: boolean;
  isStereoOut?: boolean;
  hasPresets?: boolean;
  presetCount?: number;
  hasMidiControl?: boolean;
  smartModes?: string[];
}

export interface DeviceDto {
  id: string;
  setupId: string;
  name: string;
  type: DeviceType;
  inventoryStatus: InventoryStatus;
  powerRequired: boolean;
  powerSourceType: PowerSourceType;
  hostUsbType: HostUsbType;
  ownerRole: string | null;
  /** Self-reference: e.g. a pedal belongs to a pedalboard, a strap/tuner is attached to an instrument,
   *  a power splitter hangs off a PSU. Null for top-level devices. */
  parentDeviceId: string | null;
  position: Position;
  power: PowerProfile;
  pedal: PedalProfile | null;
  imageUrl: string | null;
  /** Additional views (back, top, detail shots, etc.) beyond the primary `imageUrl`. When
   *  present the canvas node renders all of them side-by-side in the image banner. */
  imageUrls?: string[] | null;
  notes: string | null;
  /** Free-form catch-all for spec fields that don't warrant a dedicated column yet
   *  (manufacturer, model number, weight, dimensions, purchase link, ...). */
  attrs: Record<string, unknown>;
}

export interface PortDto {
  id: string;
  deviceId: string;
  name: string;
  portType: PortType;
  direction: PortDirection;
  signalFormat: SignalFormat | null;
  power: PowerProfile;
}

export interface AdapterDto {
  id: string;
  name: string;
  inputType: PortType;
  outputType: PortType;
  isActive: boolean;
  /** True for polarity-reversing power adapters (e.g. a Center-Negative → Center-Positive converter). */
  invertsPolarity: boolean;
}

export interface CableDto {
  id: string;
  sourcePortId: string;
  targetPortId: string;
  cableType: CableType;
  length: number;
  adapterId: string | null;
  isUserOwned: boolean;
  color: string | null;
  isPatchCable: boolean;
  textureStartUrl: string | null;
  textureEndUrl: string | null;
  textureMiddleUrl: string | null;
}

export interface FurnitureDto {
  id: string;
  deviceId: string;
  kind: FurnitureKind;
  isVenueProvided: boolean;
}

export interface SetupDto {
  id: string;
  name: string;
  description: string | null;
}

/** One row of the derived input list (Table 6 in the design doc). */
export interface InputListRow {
  channel: number;
  sourceName: string;
  connector: PortType;
  direction: PortDirection;
  routing: string;
  phantomPower: boolean;
  zone: string;
  owner: string;
}

/** One row of the derived packing/rider checklist (Table 7 in the design doc). */
export interface RiderRow {
  category: 'CABLE' | 'ADAPTER' | 'FURNITURE' | 'POWER' | 'EQUIPMENT';
  name: string;
  quantity: number;
  isUserOwned: boolean;
  note?: string;
}

/** Result of summing declared power draw against a power source's declared capacity.
 *  Deliberately advisory (see docs/stage-setup.md §13) — never blocks saving incomplete data,
 *  and loads with no declared voltage/current are listed separately rather than silently ignored. */
export interface PowerBudgetResult {
  deviceId: string;
  deviceName: string;
  maxOutputPowerW: number | null;
  maxOutputCurrentMA: number | null;
  drawnPowerW: number;
  drawnCurrentMA: number;
  overBudget: boolean;
  loads: { deviceId: string; deviceName: string; watts: number | null; currentMA: number | null }[];
  /** Connected devices whose power draw isn't fully specified yet — informational, not an error. */
  unresolvedLoads: { deviceId: string; deviceName: string }[];
}
