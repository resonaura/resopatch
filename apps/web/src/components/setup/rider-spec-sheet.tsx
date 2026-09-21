import { Chip, Disclosure } from '@heroui/react';
import { DeviceType, POWER_PORT_TYPES, type PowerProfile } from '@resopatch/shared';
import {
  ChevronLeft,
  ChevronRight,
  ListChecks,
  ScrollText,
  SlidersHorizontal,
  ToggleLeft,
  Zap,
} from 'lucide-react';
import { useState } from 'react';
import type { GraphDevice } from '../../api/client';
import { polarityLabel, portDirectionLabel } from '../../lib/i18n/enum-labels';
import { useI18n } from '../../lib/i18n';
import { formatI18nText } from '../../lib/i18n/text';
import { ProgressiveImage } from '../../lib/images';
import { PortTypeIcon } from '../../lib/ports/icons';
import { readRiderAttrs } from '../../lib/rider/spec';

function RiderImageBanner({ device }: { device: GraphDevice }) {
  const { t, language } = useI18n();
  const [currentIndex, setCurrentIndex] = useState(0);

  if (device.type === DeviceType.PEDALBOARD) return null;

  const urls: string[] = device.imageUrls?.length
    ? device.imageUrls
    : device.imageUrl
      ? [device.imageUrl]
      : [];

  if (urls.length === 0) return null;

  const prev = (e: React.MouseEvent) => {
    e.stopPropagation();
    setCurrentIndex((i) => (i === 0 ? urls.length - 1 : i - 1));
  };

  const next = (e: React.MouseEvent) => {
    e.stopPropagation();
    setCurrentIndex((i) => (i === urls.length - 1 ? 0 : i + 1));
  };

  return (
    <div className="border-default-200 group relative h-44 w-full overflow-hidden rounded-md border bg-black/30">
      <div
        className="flex h-full w-full transition-transform duration-300 ease-in-out"
        style={{ transform: `translateX(-${currentIndex * 100}%)` }}
      >
        {urls.map((url, i) => {
          const isStorage = !url.startsWith('data:') && !/^https?:\/\//i.test(url);
          return (
            <div
              key={url}
              className="relative flex h-full w-full flex-1 flex-none shrink-0 items-center justify-center p-2"
            >
              {isStorage ? (
                <ProgressiveImage
                  src={url}
                  alt={`${formatI18nText(device.name, language)} view ${i + 1}`}
                  className="h-full max-h-full w-full max-w-full"
                  objectFit="contain"
                />
              ) : (
                <img src={url} alt="" className="m-auto max-h-full max-w-full object-contain" />
              )}
            </div>
          );
        })}
      </div>

      {urls.length > 1 && (
        <>
          <button
            onClick={prev}
            className="absolute left-1.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full bg-black/75 text-white shadow transition-all hover:scale-105 hover:bg-black active:scale-95"
            title={t('deviceNode.prevView')}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={next}
            className="absolute right-1.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full bg-black/75 text-white shadow transition-all hover:scale-105 hover:bg-black active:scale-95"
            title={t('deviceNode.nextView')}
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
          <div className="absolute bottom-1.5 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-black/75 px-2 py-0.5 shadow">
            {urls.map((_, i) => (
              <span
                key={i}
                onClick={(e) => {
                  e.stopPropagation();
                  setCurrentIndex(i);
                }}
                className={`h-1.5 cursor-pointer rounded-full transition-all ${i === currentIndex ? 'bg-accent w-3.5' : 'w-1.5 bg-white/40 hover:bg-white'}`}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** Read-only "technical passport" for a device — every input/output, its electrical spec, knobs,
 *  footswitch behavior and effect list, in one glance. This is the app's answer to "click a node,
 *  see the full rider spec": rather than a second modal stacked on top of the inspector (which
 *  already opens as a drawer on node click, see Constructor.tsx), it lives at the top of the same
 *  panel the editable form (DeviceForm, below it) already occupies. */
export default function RiderSpecSheet({ device }: { device: GraphDevice }) {
  const { t, language } = useI18n();
  const [open, setOpen] = useState(true);
  const { manufacturer, model, color, controls, footswitch, algorithms } = readRiderAttrs(
    device.attrs,
  );

  const formatPower = (power: PowerProfile): string | null => {
    const parts: string[] = [];
    if (power.voltageV != null) parts.push(`${power.voltageV}V`);
    if (power.currentType) parts.push(power.currentType);
    if (power.currentMA != null) parts.push(`${power.currentMA}${t('milliamp')}`);
    if (power.polarity) parts.push(polarityLabel(power.polarity, t));
    if (power.maxOutputPowerW != null)
      parts.push(t('riderSpec.powerSuffix').replace('{w}', String(power.maxOutputPowerW)));
    if (power.maxOutputCurrentMA != null && power.maxOutputPowerW == null)
      parts.push(t('riderSpec.currentSuffix').replace('{ma}', String(power.maxOutputCurrentMA)));
    return parts.length > 0 ? parts.join(', ') : null;
  };

  const powerLine = formatPower(device.power);
  const hasPedalFacts =
    device.pedal &&
    (device.pedal.isStereoIn != null ||
      device.pedal.isStereoOut != null ||
      device.pedal.hasPresets ||
      device.pedal.hasMidiControl ||
      (device.pedal.smartModes?.length ?? 0) > 0);

  return (
    <Disclosure
      isExpanded={open}
      onExpandedChange={setOpen}
      className="border-default-200 bg-surface-secondary/40 rounded-lg border px-2.5"
    >
      <Disclosure.Heading>
        <Disclosure.Trigger className="text-foreground flex w-full items-center gap-1.5 py-2 text-left text-xs font-semibold">
          <ScrollText className="h-3.5 w-3.5" />
          {t('riderSpec.title')}
          <Disclosure.Indicator />
        </Disclosure.Trigger>
      </Disclosure.Heading>
      <Disclosure.Content>
        <div className="flex flex-col gap-3 pb-3 text-xs">
          <RiderImageBanner device={device} />
          {(manufacturer || model || color) && (
            <div className="text-default-500 flex items-center gap-1.5">
              <span>{[manufacturer, model].filter(Boolean).join(' — ')}</span>
              {color && (
                <span className="flex shrink-0 items-center gap-1">
                  <span
                    className="border-default-300 h-3 w-3 rounded-full border"
                    style={{ backgroundColor: color }}
                  />
                  {color}
                </span>
              )}
            </div>
          )}

          {device.ports.length > 0 && (
            <div>
              <div className="text-default-500 mb-1 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide">
                <ListChecks className="h-3 w-3" />
                {t('riderSpec.portsSection').replace('{count}', String(device.ports.length))}
              </div>
              <div className="flex flex-col gap-0.5">
                {device.ports.map((port) => {
                  // Electrical specs only belong on power ports — never on audio/MIDI/USB outs etc.
                  const portPower = POWER_PORT_TYPES.includes(port.portType)
                    ? formatPower(port.power)
                    : null;
                  return (
                    <div
                      key={port.id}
                      className="flex items-center gap-1.5 rounded px-1 py-0.5 odd:bg-black/10"
                    >
                      <PortTypeIcon portType={port.portType} className="h-3 w-3" />
                      <span className="min-w-0 flex-1 truncate">
                        {formatI18nText(port.name, language)}
                      </span>
                      {portPower && (
                        <span className="text-default-500 shrink-0 text-[10px]">{portPower}</span>
                      )}
                      <Chip size="sm" variant="soft" className="shrink-0">
                        {portDirectionLabel(port.direction, t)}
                      </Chip>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {(powerLine || device.powerRequired) && (
            <div>
              <div className="text-default-500 mb-1 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide">
                <Zap className="h-3 w-3" />
                {t('riderSpec.powerSection')}
              </div>
              <div className="text-default-400">{powerLine ?? t('riderSpec.powerUnknown')}</div>
            </div>
          )}

          {controls && controls.length > 0 && (
            <div>
              <div className="text-default-500 mb-1 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide">
                <SlidersHorizontal className="h-3 w-3" />
                {t('riderSpec.controlsSection')}
              </div>
              <ul className="text-default-400 flex flex-col gap-0.5">
                {controls.map((c, i) => (
                  <li key={i} className="pl-2.5 -indent-2.5">
                    • {c}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {footswitch && (
            <div>
              <div className="text-default-500 mb-1 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide">
                <ToggleLeft className="h-3 w-3" />
                {t('riderSpec.footswitch')}
              </div>
              <div className="text-default-400">{footswitch}</div>
            </div>
          )}

          {algorithms && algorithms.length > 0 && (
            <div>
              <div className="text-default-500 mb-1 text-[10px] font-medium uppercase tracking-wide">
                {t('riderSpec.algorithms').replace('{count}', String(algorithms.length))}
              </div>
              <ul className="text-default-400 flex flex-col gap-0.5">
                {algorithms.map((a, i) => (
                  <li key={i} className="pl-2.5 -indent-2.5">
                    • {a}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {hasPedalFacts && device.pedal && (
            <div className="flex flex-wrap gap-1">
              {device.pedal.isStereoIn != null && (
                <Chip size="sm" variant="soft">
                  {device.pedal.isStereoIn ? 'Stereo IN' : 'Mono IN'}
                </Chip>
              )}
              {device.pedal.isStereoOut != null && (
                <Chip size="sm" variant="soft">
                  {device.pedal.isStereoOut ? 'Stereo OUT' : 'Mono OUT'}
                </Chip>
              )}
              {device.pedal.hasPresets && (
                <Chip size="sm" variant="soft">
                  {device.pedal.presetCount ? `${device.pedal.presetCount} presets` : 'presets'}
                </Chip>
              )}
              {device.pedal.hasMidiControl && (
                <Chip size="sm" variant="soft">
                  MIDI control
                </Chip>
              )}
              {(device.pedal.smartModes ?? []).map((m) => (
                <Chip key={m} size="sm" variant="soft">
                  {m}
                </Chip>
              ))}
            </div>
          )}
        </div>
      </Disclosure.Content>
    </Disclosure>
  );
}
