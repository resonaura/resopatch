import { Button, Disclosure, Input, Label, ListBox, Select, TextArea, TextField, toast } from '@heroui/react';
import {
    CableType,
    CurrentType,
    DeviceType,
    HostUsbType,
    InventoryStatus,
    Polarity,
    PortDirection,
    PortType,
    PowerSourceType,
    type UpdateCableDto,
    type UpdateDeviceDto,
} from '@resopatch/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Cable as CableIcon, Layers, Package, Plus, StickyNote, Trash2, Zap, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { api, type GraphCable, type GraphDevice, type GraphResponse } from '../api/client';
import { DeviceTypeIcon } from '../lib/deviceIcons';
import { getDisplayName } from '../lib/deviceNaming';
import {
    cableTypeLabel,
    currentTypeLabel,
    deviceTypeLabel,
    hostUsbLabel,
    inventoryStatusLabel,
    polarityLabel,
    portDirectionLabel,
    portTypeLabel,
    powerSourceLabel,
} from '../lib/enumLabels';
import { useI18n } from '../lib/i18n';
import { formatI18nText, mergeI18nText } from '../lib/i18nText';
import CheckboxField from './CheckboxField';
import ImagePicker from './ImagePicker';
import RiderSpecSheet from './RiderSpecSheet';

const POWER_SOURCE_DEVICE_TYPES = new Set<DeviceType>([
  DeviceType.POWER_SUPPLY,
  DeviceType.POWER_SPLITTER,
  DeviceType.POWER_STRIP,
]);

const USB_HOST_DEVICE_TYPES = new Set<DeviceType>([DeviceType.LAPTOP, DeviceType.AUDIO_INTERFACE]);

/** Devices that commonly draw power — show consumer fields even before "requires power" is checked if data exists. */
const TYPICAL_POWER_CONSUMERS = new Set<DeviceType>([
  DeviceType.PEDAL,
  DeviceType.LAPTOP,
  DeviceType.AUDIO_INTERFACE,
  DeviceType.MIXER,
  DeviceType.MONITOR_CONTROLLER,
  DeviceType.VOCAL_PROCESSOR,
  DeviceType.MIDI_DEVICE,
  DeviceType.MONITOR,
  DeviceType.AMPLIFIER,
  DeviceType.LIGHT,
  DeviceType.KEYBOARD,
  DeviceType.STAGE_BOX,
  DeviceType.POWER_SUPPLY,
  DeviceType.POWER_SPLITTER,
]);

function hasPowerProfileData(power: GraphDevice['power']): boolean {
  return (
    power.voltageV != null ||
    power.currentMA != null ||
    power.currentType != null ||
    power.polarity != null ||
    power.maxOutputCurrentMA != null ||
    power.maxOutputPowerW != null
  );
}

