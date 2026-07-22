import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Checkbox, Disclosure, Input, Label, ListBox, Select, TextArea, TextField, toast } from '@heroui/react';
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
  const [form, setForm] = useState(device);
  const [attrsText, setAttrsText] = useState(() => JSON.stringify(device.attrs, null, 2));
  const [attrsError, setAttrsError] = useState<string | null>(null);

  useEffect(() => {
    setForm(device);
    setAttrsText(JSON.stringify(device.attrs, null, 2));
    setAttrsError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [device.id]);

  const save = useMutation({
    mutationFn: (dto: UpdateDeviceDto) => api.updateDevice(device.id, dto),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['graph', setupId] }),
    onError: (err) => toast(err instanceof Error ? err.message : 'Не удалось сохранить', { variant: 'danger' }),
  });
  const remove = useMutation({
    mutationFn: () => api.deleteDevice(device.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['graph', setupId] }),
  });
  const addPort = useMutation({
    mutationFn: () => api.createPort({ deviceId: device.id, name: 'Новый порт', portType: PortType.TS_14, direction: PortDirection.BI, power: {} }),
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
      setAttrsError('Невалидный JSON');
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <TextField>
        <Label>Название</Label>
        <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} onBlur={() => commitField('name', form.name)} />
      </TextField>
      {enumSelect(Object.values(DeviceType), form.type, (v) => commitField('type', v), 'Тип')}
      {enumSelect(Object.values(InventoryStatus), form.inventoryStatus, (v) => commitField('inventoryStatus', v), 'Статус в инвентаре')}
      <TextField>
        <Label>Владелец / роль</Label>
        <Input
          value={form.ownerRole ?? ''}
          onChange={(e) => setForm((f) => ({ ...f, ownerRole: e.target.value }))}
          onBlur={() => commitField('ownerRole', form.ownerRole || undefined)}
          placeholder="Андрей / Даня-вокал / Даня-барабанщик…"
        />
      </TextField>

      <Section title="Питание" icon={Zap}>
        <Checkbox isSelected={form.powerRequired} onChange={(v) => commitField('powerRequired', v)}>
          Требует питание
        </Checkbox>
        {enumSelect(Object.values(PowerSourceType), form.powerSourceType, (v) => commitField('powerSourceType', v), 'Источник питания')}
        {enumSelect(Object.values(HostUsbType), form.hostUsbType, (v) => commitField('hostUsbType', v), 'Тип USB-хоста')}
        <div className="grid grid-cols-2 gap-2">
          {optionalEnumSelect(
            Object.values(CurrentType),
            form.power.currentType,
            (v) => commitField('power', { ...form.power, currentType: v }),
            'Ток (AC/DC)',
          )}
          {optionalEnumSelect(Object.values(Polarity), form.power.polarity, (v) => commitField('power', { ...form.power, polarity: v }), 'Полярность')}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <TextField>
            <Label>Напряжение, В</Label>
            <Input
              type="number"
              value={form.power.voltageV ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, power: { ...f.power, voltageV: e.target.value === '' ? undefined : Number(e.target.value) } }))}
              onBlur={() => commitField('power', form.power)}
            />
          </TextField>
          <TextField>
            <Label>Ток, мА</Label>
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
            <Label>Макс. отдача, мА</Label>
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
            <Label>Макс. отдача, Вт</Label>
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
              Нагрузка: {powerBudget.data.drawnPowerW.toFixed(1)}W
              {powerBudget.data.maxOutputPowerW != null ? ` / ${powerBudget.data.maxOutputPowerW}W` : ''}
              {powerBudget.data.overBudget ? ' — ПРЕВЫШЕНО' : ''}
            </div>
            {powerBudget.data.unresolvedLoads.length > 0 && (
              <div className="text-default-500">Без указанного потребления: {powerBudget.data.unresolvedLoads.map((l) => l.deviceName).join(', ')}</div>
            )}
          </div>
        )}
      </Section>

      {form.type === DeviceType.PEDAL && (
        <Section title="Педаль" icon={Layers}>
          <div className="grid grid-cols-2 gap-2">
            <Checkbox isSelected={form.pedal?.isStereoIn ?? false} onChange={(v) => commitField('pedal', { ...(form.pedal ?? {}), isStereoIn: v })}>
              Стерео вход
            </Checkbox>
            <Checkbox isSelected={form.pedal?.isStereoOut ?? false} onChange={(v) => commitField('pedal', { ...(form.pedal ?? {}), isStereoOut: v })}>
              Стерео выход
            </Checkbox>
          </div>
          <div className="grid grid-cols-2 gap-2 items-end">
            <Checkbox isSelected={form.pedal?.hasPresets ?? false} onChange={(v) => commitField('pedal', { ...(form.pedal ?? {}), hasPresets: v })}>
              Есть пресеты
            </Checkbox>
            <TextField>
              <Label>Кол-во пресетов</Label>
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
          <Checkbox isSelected={form.pedal?.hasMidiControl ?? false} onChange={(v) => commitField('pedal', { ...(form.pedal ?? {}), hasMidiControl: v })}>
            MIDI-управление пресетами
          </Checkbox>
          <TextField>
            <Label>Smart-режимы (через запятую)</Label>
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

      <Section title={`Порты (${device.ports.length})`} icon={CableIcon}>
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
          Порт
        </Button>
      </Section>

      <Section title={`Комплект / аксессуары (${children.length})`} icon={Package}>
        {children.map((child) => (
          <button
            key={child.id}
            onClick={() => onSelectChild(child.id)}
            className="flex items-center gap-2 rounded-md border border-default-200 px-2 py-1.5 text-left text-xs hover:bg-surface-secondary"
          >
            <DeviceTypeIcon type={child.type} className="h-3.5 w-3.5 shrink-0 text-default-500" />
            <span className="truncate">{child.name}</span>
          </button>
        ))}
        <Button size="sm" variant="secondary" onPress={onAddChild}>
          <Plus className="h-3.5 w-3.5" />
          Добавить в комплект
        </Button>
        <p className="text-[11px] text-default-500">
          Тюнер, ремень, липучки, чехлы, педали на этом устройстве — показываются списком прямо на карточке на схеме, не отдельными узлами.
        </p>
      </Section>

      <Section title="Заметки и доп. поля" icon={StickyNote}>
        <TextField>
          <Label>Заметки</Label>
          <TextArea
            value={form.notes ?? ''}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            onBlur={() => commitField('notes', form.notes || undefined)}
            rows={3}
          />
        </TextField>
        <TextField>
          <Label>Изображение (URL)</Label>
          <Input
            value={form.imageUrl ?? ''}
            onChange={(e) => setForm((f) => ({ ...f, imageUrl: e.target.value }))}
            onBlur={() => commitField('imageUrl', form.imageUrl || undefined)}
          />
        </TextField>
        <TextField>
          <Label>Произвольные атрибуты (JSON)</Label>
          <TextArea value={attrsText} onChange={(e) => setAttrsText(e.target.value)} onBlur={commitAttrs} rows={6} className="font-mono text-xs" />
        </TextField>
        {attrsError && <p className="text-sm text-danger">{attrsError}</p>}
      </Section>

      <Button variant="danger" fullWidth onPress={() => remove.mutate()} className="mt-2">
        <Trash2 className="h-3.5 w-3.5" />
        Удалить устройство
      </Button>
    </div>
  );
}

