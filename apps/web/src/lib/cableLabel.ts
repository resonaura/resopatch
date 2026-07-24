/**
 * Shared cable caption formatting — used on canvas edge labels and the staff checklist
 * so both surfaces show the same connector / gender / length / product line.
 *
 * Region note: wall AC ports use domain enum `POWER_SCHUKO` historically, but the band is
 * in Canada — UI always says **US Plug**, never Schuko / EU mains.
 */

import { cableTypeLabel } from './cableTypeLabel';
import {
    cablePlugGenderForPort,
    type CableEdgeMeta,
    type CablePlugGender,
} from './graphCableToEdge';
import type { Language, TranslationKey } from './i18n/dictionaries';
import { formatI18nText } from './i18nText';

type TFn = (key: TranslationKey, params?: Record<string, string | number>) => string;

function genderWord(g: CablePlugGender, t: TFn): string {
  return g === 'male' ? t('gender.male') : t('gender.female');
}

/** e.g. "папа-мама" / "male-female" from the two cable plug ends. */
export function formatCableGenderPair(meta: CableEdgeMeta | null | undefined, t: TFn): string {
  if (!meta?.sourcePlugGender || !meta?.targetPlugGender) return '';
  return `${genderWord(meta.sourcePlugGender, t)}-${genderWord(meta.targetPlugGender, t)}`;
}

/**
 * Text grouping: collapse TS/TRS of the *same* caliber (never TRS→TS).
 * Different calibers (1/4″ vs 1/8″) may still appear as text “TRS 1/4″→TRS 1/8″”.
 */
function connectorTextFamily(portType: string | null | undefined): string {
  if (!portType) return '';
  switch (portType) {
    case 'XLR_M':
    case 'XLR_F':
      return 'xlr';
    case 'COMBO_XLR_TRS':
      return 'combo';
    case 'TRS_14':
    case 'TS_14':
      return 'phone14';
    case 'TRS_18':
      return 'trs18';
    case 'TRRS_18':
      return 'trrs18';
    case 'MIDI_DIN':
      return 'midi';
    case 'USB_C':
    case 'USB_A':
    case 'USB_B':
      return 'usb';
    case 'DC_BARREL':
      return 'dc';
    case 'POWER_IEC':
      return 'power_iec';
    case 'POWER_SCHUKO':
      return 'power_nema';
    case 'WIRELESS':
      return 'wireless';
    default:
      return portType;
  }
}

/**
 * Icon media family. Phone plugs share one family; combo is dual-purpose (XLR+TRS).
 * IEC + NEMA wall share one AC-power icon.
 */
function connectorIconFamily(portType: string | null | undefined): string {
  if (!portType) return '';
  switch (portType) {
    case 'TRS_14':
    case 'TS_14':
    case 'TRS_18':
    case 'TRRS_18':
      return 'phone';
    case 'XLR_M':
    case 'XLR_F':
      return 'xlr';
    case 'COMBO_XLR_TRS':
      return 'combo';
    case 'POWER_IEC':
    case 'POWER_SCHUKO':
      return 'ac_power';
    case 'USB_C':
    case 'USB_A':
    case 'USB_B':
      return 'usb';
    case 'DC_BARREL':
      return 'dc';
    default:
      return connectorTextFamily(portType);
  }
}

function isUsbPort(pt: string | null | undefined): boolean {
  return pt === 'USB_C' || pt === 'USB_A' || pt === 'USB_B';
}
function isWallPort(pt: string | null | undefined): boolean {
  return pt === 'POWER_SCHUKO' || pt === 'POWER_IEC';
}
function isDcPort(pt: string | null | undefined): boolean {
  return pt === 'DC_BARREL';
}

/** Wall↔USB / wall↔DC / USB↔DC is a single power brick / charger lead — not two media. */
function looksLikePowerBrick(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const wallUsb = (isWallPort(a) && isUsbPort(b)) || (isUsbPort(a) && isWallPort(b));
  const wallDc = (isWallPort(a) && isDcPort(b)) || (isDcPort(a) && isWallPort(b));
  const usbDc = (isUsbPort(a) && isDcPort(b)) || (isDcPort(a) && isUsbPort(b));
  return wallUsb || wallDc || usbDc;
}

/** True when the two ends deserve two different icons. */
function needsDoubleIcon(a: string, b: string): boolean {
  const fa = connectorIconFamily(a);
  const fb = connectorIconFamily(b);
  if (!fa || !fb || fa === fb) return false;
  if (fa === 'combo' && (fb === 'xlr' || fb === 'phone')) return false;
  if (fb === 'combo' && (fa === 'xlr' || fa === 'phone')) return false;
  if (looksLikePowerBrick(a, b)) return false;
  return true;
}