function enumSelect<T extends string>(
  values: T[],
  value: T,
  onChange: (v: T) => void,
  label: string,
  labelOf: (v: T) => string,
) {
  return (
    <Select value={value} onChange={(v) => onChange(v as T)}>
      <Label>{label}</Label>
      <Select.Trigger>
        <Select.Value>{labelOf(value)}</Select.Value>
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox>
          {values.map((item) => (
            <ListBox.Item key={item} id={item} textValue={labelOf(item)}>
              {labelOf(item)}
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}

function optionalEnumSelect<T extends string>(
  values: T[],
  value: T | undefined,
  onChange: (v: T | undefined) => void,
  label: string,
  labelOf: (v: T) => string,
) {
  return (
    <Select value={value ?? '__none__'} onChange={(v) => onChange(v === '__none__' ? undefined : (v as T))}>
      <Label>{label}</Label>
      <Select.Trigger>
        <Select.Value>{value ? labelOf(value) : '—'}</Select.Value>
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox>
          <ListBox.Item id="__none__" textValue="—">
            —
          </ListBox.Item>
          {values.map((item) => (
            <ListBox.Item key={item} id={item} textValue={labelOf(item)}>
              {labelOf(item)}
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}

function Section({ title, icon: Icon, children }: { title: string; icon: LucideIcon; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <Disclosure isExpanded={open} onExpandedChange={setOpen} className="border-t border-default-200 pt-2">
      <Disclosure.Heading>
        <Disclosure.Trigger className="flex w-full items-center gap-1.5 text-left text-xs font-semibold text-default-500">
          <Icon className="h-3.5 w-3.5" />
          {title}
          <Disclosure.Indicator />
        </Disclosure.Trigger>
      </Disclosure.Heading>
      <Disclosure.Content>
        <div className="flex flex-col gap-3 pt-2">{children}</div>
      </Disclosure.Content>
    </Disclosure>
  );
}

function DeviceForm({
  device,
  setupId,
  children,
  onAddChild,
  onSelectChild,
}: {
  device: GraphDevice;
  setupId: string;
  children: GraphDevice[];
  onAddChild: () => void;
  onSelectChild: (id: string) => void;
}) {
  const qc = useQueryClient();
  const { t, language } = useI18n();
  const [form, setForm] = useState(device);
  const [nameEdit, setNameEdit] = useState(() => formatI18nText(device.name, language));
  const [notesEdit, setNotesEdit] = useState(() => formatI18nText(device.notes, language));
  const [attrsText, setAttrsText] = useState(() => JSON.stringify(device.attrs, null, 2));
  const [attrsError, setAttrsError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (dto: UpdateDeviceDto) => api.updateDevice(device.id, dto),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['graph', setupId] }),
    onError: (err) => toast(err instanceof Error ? err.message : t('inspector.saveError'), { variant: 'danger' }),
  });
  const remove = useMutation({
    mutationFn: () => api.deleteDevice(device.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['graph', setupId] }),
  });
  const addPort = useMutation({
    mutationFn: () =>
      api.createPort({
        deviceId: device.id,
        name: t('inspector.newPortDefault'),
        portType: PortType.TS_14,
        direction: PortDirection.BI,
        power: {},
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['graph', setupId] }),
  });
  const deletePort = useMutation({
    mutationFn: (portId: string) => api.deletePort(portId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['graph', setupId] }),
  });
  const updatePort = useMutation({
    mutationFn: (vars: { id: string; dto: Parameters<typeof api.updatePort>[1] }) => api.updatePort(vars.id, vars.dto),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['graph', setupId] }),
  });

  const isPowerSourceDevice = POWER_SOURCE_DEVICE_TYPES.has(form.type);
  const showUsbHost = USB_HOST_DEVICE_TYPES.has(form.type);
  const showPedal = form.type === DeviceType.PEDAL;
  // Consumer electrical fields (V/mA/polarity) — not for pure accessories / passive gear unless already filled.
  const showPowerConsumer =
    form.powerRequired ||
    form.powerSourceType !== PowerSourceType.NONE ||
    TYPICAL_POWER_CONSUMERS.has(form.type) ||
    hasPowerProfileData(form.power);
  // Always expose at least "requires power" except accessories with no power data at all.
  const showPowerSection =
    isPowerSourceDevice ||
    form.type !== DeviceType.ACCESSORY ||
    form.powerRequired ||
    hasPowerProfileData(form.power) ||
    form.powerSourceType !== PowerSourceType.NONE;

  const powerBudget = useQuery({
    queryKey: ['power-budget', device.id],
    queryFn: () => api.getPowerBudget(device.id),
    enabled:
      isPowerSourceDevice &&
      (device.ports.some((p) => p.power.maxOutputPowerW != null || p.power.maxOutputCurrentMA != null) ||
        device.power.maxOutputPowerW != null),
  });

  const commitField = <K extends keyof UpdateDeviceDto>(key: K, value: UpdateDeviceDto[K]) => {
    setForm((f) => ({ ...f, [key]: value }) as GraphDevice);
    save.mutate({ [key]: value } as UpdateDeviceDto);
  };

  const commitName = () => {
    const merged = mergeI18nText(device.name, language, nameEdit);
    setForm((f) => ({ ...f, name: merged }));
    save.mutate({ name: merged });
  };

  const commitNotes = () => {
    const merged = mergeI18nText(device.notes, language, notesEdit);
    const value = merged || undefined;
    setForm((f) => ({ ...f, notes: value ?? null }));
    save.mutate({ notes: value });
  };

  const commitAttrs = () => {
    try {
      const parsed = JSON.parse(attrsText || '{}');
      setAttrsError(null);
      save.mutate({ attrs: parsed });
    } catch {
      setAttrsError(t('inspector.invalidJson'));
    }
  };

  const colorAttr = typeof form.attrs.color === 'string' ? form.attrs.color : '';
  const commitColor = (value: string) => {
    const nextAttrs = { ...form.attrs };
    if (value) nextAttrs.color = value;
    else delete nextAttrs.color;
    setForm((f) => ({ ...f, attrs: nextAttrs }));
    setAttrsText(JSON.stringify(nextAttrs, null, 2));
    save.mutate({ attrs: nextAttrs });
  };

  return (
    <div className="flex flex-col gap-3">
      <TextField>
        <Label>{t('inspector.name')}</Label>
        <Input value={nameEdit} onChange={(e) => setNameEdit(e.target.value)} onBlur={commitName} />
      </TextField>
      {enumSelect(
        Object.values(DeviceType),
        form.type,
        (v) => commitField('type', v),
        t('inspector.type'),
        (v) => deviceTypeLabel(v, t),
      )}
      {enumSelect(
        Object.values(InventoryStatus),
        form.inventoryStatus,
        (v) => commitField('inventoryStatus', v),
        t('inspector.inventoryStatus'),
        (v) => inventoryStatusLabel(v, t),
      )}
      <TextField>
        <Label>{t('inspector.ownerRole')}</Label>
        <Input
          value={form.ownerRole ?? ''}
          onChange={(e) => setForm((f) => ({ ...f, ownerRole: e.target.value }))}
          onBlur={() => commitField('ownerRole', form.ownerRole || undefined)}
          placeholder={t('ownerRole.placeholder')}
        />
      </TextField>
      <TextField>
        <Label>{t('inspector.color')}</Label>
        <div className="flex items-center gap-2">
          <Input
            value={colorAttr}
            onChange={(e) => setForm((f) => ({ ...f, attrs: { ...f.attrs, color: e.target.value } }))}
            onBlur={() => commitColor(colorAttr)}
            placeholder={t('inspector.colorPlaceholder')}
          />
          {colorAttr && (
            <span className="h-6 w-6 shrink-0 rounded-full border border-default-300" style={{ backgroundColor: colorAttr }} title={colorAttr} />
          )}
        </div>
      </TextField>

      {showPowerSection && (
        <Section title={t('inspector.powerSection')} icon={Zap}>
          {!isPowerSourceDevice && (
            <CheckboxField isSelected={form.powerRequired} onChange={(v) => commitField('powerRequired', v)}>
              {t('inspector.requiresPower')}
            </CheckboxField>
          )}

          {(showPowerConsumer || form.powerRequired) && !isPowerSourceDevice && (
            <>
              {enumSelect(
                Object.values(PowerSourceType),
                form.powerSourceType,
                (v) => commitField('powerSourceType', v),
                t('inspector.powerSource'),
                (v) => powerSourceLabel(v, t),
              )}
              {showUsbHost &&
                enumSelect(
                  Object.values(HostUsbType),
                  form.hostUsbType,
                  (v) => commitField('hostUsbType', v),
                  t('inspector.usbHostType'),
                  (v) => hostUsbLabel(v, t),
                )}
              <div className="grid grid-cols-2 gap-2">
                {optionalEnumSelect(
                  Object.values(CurrentType),
                  form.power.currentType,
                  (v) => commitField('power', { ...form.power, currentType: v }),
                  t('inspector.currentType'),
                  (v) => currentTypeLabel(v, t),
                )}
                {optionalEnumSelect(
                  Object.values(Polarity),
                  form.power.polarity,
                  (v) => commitField('power', { ...form.power, polarity: v }),
                  t('inspector.polarity'),
                  (v) => polarityLabel(v, t),
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <TextField>
                  <Label>{t('inspector.voltage')}</Label>
                  <Input
                    type="number"
                    value={form.power.voltageV ?? ''}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        power: { ...f.power, voltageV: e.target.value === '' ? undefined : Number(e.target.value) },
                      }))
                    }
                    onBlur={() => commitField('power', form.power)}
                  />
                </TextField>
                <TextField>
                  <Label>{t('inspector.current')}</Label>
                  <Input
                    type="number"
                    value={form.power.currentMA ?? ''}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        power: { ...f.power, currentMA: e.target.value === '' ? undefined : Number(e.target.value) },
                      }))
                    }
                    onBlur={() => commitField('power', form.power)}
                  />
                </TextField>
              </div>
            </>
          )}

          {isPowerSourceDevice && (
            <>
              <p className="text-[11px] font-medium text-default-500">{t('inspector.powerSourceCapacitySection')}</p>
              {enumSelect(
                Object.values(PowerSourceType),
                form.powerSourceType,
                (v) => commitField('powerSourceType', v),
                t('inspector.powerSource'),
                (v) => powerSourceLabel(v, t),
              )}
              <div className="grid grid-cols-2 gap-2">
                {optionalEnumSelect(
                  Object.values(CurrentType),
                  form.power.currentType,
                  (v) => commitField('power', { ...form.power, currentType: v }),
                  t('inspector.currentType'),
                  (v) => currentTypeLabel(v, t),
                )}
                {optionalEnumSelect(
                  Object.values(Polarity),
                  form.power.polarity,
                  (v) => commitField('power', { ...form.power, polarity: v }),
                  t('inspector.polarity'),
                  (v) => polarityLabel(v, t),
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <TextField>
                  <Label>{t('inspector.voltage')}</Label>
                  <Input
                    type="number"
                    value={form.power.voltageV ?? ''}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        power: { ...f.power, voltageV: e.target.value === '' ? undefined : Number(e.target.value) },
                      }))
                    }
                    onBlur={() => commitField('power', form.power)}
                  />
                </TextField>
                <TextField>
                  <Label>{t('inspector.maxDrawMa')}</Label>
                  <Input
                    type="number"
                    value={form.power.maxOutputCurrentMA ?? ''}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        power: {
                          ...f.power,
                          maxOutputCurrentMA: e.target.value === '' ? undefined : Number(e.target.value),
                        },
                      }))
                    }
                    onBlur={() => commitField('power', form.power)}
                  />
                </TextField>
              </div>
              <TextField>
                <Label>{t('inspector.maxDrawW')}</Label>
                <Input
                  type="number"
                  value={form.power.maxOutputPowerW ?? ''}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      power: {
                        ...f.power,
                        maxOutputPowerW: e.target.value === '' ? undefined : Number(e.target.value),
                      },
                    }))
                  }
                  onBlur={() => commitField('power', form.power)}
                />
              </TextField>
              {powerBudget.data && (
                <div
                  className={`rounded-lg border p-2.5 text-xs ${
                    powerBudget.data.overBudget ? 'border-danger text-danger' : 'border-success'
                  }`}
                >
                  <div>
                    {t('inspector.drawnPower')} {powerBudget.data.drawnPowerW.toFixed(1)}W
                    {powerBudget.data.maxOutputPowerW != null ? ` / ${powerBudget.data.maxOutputPowerW}W` : ''}
                    {powerBudget.data.overBudget ? ` — ${t('inspector.overBudget')}` : ''}
                  </div>
                  {powerBudget.data.unresolvedLoads.length > 0 && (
                    <div className="text-default-500">
                      {t('inspector.unresolvedLoads')}{' '}
                      {powerBudget.data.unresolvedLoads
                        .map((l) => formatI18nText(l.deviceName, language))
                        .join(', ')}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </Section>
      )}

      {showPedal && (
        <Section title={t('inspector.pedalSection')} icon={Layers}>
          <div className="grid grid-cols-2 gap-2">
            <CheckboxField
              isSelected={form.pedal?.isStereoIn ?? false}
              onChange={(v) => commitField('pedal', { ...(form.pedal ?? {}), isStereoIn: v })}
            >
              {t('inspector.stereoIn')}
            </CheckboxField>
            <CheckboxField
              isSelected={form.pedal?.isStereoOut ?? false}
              onChange={(v) => commitField('pedal', { ...(form.pedal ?? {}), isStereoOut: v })}
            >
              {t('inspector.stereoOut')}
            </CheckboxField>
          </div>
          <div className="grid grid-cols-2 gap-2 items-end">
            <CheckboxField
              isSelected={form.pedal?.hasPresets ?? false}
              onChange={(v) => commitField('pedal', { ...(form.pedal ?? {}), hasPresets: v })}
            >
              {t('inspector.hasPresets')}
            </CheckboxField>
            <TextField>
              <Label>{t('inspector.presetCount')}</Label>
              <Input
                type="number"
                value={form.pedal?.presetCount ?? ''}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    pedal: {
                      ...(f.pedal ?? {}),
                      presetCount: e.target.value === '' ? undefined : Number(e.target.value),
                    },
                  }))
                }
                onBlur={() => commitField('pedal', form.pedal ?? undefined)}
              />
            </TextField>
          </div>
          <CheckboxField
            isSelected={form.pedal?.hasMidiControl ?? false}
            onChange={(v) => commitField('pedal', { ...(form.pedal ?? {}), hasMidiControl: v })}
          >
            {t('inspector.midiControl')}
          </CheckboxField>
          <TextField>
            <Label>{t('inspector.smartModes')}</Label>
            <Input
              value={(form.pedal?.smartModes ?? []).join(', ')}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  pedal: {
                    ...(f.pedal ?? {}),
                    smartModes: e.target.value
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean),
                  },
                }))
              }
              onBlur={() => commitField('pedal', form.pedal ?? undefined)}
            />
          </TextField>
        </Section>
      )}

      <Section title={t('inspector.portsSection').replace('{count}', String(device.ports.length))} icon={CableIcon}>
        {device.ports.map((port) => (
          <div key={port.id} className="grid grid-cols-[1fr_1fr_70px_auto] items-center gap-1.5">
            <Input
              defaultValue={formatI18nText(port.name, language)}
              onBlur={(e) => {
                const merged = mergeI18nText(port.name, language, e.target.value);
                if (merged !== port.name) updatePort.mutate({ id: port.id, dto: { name: merged } });
              }}
            />
            <select
              defaultValue={port.portType}
              className="select__trigger h-9 rounded-lg border border-default-200 bg-surface-secondary px-2 text-xs"
              onChange={(e) => updatePort.mutate({ id: port.id, dto: { portType: e.target.value as PortType } })}
            >
              {Object.values(PortType).map((pt) => (
                <option key={pt} value={pt}>
                  {portTypeLabel(pt, t)}
                </option>
              ))}
            </select>
            <select
              defaultValue={port.direction}
              className="select__trigger h-9 rounded-lg border border-default-200 bg-surface-secondary px-2 text-xs"
              onChange={(e) =>
                updatePort.mutate({ id: port.id, dto: { direction: e.target.value as PortDirection } })
              }
            >
              {Object.values(PortDirection).map((d) => (
                <option key={d} value={d}>
                  {portDirectionLabel(d, t)}
                </option>
              ))}
            </select>
            <Button isIconOnly size="sm" variant="danger" onPress={() => deletePort.mutate(port.id)}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
        <Button size="sm" variant="secondary" onPress={() => addPort.mutate()}>
          <Plus className="h-3.5 w-3.5" />
          {t('inspector.addPort')}
        </Button>
      </Section>

      <Section title={t('inspector.kitSection').replace('{count}', String(children.length))} icon={Package}>
        {children.map((child) => (
          <button
            key={child.id}
            onClick={() => onSelectChild(child.id)}
            className="flex items-center gap-2 rounded-md border border-default-200 px-2 py-1.5 text-left text-xs hover:bg-surface-secondary"
          >
            <DeviceTypeIcon type={child.type} className="h-3.5 w-3.5 shrink-0 text-default-500" />
            <span className="truncate">{getDisplayName(child, t, language)}</span>
          </button>
        ))}
        <Button size="sm" variant="secondary" onPress={onAddChild}>
          <Plus className="h-3.5 w-3.5" />
          {t('inspector.addChild')}
        </Button>
        <p className="text-[11px] text-default-500">{t('inspector.kitNotice')}</p>
      </Section>

      <Section title={t('inspector.notesSection')} icon={StickyNote}>
        <TextField>
          <Label>{t('inspector.notes')}</Label>
          <TextArea value={notesEdit} onChange={(e) => setNotesEdit(e.target.value)} onBlur={commitNotes} rows={3} />
        </TextField>
        <ImagePicker
          value={form.imageUrl ?? undefined}
          onChange={(url) => {
            setForm((f) => ({ ...f, imageUrl: url ?? null }));
            commitField('imageUrl', url);
          }}
        />
        <TextField>
          <Label>{t('inspector.customAttrs')}</Label>
          <TextArea value={attrsText} onChange={(e) => setAttrsText(e.target.value)} onBlur={commitAttrs} rows={6} className="font-mono text-xs" />
        </TextField>
        {attrsError && <p className="text-sm text-danger">{attrsError}</p>}
      </Section>

      <Button variant="danger" fullWidth onPress={() => remove.mutate()} className="mt-2">
        <Trash2 className="h-3.5 w-3.5" />
        {t('inspector.deleteDevice')}
      </Button>
    </div>
  );
}

function CableForm({ cable, setupId, graph }: { cable: GraphCable; setupId: string; graph: GraphResponse }) {
  const qc = useQueryClient();
  const { t, language } = useI18n();
  const save = useMutation({
    mutationFn: (dto: UpdateCableDto) => api.updateCable(cable.id, dto),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['graph', setupId] }),
    onError: (err) => toast(err instanceof Error ? err.message : t('inspector.saveError'), { variant: 'danger' }),
  });
  const remove = useMutation({
    mutationFn: () => api.deleteCable(cable.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['graph', setupId] }),
  });

  const sourceDevice = graph.devices.find((d) => d.ports.some((p) => p.id === cable.sourcePortId));
  const targetDevice = graph.devices.find((d) => d.ports.some((p) => p.id === cable.targetPortId));
  const sourcePort = sourceDevice?.ports.find((p) => p.id === cable.sourcePortId);
  const targetPort = targetDevice?.ports.find((p) => p.id === cable.targetPortId);

  const [productNameEdit, setProductNameEdit] = useState(() => formatI18nText(cable.productName, language));

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-lg border border-default-200 bg-surface-secondary p-2.5 text-xs">
        <div>
          {sourceDevice ? getDisplayName(sourceDevice, t, language) : ''} — {formatI18nText(sourcePort?.name, language)}
        </div>
        <div className="text-default-500">↓</div>
        <div>
          {targetDevice ? getDisplayName(targetDevice, t, language) : ''} — {formatI18nText(targetPort?.name, language)}
        </div>
      </div>
      {enumSelect(
        Object.values(CableType),
        cable.cableType,
        (v) => save.mutate({ cableType: v }),
        t('inspector.cableType'),
        (v) => cableTypeLabel(v, t),
      )}
      <TextField>
        <Label>{t('inspector.brandModel')}</Label>
        <Input
          value={productNameEdit}
          onChange={(e) => setProductNameEdit(e.target.value)}
          placeholder="e.g. Fender Professional Series Tweed Instrument Cable"
          onBlur={() => {
            const merged = mergeI18nText(cable.productName, language, productNameEdit);
            save.mutate({ productName: merged || null });
          }}
        />
      </TextField>
      <TextField>
        <Label>{t('inspector.lengthM')}</Label>
        <Input type="number" step="0.1" defaultValue={cable.length} onBlur={(e) => save.mutate({ length: Number(e.target.value) })} />
      </TextField>
      <TextField>
        <Label>{t('inspector.color')}</Label>
        <Input defaultValue={cable.color ?? ''} onBlur={(e) => save.mutate({ color: e.target.value || undefined })} />
      </TextField>
      <Section title={t('inspector.cablePhoto')} icon={CableIcon}>
        <ImagePicker
          label={t('inspector.cablePhotoMain')}
          value={cable.imageUrl ?? undefined}
          onChange={(url) => save.mutate({ imageUrl: url ?? null })}
        />
      </Section>
      <Section title={t('inspector.cableTexture')} icon={CableIcon}>
        <ImagePicker
          label={t('inspector.cableStart')}
          value={cable.textureStartUrl ?? undefined}
          onChange={(url) => save.mutate({ textureStartUrl: url ?? null })}
        />
        <ImagePicker
          label={t('inspector.cableEnd')}
          value={cable.textureEndUrl ?? undefined}
          onChange={(url) => save.mutate({ textureEndUrl: url ?? null })}
        />
        <ImagePicker
          label={t('inspector.cableSegment')}
          value={cable.textureMiddleUrl ?? undefined}
          onChange={(url) => save.mutate({ textureMiddleUrl: url ?? null })}
        />
      </Section>
      <CheckboxField isSelected={cable.isPatchCable} onChange={(v) => save.mutate({ isPatchCable: v })}>
        {t('inspector.patchCable')}
      </CheckboxField>
      <CheckboxField isSelected={cable.isUserOwned} onChange={(v) => save.mutate({ isUserOwned: v })}>
        {t('inspector.bandOwnedCable')}
      </CheckboxField>
      {cable.adapterName && (
        <p className="text-xs text-default-500">
          {t('inspector.adapter').replace('{name}', formatI18nText(cable.adapterName, language))}
        </p>
      )}
      <Button variant="danger" fullWidth onPress={() => remove.mutate()} className="mt-2">
        <Trash2 className="h-3.5 w-3.5" />
        {t('inspector.deleteCable')}
      </Button>
    </div>
  );
}

