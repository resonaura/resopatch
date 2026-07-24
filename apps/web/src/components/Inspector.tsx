import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Disclosure, Input, Label, ListBox, Select, TextArea, TextField, toast } from '@heroui/react';
import { Cable as CableIcon, Layers, Package, Plus, StickyNote, Trash2, Zap, type LucideIcon } from 'lucide-react';
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
import { api, type GraphCable, type GraphDevice, type GraphResponse } from '../api/client';
import { DeviceTypeIcon } from '../lib/deviceIcons';
import { getDisplayName } from '../lib/deviceNaming';
import { useI18n } from '../lib/i18n';
import { formatI18nText } from '../lib/i18nText';
import CheckboxField from './CheckboxField';
import ImagePicker from './ImagePicker';
import RiderSpecSheet from './RiderSpecSheet';

function enumSelect<T extends string>(values: T[], value: T, onChange: (v: T) => void, label: string) {
  return (
    <Select value={value} onChange={(v) => onChange(v as T)}>
      <Label>{label}</Label>
      <Select.Trigger>
        <Select.Value />
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox>
          {values.map((t) => (
            <ListBox.Item key={t} id={t} textValue={t}>
              {t}
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}

function optionalEnumSelect<T extends string>(values: T[], value: T | undefined, onChange: (v: T | undefined) => void, label: string) {
  return (
    <Select value={value ?? '__none__'} onChange={(v) => onChange(v === '__none__' ? undefined : (v as T))}>
      <Label>{label}</Label>
      <Select.Trigger>
        <Select.Value />
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox>
          <ListBox.Item id="__none__" textValue="—">
            —
          </ListBox.Item>
          {values.map((t) => (
            <ListBox.Item key={t} id={t} textValue={t}>
              {t}
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
    mutationFn: () => api.createPort({ deviceId: device.id, name: t('inspector.newPortDefault'), portType: PortType.TS_14, direction: PortDirection.BI, power: {} }),
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

  const powerBudget = useQuery({
    queryKey: ['power-budget', device.id],
    queryFn: () => api.getPowerBudget(device.id),
    enabled: device.ports.some((p) => p.power.maxOutputPowerW != null || p.power.maxOutputCurrentMA != null) || device.power.maxOutputPowerW != null,
  });

  const commitField = <K extends keyof UpdateDeviceDto>(key: K, value: UpdateDeviceDto[K]) => {
    setForm((f) => ({ ...f, [key]: value }) as GraphDevice);
    save.mutate({ [key]: value } as UpdateDeviceDto);
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
        <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} onBlur={() => commitField('name', form.name)} />
      </TextField>
      {enumSelect(Object.values(DeviceType), form.type, (v) => commitField('type', v), t('inspector.type'))}
      {enumSelect(Object.values(InventoryStatus), form.inventoryStatus, (v) => commitField('inventoryStatus', v), t('inspector.inventoryStatus'))}
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

      <Section title={t('inspector.powerSection')} icon={Zap}>
        <CheckboxField isSelected={form.powerRequired} onChange={(v) => commitField('powerRequired', v)}>
          {t('inspector.requiresPower')}
        </CheckboxField>
        {enumSelect(Object.values(PowerSourceType), form.powerSourceType, (v) => commitField('powerSourceType', v), t('inspector.powerSource'))}
        {enumSelect(Object.values(HostUsbType), form.hostUsbType, (v) => commitField('hostUsbType', v), t('inspector.usbHostType'))}
        <div className="grid grid-cols-2 gap-2">
          {optionalEnumSelect(
            Object.values(CurrentType),
            form.power.currentType,
            (v) => commitField('power', { ...form.power, currentType: v }),
            t('inspector.currentType'),
          )}
          {optionalEnumSelect(Object.values(Polarity), form.power.polarity, (v) => commitField('power', { ...form.power, polarity: v }), t('inspector.polarity'))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <TextField>
            <Label>{t('inspector.voltage')}</Label>
            <Input
              type="number"
              value={form.power.voltageV ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, power: { ...f.power, voltageV: e.target.value === '' ? undefined : Number(e.target.value) } }))}
              onBlur={() => commitField('power', form.power)}
            />
          </TextField>
          <TextField>
            <Label>{t('inspector.current')}</Label>
            <Input
              type="number"
              value={form.power.currentMA ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, power: { ...f.power, currentMA: e.target.value === '' ? undefined : Number(e.target.value) } }))}
              onBlur={() => commitField('power', form.power)}
            />
          </TextField>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <TextField>
            <Label>{t('inspector.maxDrawMa')}</Label>
            <Input
              type="number"
              value={form.power.maxOutputCurrentMA ?? ''}
              onChange={(e) =>
                setForm((f) => ({ ...f, power: { ...f.power, maxOutputCurrentMA: e.target.value === '' ? undefined : Number(e.target.value) } }))
              }
              onBlur={() => commitField('power', form.power)}
            />
          </TextField>
          <TextField>
            <Label>{t('inspector.maxDrawW')}</Label>
            <Input
              type="number"
              value={form.power.maxOutputPowerW ?? ''}
              onChange={(e) =>
                setForm((f) => ({ ...f, power: { ...f.power, maxOutputPowerW: e.target.value === '' ? undefined : Number(e.target.value) } }))
              }
              onBlur={() => commitField('power', form.power)}
            />
          </TextField>
        </div>
        {powerBudget.data && (
          <div className={`rounded-lg border p-2.5 text-xs ${powerBudget.data.overBudget ? 'border-danger text-danger' : 'border-success'}`}>
            <div>
              {t('inspector.drawnPower')} {powerBudget.data.drawnPowerW.toFixed(1)}W
              {powerBudget.data.maxOutputPowerW != null ? ` / ${powerBudget.data.maxOutputPowerW}W` : ''}
              {powerBudget.data.overBudget ? ` — ${t('inspector.overBudget')}` : ''}
            </div>
            {powerBudget.data.unresolvedLoads.length > 0 && (
              <div className="text-default-500">{t('inspector.unresolvedLoads')} {powerBudget.data.unresolvedLoads.map((l) => l.deviceName).join(', ')}</div>
            )}
          </div>
        )}
      </Section>

      {form.type === DeviceType.PEDAL && (
        <Section title={t('inspector.pedalSection')} icon={Layers}>
          <div className="grid grid-cols-2 gap-2">
            <CheckboxField isSelected={form.pedal?.isStereoIn ?? false} onChange={(v) => commitField('pedal', { ...(form.pedal ?? {}), isStereoIn: v })}>
              {t('inspector.stereoIn')}
            </CheckboxField>
            <CheckboxField isSelected={form.pedal?.isStereoOut ?? false} onChange={(v) => commitField('pedal', { ...(form.pedal ?? {}), isStereoOut: v })}>
              {t('inspector.stereoOut')}
            </CheckboxField>
          </div>
          <div className="grid grid-cols-2 gap-2 items-end">
            <CheckboxField isSelected={form.pedal?.hasPresets ?? false} onChange={(v) => commitField('pedal', { ...(form.pedal ?? {}), hasPresets: v })}>
              {t('inspector.hasPresets')}
            </CheckboxField>
            <TextField>
              <Label>{t('inspector.presetCount')}</Label>
              <Input
                type="number"
                value={form.pedal?.presetCount ?? ''}
                onChange={(e) =>
                  setForm((f) => ({ ...f, pedal: { ...(f.pedal ?? {}), presetCount: e.target.value === '' ? undefined : Number(e.target.value) } }))
                }
                onBlur={() => commitField('pedal', form.pedal ?? undefined)}
              />
            </TextField>
          </div>
          <CheckboxField isSelected={form.pedal?.hasMidiControl ?? false} onChange={(v) => commitField('pedal', { ...(form.pedal ?? {}), hasMidiControl: v })}>
            {t('inspector.midiControl')}
          </CheckboxField>
          <TextField>
            <Label>{t('inspector.smartModes')}</Label>
            <Input
              value={(form.pedal?.smartModes ?? []).join(', ')}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  pedal: { ...(f.pedal ?? {}), smartModes: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) },
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
            <Input defaultValue={port.name} onBlur={(e) => e.target.value !== port.name && updatePort.mutate({ id: port.id, dto: { name: e.target.value } })} />
            <select
              defaultValue={port.portType}
              className="select__trigger h-9 rounded-lg border border-default-200 bg-surface-secondary px-2 text-xs"
              onChange={(e) => updatePort.mutate({ id: port.id, dto: { portType: e.target.value as PortType } })}
            >
              {Object.values(PortType).map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <select
              defaultValue={port.direction}
              className="select__trigger h-9 rounded-lg border border-default-200 bg-surface-secondary px-2 text-xs"
              onChange={(e) => updatePort.mutate({ id: port.id, dto: { direction: e.target.value as PortDirection } })}
            >
              {Object.values(PortDirection).map((t) => (
                <option key={t} value={t}>
                  {t}
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
        <p className="text-[11px] text-default-500">
          {t('inspector.kitNotice')}
        </p>
      </Section>

      <Section title={t('inspector.notesSection')} icon={StickyNote}>
        <TextField>
          <Label>{t('inspector.notes')}</Label>
          <TextArea
            value={form.notes ?? ''}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            onBlur={() => commitField('notes', form.notes || undefined)}
            rows={3}
          />
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

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-lg border border-default-200 bg-surface-secondary p-2.5 text-xs">
        <div>
          {sourceDevice ? getDisplayName(sourceDevice, t, language) : ''} — {sourcePort?.name}
        </div>
        <div className="text-default-500">↓</div>
        <div>
          {targetDevice ? getDisplayName(targetDevice, t, language) : ''} — {targetPort?.name}
        </div>
      </div>
      {enumSelect(Object.values(CableType), cable.cableType, (v) => save.mutate({ cableType: v }), t('inspector.cableType'))}
      <TextField>
        <Label>{t('inspector.brandModel')}</Label>
        <Input
          defaultValue={cable.productName ?? ''}
          placeholder="e.g. Fender Professional Series Tweed Instrument Cable"
          onBlur={(e) => save.mutate({ productName: e.target.value || null })}
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
        Patch cable
      </CheckboxField>
      <CheckboxField isSelected={cable.isUserOwned} onChange={(v) => save.mutate({ isUserOwned: v })}>
        Band-owned cable
      </CheckboxField>
      {cable.adapterName && <p className="text-xs text-default-500">Adapter: {formatI18nText(cable.adapterName, language)}</p>}
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
        Select a device or cable on the canvas.
        <br />
        <br />
        Devices: {graph.devices.length}
        <br />
        Cables: {graph.cables.length}
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
      <h3 className="mb-2.5 text-sm font-semibold">Cable</h3>
      <CableForm key={cable.id} cable={cable} setupId={setupId} graph={graph} />
    </div>
  );
}