/** Specific label key for a port (TS vs TRS stay distinct). */
function specificConnectorKey(portType: string): TranslationKey | null {
  switch (portType) {
    case 'XLR_M':
    case 'XLR_F':
      return 'connectorFilter.xlr';
    case 'COMBO_XLR_TRS':
      return 'portType.COMBO_XLR_TRS';
    case 'TRS_14':
      return 'connectorFilter.trs14';
    case 'TS_14':
      return 'connectorFilter.ts14';
    case 'TRS_18':
      return 'connectorFilter.trs18';
    case 'TRRS_18':
      return 'connectorFilter.trrs18';
    case 'MIDI_DIN':
      return 'connectorFilter.midi';
    case 'USB_C':
    case 'USB_A':
    case 'USB_B':
      return 'connectorFilter.usb';
    case 'DC_BARREL':
      return 'connectorFilter.dc';
    case 'POWER_IEC':
      return 'connectorFilter.iec';
    case 'POWER_SCHUKO':
      return 'connectorFilter.nema';
    case 'WIRELESS':
      return 'connectorFilter.wireless';
    default:
      return null;
  }
}

function familyDefaultLabelKey(family: string): TranslationKey | null {
  switch (family) {
    case 'xlr':
      return 'connectorFilter.xlr';
    case 'phone14':
      return 'connectorFilter.trs14';
    case 'combo':
      return 'portType.COMBO_XLR_TRS';
    case 'trs18':
      return 'connectorFilter.trs18';
    case 'trrs18':
      return 'connectorFilter.trrs18';
    case 'midi':
      return 'connectorFilter.midi';
    case 'usb':
      return 'connectorFilter.usb';
    case 'dc':
      return 'connectorFilter.dc';
    case 'power_iec':
      return 'connectorFilter.iec';
    case 'power_nema':
      return 'connectorFilter.nema';
    case 'wireless':
      return 'connectorFilter.wireless';
    default:
      return null;
  }
}

/** Short connector label for one end. */
export function shortConnectorLabel(portType: string | null | undefined, t: TFn): string {
  if (!portType) return '';
  const key = specificConnectorKey(portType);
  return key ? t(key) : portType;
}

/**
 * Connector pair for captions.
 * Chargers get a single product-style name (never "USB→US Plug" / "USB→Schuko").
 */
export function formatConnectorPair(meta: CableEdgeMeta | null | undefined, t: TFn): string {
  if (!meta) return '';
  const src = meta.sourcePortType;
  const tgt = meta.targetPortType;
  if (!src && !tgt) return '';
  if (!src) return shortConnectorLabel(tgt, t);
  if (!tgt) return shortConnectorLabel(src, t);

  // Chargers / wall-warts: one product name (checklist + wire labels).
  if (looksLikePowerBrick(src, tgt)) {
    if ((isWallPort(src) && isUsbPort(tgt)) || (isUsbPort(src) && isWallPort(tgt))) {
      return t('cableLabel.usbCharger');
    }
    if ((isWallPort(src) && isDcPort(tgt)) || (isDcPort(src) && isWallPort(tgt))) {
      return t('cableLabel.dcPsu');
    }
    if ((isUsbPort(src) && isDcPort(tgt)) || (isDcPort(src) && isUsbPort(tgt))) {
      return t('cableLabel.usbToDc');
    }
  }

  if (meta.cableType === 'POWER_LINE' && isWallPort(src) && isWallPort(tgt)) {
    return t('cableLabel.acExtension');
  }

  const fa = connectorTextFamily(src);
  const fb = connectorTextFamily(tgt);

  if (fa === 'combo' && (fb === 'xlr' || fb === 'phone14' || fb === 'trs18' || fb === 'trrs18')) {
    return shortConnectorLabel(tgt, t);
  }
  if (fb === 'combo' && (fa === 'xlr' || fa === 'phone14' || fa === 'trs18' || fa === 'trrs18')) {
    return shortConnectorLabel(src, t);
  }

  if (fa && fa === fb) {
    const key = familyDefaultLabelKey(fa);
    return key ? t(key) : shortConnectorLabel(src, t);
  }
  return `${shortConnectorLabel(src, t)}→${shortConnectorLabel(tgt, t)}`;
}

function iconPortForType(portType: string): string {
  if (portType === 'TS_14' || portType === 'TRS_18' || portType === 'TRRS_18') return 'TRS_14';
  if (portType === 'XLR_M') return 'XLR_F';
  return portType;
}

