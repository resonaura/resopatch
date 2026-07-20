import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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

const enumOptions = (e: Record<string, string>) => Object.values(e);

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
    </label>
  );
}

function DeviceForm({ device, setupId }: { device: GraphDevice; setupId: string }) {
  const qc = useQueryClient();
  const [form, setForm] = useState(device);
  const [attrsText, setAttrsText] = useState(() => JSON.stringify(device.attrs, null, 2));
  const [attrsError, setAttrsError] = useState<string | null>(null);

  useEffect(() => {
    setForm(device);
    setAttrsText(JSON.stringify(device.attrs, null, 2));
    setAttrsError(null);
  }, [device.id]);

  const save = useMutation({
    mutationFn: (dto: UpdateDeviceDto) => api.updateDevice(device.id, dto),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['graph', setupId] }),
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
    <div className="inspector-body">
      <Field label="Название">
        <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} onBlur={() => commitField('name', form.name)} />
      </Field>
      <Field label="Тип">
        <select value={form.type} onChange={(e) => commitField('type', e.target.value as DeviceType)}>
          {enumOptions(DeviceType).map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Статус в инвентаре">
        <select value={form.inventoryStatus} onChange={(e) => commitField('inventoryStatus', e.target.value as InventoryStatus)}>
          {enumOptions(InventoryStatus).map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Владелец / роль">
        <input
          value={form.ownerRole ?? ''}
          onChange={(e) => setForm((f) => ({ ...f, ownerRole: e.target.value }))}
          onBlur={() => commitField('ownerRole', form.ownerRole || undefined)}
          placeholder="Андрей / Даня-вокал / Даня-барабанщик…"
        />
      </Field>

      <details open>
        <summary>Питание</summary>
        <Field label="Требует питание">
          <input type="checkbox" checked={form.powerRequired} onChange={(e) => commitField('powerRequired', e.target.checked)} />
        </Field>
        <Field label="Источник питания">
          <select value={form.powerSourceType} onChange={(e) => commitField('powerSourceType', e.target.value as PowerSourceType)}>
            {enumOptions(PowerSourceType).map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Тип USB-хоста">
          <select value={form.hostUsbType} onChange={(e) => commitField('hostUsbType', e.target.value as HostUsbType)}>
            {enumOptions(HostUsbType).map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </Field>
        <div className="field-row">
          <Field label="Ток (AC/DC)">
            <select
              value={form.power.currentType ?? ''}
              onChange={(e) => commitField('power', { ...form.power, currentType: (e.target.value || undefined) as CurrentType | undefined })}
            >
              <option value="">—</option>
              {enumOptions(CurrentType).map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Полярность">
            <select
              value={form.power.polarity ?? ''}
              onChange={(e) => commitField('power', { ...form.power, polarity: (e.target.value || undefined) as Polarity | undefined })}
            >
              <option value="">—</option>
              {enumOptions(Polarity).map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="field-row">
          <Field label="Напряжение, В">
            <input
              type="number"
              value={form.power.voltageV ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, power: { ...f.power, voltageV: e.target.value === '' ? undefined : Number(e.target.value) } }))}
              onBlur={() => commitField('power', form.power)}
            />
          </Field>
          <Field label="Ток, мА">
            <input
              type="number"
              value={form.power.currentMA ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, power: { ...f.power, currentMA: e.target.value === '' ? undefined : Number(e.target.value) } }))}
              onBlur={() => commitField('power', form.power)}
            />
          </Field>
        </div>
        <div className="field-row">
          <Field label="Макс. отдача, мА">
            <input
              type="number"
              value={form.power.maxOutputCurrentMA ?? ''}
              onChange={(e) =>
                setForm((f) => ({ ...f, power: { ...f.power, maxOutputCurrentMA: e.target.value === '' ? undefined : Number(e.target.value) } }))
              }
              onBlur={() => commitField('power', form.power)}
            />
          </Field>
          <Field label="Макс. отдача, Вт">
            <input
              type="number"
              value={form.power.maxOutputPowerW ?? ''}
              onChange={(e) =>
                setForm((f) => ({ ...f, power: { ...f.power, maxOutputPowerW: e.target.value === '' ? undefined : Number(e.target.value) } }))
              }
              onBlur={() => commitField('power', form.power)}
            />
          </Field>
        </div>
        {powerBudget.data && (
          <div className={`power-budget ${powerBudget.data.overBudget ? 'over' : 'ok'}`}>
            <div>
              Нагрузка: {powerBudget.data.drawnPowerW.toFixed(1)}W
              {powerBudget.data.maxOutputPowerW != null ? ` / ${powerBudget.data.maxOutputPowerW}W` : ''}
              {powerBudget.data.overBudget ? ' — ПРЕВЫШЕНО' : ''}
            </div>
            {powerBudget.data.unresolvedLoads.length > 0 && (
              <div className="muted">Без указанного потребления: {powerBudget.data.unresolvedLoads.map((l) => l.deviceName).join(', ')}</div>
            )}
          </div>
        )}
      </details>

      {form.type === DeviceType.PEDAL && (
        <details open>
          <summary>Педаль</summary>
          <div className="field-row">
            <Field label="Стерео вход">
              <input
                type="checkbox"
                checked={form.pedal?.isStereoIn ?? false}
                onChange={(e) => commitField('pedal', { ...(form.pedal ?? {}), isStereoIn: e.target.checked })}
              />
            </Field>
            <Field label="Стерео выход">
              <input
                type="checkbox"
                checked={form.pedal?.isStereoOut ?? false}
                onChange={(e) => commitField('pedal', { ...(form.pedal ?? {}), isStereoOut: e.target.checked })}
              />
            </Field>
          </div>
          <div className="field-row">
            <Field label="Есть пресеты">
              <input
                type="checkbox"
                checked={form.pedal?.hasPresets ?? false}
                onChange={(e) => commitField('pedal', { ...(form.pedal ?? {}), hasPresets: e.target.checked })}
              />
            </Field>
            <Field label="Кол-во пресетов">
              <input
                type="number"
                value={form.pedal?.presetCount ?? ''}
                onChange={(e) =>
                  setForm((f) => ({ ...f, pedal: { ...(f.pedal ?? {}), presetCount: e.target.value === '' ? undefined : Number(e.target.value) } }))
                }
                onBlur={() => commitField('pedal', form.pedal ?? undefined)}
              />
            </Field>
          </div>
          <Field label="MIDI-управление пресетами">
            <input
              type="checkbox"
              checked={form.pedal?.hasMidiControl ?? false}
              onChange={(e) => commitField('pedal', { ...(form.pedal ?? {}), hasMidiControl: e.target.checked })}
            />
          </Field>
          <Field label="Smart-режимы (через запятую)">
            <input
              value={(form.pedal?.smartModes ?? []).join(', ')}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  pedal: { ...(f.pedal ?? {}), smartModes: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) },
                }))
              }
              onBlur={() => commitField('pedal', form.pedal ?? undefined)}
            />
          </Field>
        </details>
      )}

      <details>
        <summary>Порты ({device.ports.length})</summary>
        {device.ports.map((port) => (
          <div key={port.id} className="port-row-editor">
            <input
              defaultValue={port.name}
              onBlur={(e) => e.target.value !== port.name && updatePort.mutate({ id: port.id, dto: { name: e.target.value } })}
            />
            <select
              defaultValue={port.portType}
              onChange={(e) => updatePort.mutate({ id: port.id, dto: { portType: e.target.value as PortType } })}
            >
              {enumOptions(PortType).map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <select
              defaultValue={port.direction}
              onChange={(e) => updatePort.mutate({ id: port.id, dto: { direction: e.target.value as PortDirection } })}
            >
              {enumOptions(PortDirection).map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <button className="btn-danger-mini" onClick={() => deletePort.mutate(port.id)}>
              ×
            </button>
          </div>
        ))}
        <button className="btn-secondary" onClick={() => addPort.mutate()}>
          + Порт
        </button>
      </details>

      <details>
        <summary>Заметки и доп. поля</summary>
        <Field label="Заметки">
          <textarea
            value={form.notes ?? ''}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            onBlur={() => commitField('notes', form.notes || undefined)}
            rows={3}
          />
        </Field>
        <Field label="Изображение (URL)">
          <input
            value={form.imageUrl ?? ''}
            onChange={(e) => setForm((f) => ({ ...f, imageUrl: e.target.value }))}
            onBlur={() => commitField('imageUrl', form.imageUrl || undefined)}
          />
        </Field>
        <Field label="Произвольные атрибуты (JSON)">
          <textarea value={attrsText} onChange={(e) => setAttrsText(e.target.value)} onBlur={commitAttrs} rows={6} className="mono" />
        </Field>
        {attrsError && <div className="error-text">{attrsError}</div>}
      </details>

      <button className="btn-danger" onClick={() => remove.mutate()}>
        Удалить устройство
      </button>
    </div>
  );
}

