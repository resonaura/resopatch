import { Icon } from '@iconify/react';
import { Cable, Plug, type LucideIcon } from 'lucide-react';
import { PortType } from '@resopatch/shared';

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

export function PortTypeIcon({ portType, className }: { portType: string; className?: string }) {
  const outlet = isOutletPortType(portType);
  const iconClassName = `${className ?? 'h-3 w-3'} ${outlet ? 'text-amber-400' : 'text-default-500'}`;
  const glyph = FONTAUDIO_PORT_ICON[portType] ? (
    <Icon icon={FONTAUDIO_PORT_ICON[portType]!} className={iconClassName} />
  ) : (
    (() => {
      const LucideFallback = LUCIDE_PORT_ICON[portType] ?? Cable;
      return <LucideFallback className={iconClassName} strokeWidth={2} />;
    })()
  );

  if (!outlet) return <span className="flex shrink-0 items-center justify-center">{glyph}</span>;
  return (
    <span className="flex shrink-0 items-center justify-center rounded-full bg-amber-400/20 p-[3px] ring-1 ring-amber-400/60">
      {glyph}
    </span>
  );
}