export function cableLabelIconPorts(meta: CableEdgeMeta | null | undefined): string[] {
  if (!meta) return [];
  const a = meta.sourcePortType;
  const b = meta.targetPortType;
  if (a && b) {
    if (needsDoubleIcon(a, b)) {
      return [iconPortForType(a), iconPortForType(b)];
    }
    // Power brick: glyph = load side (USB/DC), not the wall plug.
    if (looksLikePowerBrick(a, b)) {
      if (isUsbPort(a) || isDcPort(a)) return [iconPortForType(a)];
      if (isUsbPort(b) || isDcPort(b)) return [iconPortForType(b)];
    }
    if (a === 'COMBO_XLR_TRS' && b !== 'COMBO_XLR_TRS') return [iconPortForType(b)];
    if (b === 'COMBO_XLR_TRS' && a !== 'COMBO_XLR_TRS') return [iconPortForType(a)];
    return [iconPortForType(a)];
  }
  if (a) return [iconPortForType(a)];
  if (b) return [iconPortForType(b)];
  return [];
}

const PX_PER_CHAR = 5.1;
const PX_PER_ICON = 11;
const PX_PAD = 14;

function estimateLabelWidth(text: string, iconCount: number): number {
  return Math.ceil(text.length * PX_PER_CHAR + iconCount * PX_PER_ICON + PX_PAD);
}

export type AdaptiveCableLabel = {
  text: string;
  iconPorts: string[];
  fullText: string;
};

export function buildAdaptiveCableLabel(
  meta: CableEdgeMeta | null | undefined,
  t: TFn,
  lang: Language,
  maxWidth: number,
): AdaptiveCableLabel | null {
  if (!meta) return null;

  const connector = formatConnectorPair(meta, t);
  // Gender (папа/мама) is for XLR-style audio plugs — not power / US Plug / chargers.
  const isBrick = looksLikePowerBrick(meta.sourcePortType, meta.targetPortType);
  const isPowerCable = meta.cableType === 'POWER_LINE' || isBrick;
  const gender = isPowerCable ? '' : formatCableGenderPair(meta, t);
  const length =
    meta.length != null && Number.isFinite(meta.length) ? `${meta.length}${t('meter')}` : '';
  const color = meta.color?.trim() || '';
  const product = meta.productName?.trim() ? formatI18nText(meta.productName, lang) : '';
  const medium = cableTypeLabel(meta.cableType, t);
  const patch = meta.isPatchCable ? 'patch' : '';
  const venue = !meta.isUserOwned ? t('cables.venueProvided') : '';
  const adapter = meta.adapterName ? formatI18nText(meta.adapterName, lang) : '';

  const icons = cableLabelIconPorts(meta);

  // For power bricks, medium "Power cable" is redundant if connector already says "USB charger".
  const mediumPart = isBrick ? '' : medium;

  const ladders: string[][] = [
    [connector, gender, length, color, product, mediumPart, patch, venue, adapter],
    [connector, gender, length, color, product, patch, venue, adapter],
    [connector, gender, length, color, product],
    [connector, gender, length, color],
    [connector, gender, length],
    [connector, length],
    [connector, gender],
    [connector],
    [gender, length],
    [gender],
    [medium, length],
    [medium],
  ];

  const fullParts = [connector, gender, length, color, product, mediumPart, patch, venue, adapter].filter(
    Boolean,
  );
  const fullText = fullParts.join(' · ');

  for (const ladder of ladders) {
    const parts = ladder.filter(Boolean);
    if (parts.length === 0) continue;
    const text = parts.join(' · ');
    if (estimateLabelWidth(text, icons.length) <= maxWidth) {
      return { text, iconPorts: icons, fullText: fullText || text };
    }
  }

  const fallback = connector || gender || medium;
  if (fallback && estimateLabelWidth(fallback, Math.min(1, icons.length)) <= maxWidth) {
    return {
      text: fallback,
      iconPorts: icons.slice(0, 1),
      fullText: fullText || fallback,
    };
  }
  return null;
}

export function formatCableLabel(
  meta: CableEdgeMeta | null | undefined,
  t: TFn,
  lang: Language,
): string {
  return buildAdaptiveCableLabel(meta, t, lang, 10_000)?.text ?? '';
}

export function cableMetaFromPorts(
  cable: {
    cableType: string;
    length: number;
    color: string | null;
    productName: string | null;
    isPatchCable: boolean;
    isUserOwned: boolean;
    adapterName?: string | null;
  },
  sourcePortType: string | null | undefined,
  targetPortType: string | null | undefined,
  zone: string | null = null,
): CableEdgeMeta {
  const src = sourcePortType ?? null;
  const tgt = targetPortType ?? null;
  return {
    cableType: cable.cableType,
    length: cable.length,
    color: cable.color,
    productName: cable.productName,
    isPatchCable: cable.isPatchCable,
    isUserOwned: cable.isUserOwned,
    adapterName: cable.adapterName ?? null,
    zone,
    sourcePortType: src,
    targetPortType: tgt,
    sourcePlugGender: cablePlugGenderForPort(src),
    targetPlugGender: cablePlugGenderForPort(tgt),
  };
}
