import { Icon } from '@iconify/react';
import { PortType } from '@resopatch/shared';
import { Cable, Plug, type LucideIcon } from 'lucide-react';

const FONTAUDIO_PORT_ICON: Partial<Record<string, string>> = {
  [PortType.XLR_M]: 'fad:xlrplug',
  [PortType.XLR_F]: 'fad:xlrplug',
  [PortType.COMBO_XLR_TRS]: 'fad:xlrplug',
  [PortType.MIDI_DIN]: 'fad:midiplug',
  [PortType.USB_C]: 'fad:usb',
  [PortType.USB_A]: 'fad:usb',
  [PortType.USB_B]: 'fad:usb',
  [PortType.POWER_IEC]: 'fad:thunderbolt',
  [PortType.POWER_SCHUKO]: 'fad:thunderbolt',
  [PortType.WIRELESS]: 'fad:bluetooth',
};

const LUCIDE_PORT_ICON: Partial<Record<string, LucideIcon>> = {
  [PortType.TRS_14]: Cable,
  [PortType.TRS_18]: Cable,
  [PortType.TRRS_18]: Cable,
  [PortType.TS_14]: Cable,
  [PortType.DC_BARREL]: Plug,
};

/** The actual mains sockets (wall/strip outlets), as opposed to DC barrel or USB power — these
 *  are what the user means by "розетки" and get a lit-up amber badge instead of the plain grey
 *  icon every other port type gets. */
// eslint-disable-next-line react-refresh/only-export-components
export function isOutletPortType(portType: string): boolean {
  return portType === PortType.POWER_SCHUKO || portType === PortType.POWER_IEC;
}

export function PortTypeIcon({
  portType,
  className,
  /** `inherit` — use parent `color` (e.g. cable edge labels). Default keeps muted/outlet styling. */
  tone = 'default',
}: {
  portType: string;
  className?: string;
  tone?: 'default' | 'inherit';
}) {
  const outlet = isOutletPortType(portType);
  const colorClass =
    tone === 'inherit' ? 'text-current' : outlet ? 'text-amber-400' : 'text-default-500';
  const iconClassName = `${className ?? 'h-3 w-3'} ${colorClass}`;
  const glyph = FONTAUDIO_PORT_ICON[portType] ? (
    <Icon icon={FONTAUDIO_PORT_ICON[portType]!} className={iconClassName} />
  ) : (
    (() => {
      const LucideFallback = LUCIDE_PORT_ICON[portType] ?? Cable;
      return <LucideFallback className={iconClassName} strokeWidth={2} />;
    })()
  );

  if (tone === 'inherit' || !outlet) {
    return <span className="flex shrink-0 items-center justify-center">{glyph}</span>;
  }
  return (
    <span className="flex shrink-0 items-center justify-center rounded-full bg-amber-400/20 p-[3px] ring-1 ring-amber-400/60">
      {glyph}
    </span>
  );
}

/** Prefer a representative port type for cable-label icons (XLR > TRS > rest). */
export function preferPortTypeForIcon(a: string | null | undefined, b: string | null | undefined): string | null {
  const rank = (pt: string): number => {
    if (pt.startsWith('XLR') || pt === 'COMBO_XLR_TRS') return 0;
    if (pt === 'TRS_14' || pt === 'TS_14') return 1;
    if (pt === 'TRS_18' || pt === 'TRRS_18') return 2;
    if (pt === 'MIDI_DIN') return 3;
    if (pt.startsWith('USB')) return 4;
    if (pt === 'DC_BARREL' || pt.startsWith('POWER')) return 5;
    return 9;
  };
  if (a && b) return rank(a) <= rank(b) ? a : b;
  return a ?? b ?? null;
}