function CableForm({ cable, setupId, graph }: { cable: GraphCable; setupId: string; graph: GraphResponse }) {
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: (dto: UpdateCableDto) => api.updateCable(cable.id, dto),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['graph', setupId] }),
    onError: (err) => alert(err instanceof Error ? err.message : 'Ошибка'),
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
    <div className="inspector-body">
      <div className="cable-endpoints">
        <div>
          {sourceDevice?.name} — {sourcePort?.name}
        </div>
        <div className="muted">↓</div>
        <div>
          {targetDevice?.name} — {targetPort?.name}
        </div>
      </div>
      <Field label="Тип кабеля">
        <select defaultValue={cable.cableType} onChange={(e) => save.mutate({ cableType: e.target.value as CableType })}>
          {enumOptions(CableType).map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Длина, м">
        <input type="number" step="0.1" defaultValue={cable.length} onBlur={(e) => save.mutate({ length: Number(e.target.value) })} />
      </Field>
      <Field label="Цвет">
        <input defaultValue={cable.color ?? ''} onBlur={(e) => save.mutate({ color: e.target.value || undefined })} />
      </Field>
      <Field label="Патч-кабель">
        <input type="checkbox" defaultChecked={cable.isPatchCable} onChange={(e) => save.mutate({ isPatchCable: e.target.checked })} />
      </Field>
      <Field label="Наш кабель (не площадки)">
        <input type="checkbox" defaultChecked={cable.isUserOwned} onChange={(e) => save.mutate({ isUserOwned: e.target.checked })} />
      </Field>
      {cable.adapterName && <div className="muted">Через переходник: {cable.adapterName}</div>}
      <button className="btn-danger" onClick={() => remove.mutate()}>
        Удалить кабель
      </button>
    </div>
  );
}

export type Selection = { kind: 'device'; id: string } | { kind: 'cable'; id: string } | null;

export default function Inspector({ graph, selection, setupId }: { graph: GraphResponse; selection: Selection; setupId: string }) {
  if (!selection) {
    return (
      <div className="inspector">
        <div className="inspector-empty">
          Выбери устройство или кабель на канвасе.
          <br />
          <br />
          Устройств: {graph.devices.length}
          <br />
          Кабелей: {graph.cables.length}
        </div>
      </div>
    );
  }

  if (selection.kind === 'device') {
    const device = graph.devices.find((d) => d.id === selection.id);
    if (!device) return null;
    return (
      <div className="inspector">
        <h3>{device.name}</h3>
        <DeviceForm key={device.id} device={device} setupId={setupId} />
      </div>
    );
  }

  const cable = graph.cables.find((c) => c.id === selection.id);
  if (!cable) return null;
  return (
    <div className="inspector">
      <h3>Кабель</h3>
      <CableForm key={cable.id} cable={cable} setupId={setupId} graph={graph} />
    </div>
  );
}