export type Selection = { kind: 'device'; id: string } | { kind: 'cable'; id: string } | null;

export default function Inspector({
  graph,
  selection,
  setupId,
  onAddChild,
  onSelectDevice,
}: {
  graph: GraphResponse;
  selection: Selection;
  setupId: string;
  onAddChild: (parentId: string) => void;
  onSelectDevice: (id: string) => void;
}) {
  const { t, language } = useI18n();

  if (!selection) {
    return (
      <div className="h-full min-h-0 overflow-y-auto border-l border-default-200 bg-surface p-4 text-sm text-default-500">
        {t('inspector.selectHint')}
        <br />
        <br />
        {t('inspector.statsDevices').replace('{count}', String(graph.devices.length))}
        <br />
        {t('inspector.statsCables').replace('{count}', String(graph.cables.length))}
      </div>
    );
  }

  if (selection.kind === 'device') {
    const device = graph.devices.find((d) => d.id === selection.id);
    if (!device) return null;
    const children = graph.devices.filter((d) => d.parentDeviceId === device.id);
    return (
      <div className="h-full min-h-0 overflow-y-auto border-l border-default-200 bg-surface p-3.5">
        <h3 className="mb-2.5 text-sm font-semibold">{getDisplayName(device, t, language)}</h3>
        <RiderSpecSheet key={`${device.id}-rider`} device={device} />
        <div className="mt-3">
          <DeviceForm
            key={device.id}
            device={device}
            setupId={setupId}
            children={children}
            onAddChild={() => onAddChild(device.id)}
            onSelectChild={onSelectDevice}
          />
        </div>
      </div>
    );
  }

  const cable = graph.cables.find((c) => c.id === selection.id);
  if (!cable) return null;
  return (
    <div className="h-full min-h-0 overflow-y-auto border-l border-default-200 bg-surface p-3.5">
      <h3 className="mb-2.5 text-sm font-semibold">{cableTypeLabel(cable.cableType, t)}</h3>
      <CableForm key={cable.id} cable={cable} setupId={setupId} graph={graph} />
    </div>
  );
}