function CableForm({ cable, setupId, graph }: { cable: GraphCable; setupId: string; graph: GraphResponse }) {
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: (dto: UpdateCableDto) => api.updateCable(cable.id, dto),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['graph', setupId] }),
    onError: (err) => toast(err instanceof Error ? err.message : 'Ошибка', { variant: 'danger' }),
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
          {sourceDevice?.name} — {sourcePort?.name}
        </div>
        <div className="text-default-500">↓</div>
        <div>
          {targetDevice?.name} — {targetPort?.name}
        </div>
      </div>
      {enumSelect(Object.values(CableType), cable.cableType, (v) => save.mutate({ cableType: v }), 'Тип кабеля')}
      <TextField>
        <Label>Длина, м</Label>
        <Input type="number" step="0.1" defaultValue={cable.length} onBlur={(e) => save.mutate({ length: Number(e.target.value) })} />
      </TextField>
      <TextField>
        <Label>Цвет</Label>
        <Input defaultValue={cable.color ?? ''} onBlur={(e) => save.mutate({ color: e.target.value || undefined })} />
      </TextField>
      <Checkbox isSelected={cable.isPatchCable} onChange={(v) => save.mutate({ isPatchCable: v })}>
        Патч-кабель
      </Checkbox>
      <Checkbox isSelected={cable.isUserOwned} onChange={(v) => save.mutate({ isUserOwned: v })}>
        Наш кабель (не площадки)
      </Checkbox>
      {cable.adapterName && <p className="text-xs text-default-500">Через переходник: {cable.adapterName}</p>}
      <Button variant="danger" fullWidth onPress={() => remove.mutate()} className="mt-2">
        <Trash2 className="h-3.5 w-3.5" />
        Удалить кабель
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
  if (!selection) {
    return (
      <div className="min-h-0 overflow-y-auto border-l border-default-200 bg-surface p-4 text-sm text-default-500">
        Выбери устройство или кабель на канвасе.
        <br />
        <br />
        Устройств: {graph.devices.length}
        <br />
        Кабелей: {graph.cables.length}
      </div>
    );
  }

  if (selection.kind === 'device') {
    const device = graph.devices.find((d) => d.id === selection.id);
    if (!device) return null;
    const children = graph.devices.filter((d) => d.parentDeviceId === device.id);
    return (
      <div className="min-h-0 overflow-y-auto border-l border-default-200 bg-surface p-3.5">
        <h3 className="mb-2.5 text-sm font-semibold">{device.name}</h3>
        <DeviceForm
          key={device.id}
          device={device}
          setupId={setupId}
          children={children}
          onAddChild={() => onAddChild(device.id)}
          onSelectChild={onSelectDevice}
        />
      </div>
    );
  }

  const cable = graph.cables.find((c) => c.id === selection.id);
  if (!cable) return null;
  return (
    <div className="min-h-0 overflow-y-auto border-l border-default-200 bg-surface p-3.5">
      <h3 className="mb-2.5 text-sm font-semibold">Кабель</h3>
      <CableForm key={cable.id} cable={cable} setupId={setupId} graph={graph} />
    </div>
  );
}
