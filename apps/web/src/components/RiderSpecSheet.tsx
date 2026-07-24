import { useState } from 'react';
import { Chip, Disclosure } from '@heroui/react';
import { ChevronLeft, ChevronRight, ListChecks, ScrollText, SlidersHorizontal, ToggleLeft, Zap } from 'lucide-react';
import { DeviceType, PortDirection, type PowerProfile } from '@resopatch/shared';
import type { GraphDevice } from '../api/client';
import { useI18n } from '../lib/i18n';
import { formatI18nText } from '../lib/i18nText';
import { ProgressiveImage } from '../lib/img';
import { PortTypeIcon } from '../lib/portIcons';
import { readRiderAttrs } from '../lib/riderSpec';

const DIRECTION_LABEL: Record<string, string> = {
  [PortDirection.IN]: 'IN',
  [PortDirection.OUT]: 'OUT',
  [PortDirection.BI]: 'I/O',
};

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
    <div className="group relative w-full overflow-hidden rounded-md border border-default-200 bg-black/30 h-44">
      <div
        className="flex h-full w-full transition-transform duration-300 ease-in-out"
        style={{ transform: `translateX(-${currentIndex * 100}%)` }}
      >
        {urls.map((url, i) => {
          const isStorage = !url.startsWith('data:') && !/^https?:\/\//i.test(url);
          return (
            <div key={url} className="relative flex-1 h-full w-full shrink-0 flex-none flex items-center justify-center p-2">
              {isStorage ? (
                <ProgressiveImage src={url} alt={`${formatI18nText(device.name, language)} view ${i + 1}`} className="h-full w-full max-h-full max-w-full" objectFit="contain" />
              ) : (
                <img src={url} alt="" className="max-h-full max-w-full object-contain m-auto" />
              )}
            </div>
          );
        })}
      </div>

      {urls.length > 1 && (
        <>
          <button
            onClick={prev}
            className="absolute left-1.5 top-1/2 -translate-y-1/2 flex h-6 w-6 items-center justify-center rounded-full bg-black/75 text-white shadow transition-all hover:bg-black hover:scale-105 active:scale-95"
            title={t('deviceNode.prevView')}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={next}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 flex h-6 w-6 items-center justify-center rounded-full bg-black/75 text-white shadow transition-all hover:bg-black hover:scale-105 active:scale-95"
            title={t('deviceNode.nextView')}
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
          <div className="absolute bottom-1.5 left-1/2 -translate-x-1/2 flex items-center gap-1.5 rounded-full bg-black/75 px-2 py-0.5 shadow">
            {urls.map((_, i) => (
              <span
                key={i}
                onClick={(e) => {
                  e.stopPropagation();
                  setCurrentIndex(i);
                }}
                className={`h-1.5 cursor-pointer rounded-full transition-all ${i === currentIndex ? 'w-3.5 bg-accent' : 'w-1.5 bg-white/40 hover:bg-white'}`}
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
  const { t } = useI18n();
  const [open, setOpen] = useState(true);
  const { manufacturer, model, color, controls, footswitch, algorithms } = readRiderAttrs(device.attrs);

  const formatPower = (power: PowerProfile): string | null => {
    const parts: string[] = [];
    if (power.voltageV != null) parts.push(`${power.voltageV}V`);
    if (power.currentType) parts.push(power.currentType);
    if (power.currentMA != null) parts.push(`${power.currentMA}${t('milliamp')}`);
    if (power.polarity === 'CENTER_POSITIVE') parts.push('Center Positive');
    else if (power.polarity === 'CENTER_NEGATIVE') parts.push('Center Negative');
    else if (power.polarity === 'ANY') parts.push(t('polarity.any'));
    if (power.maxOutputPowerW != null) parts.push(t('riderSpec.powerSuffix').replace('{w}', String(power.maxOutputPowerW)));
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
    <Disclosure isExpanded={open} onExpandedChange={setOpen} className="rounded-lg border border-default-200 bg-surface-secondary/40 px-2.5">
      <Disclosure.Heading>
        <Disclosure.Trigger className="flex w-full items-center gap-1.5 py-2 text-left text-xs font-semibold text-foreground">
          <ScrollText className="h-3.5 w-3.5" />
          {t('riderSpec.title')}
          <Disclosure.Indicator />
        </Disclosure.Trigger>
      </Disclosure.Heading>
      <Disclosure.Content>
        <div className="flex flex-col gap-3 pb-3 text-xs">
          <RiderImageBanner device={device} />
          {(manufacturer || model || color) && (
            <div className="flex items-center gap-1.5 text-default-500">
              <span>{[manufacturer, model].filter(Boolean).join(' — ')}</span>
              {color && (
                <span className="flex items-center gap-1 shrink-0">
                  <span className="h-3 w-3 rounded-full border border-default-300" style={{ backgroundColor: color }} />
                  {color}
                </span>
              )}
            </div>
          )}

          {device.ports.length > 0 && (
            <div>
              <div className="mb-1 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-default-500">
                <ListChecks className="h-3 w-3" />
                {t('riderSpec.portsSection').replace('{count}', String(device.ports.length))}
              </div>
              <div className="flex flex-col gap-0.5">
                {device.ports.map((port) => {
                  const portPower = formatPower(port.power);
                  return (
                    <div key={port.id} className="flex items-center gap-1.5 rounded px-1 py-0.5 odd:bg-black/10">
                      <PortTypeIcon portType={port.portType} className="h-3 w-3" />
                      <span className="min-w-0 flex-1 truncate">{port.name}</span>
                      {portPower && <span className="shrink-0 text-[10px] text-default-500">{portPower}</span>}
                      <Chip size="sm" variant="soft" className="shrink-0">
                        {DIRECTION_LABEL[port.direction]}
                      </Chip>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {(powerLine || device.powerRequired) && (
            <div>
              <div className="mb-1 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-default-500">
                <Zap className="h-3 w-3" />
                {t('riderSpec.powerSection')}
              </div>
              <div className="text-default-400">{powerLine ?? t('riderSpec.powerUnknown')}</div>
            </div>
          )}

          {controls && controls.length > 0 && (
            <div>
              <div className="mb-1 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-default-500">
                <SlidersHorizontal className="h-3 w-3" />
                {t('riderSpec.controlsSection')}
              </div>
              <ul className="flex flex-col gap-0.5 text-default-400">
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
              <div className="mb-1 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-default-500">
                <ToggleLeft className="h-3 w-3" />
                {t('riderSpec.footswitch')}
              </div>
              <div className="text-default-400">{footswitch}</div>
            </div>
          )}

          {algorithms && algorithms.length > 0 && (
            <div>
              <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-default-500">
                {t('riderSpec.algorithms').replace('{count}', String(algorithms.length))}
              </div>
              <ul className="flex flex-col gap-0.5 text-default-400">
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
              {device.pedal.isStereoIn != null && <Chip size="sm" variant="soft">{device.pedal.isStereoIn ? 'Stereo IN' : 'Mono IN'}</Chip>}
              {device.pedal.isStereoOut != null && <Chip size="sm" variant="soft">{device.pedal.isStereoOut ? 'Stereo OUT' : 'Mono OUT'}</Chip>}
              {device.pedal.hasPresets && <Chip size="sm" variant="soft">{device.pedal.presetCount ? `${device.pedal.presetCount} presets` : 'presets'}</Chip>}
              {device.pedal.hasMidiControl && <Chip size="sm" variant="soft">MIDI control</Chip>}
              {(device.pedal.smartModes ?? []).map((m) => (
                <Chip key={m} size="sm" variant="soft">{m}</Chip>
              ))}
            </div>
          )}
        </div>
      </Disclosure.Content>
    </Disclosure>
  );
}
