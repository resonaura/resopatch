import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { DeviceType, HostUsbType, InventoryStatus, PowerSourceType, type CreateDeviceDto } from '@resopatch/shared';
import { api } from '../api/client';

export default function NewDeviceModal({ setupId, onClose }: { setupId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [type, setType] = useState<DeviceType>(DeviceType.ACCESSORY);
  const [inventoryStatus, setInventoryStatus] = useState<InventoryStatus>(InventoryStatus.OWNED_ACTIVE);
  const [ownerRole, setOwnerRole] = useState('');

  const create = useMutation({
    mutationFn: (dto: CreateDeviceDto) => api.createDevice(dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['graph', setupId] });
      onClose();
    },
  });

  const submit = () => {
    if (!name.trim()) return;
    create.mutate({
      setupId,
      name: name.trim(),
      type,
      inventoryStatus,
      ownerRole: ownerRole || undefined,
      position: { x: 100 + Math.random() * 400, y: 100 + Math.random() * 400 },
      attrs: {},
      powerRequired: false,
      powerSourceType: PowerSourceType.NONE,
      hostUsbType: HostUsbType.NONE,
      power: {},
    });
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Новое устройство</h3>
        <label className="field">
          <span className="field-label">Название</span>
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="Например: Boss RC-5 Loop Station" />
        </label>
        <label className="field">
          <span className="field-label">Тип</span>
          <select value={type} onChange={(e) => setType(e.target.value as DeviceType)}>
            {Object.values(DeviceType).map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Статус</span>
          <select value={inventoryStatus} onChange={(e) => setInventoryStatus(e.target.value as InventoryStatus)}>
            {Object.values(InventoryStatus).map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Владелец / роль</span>
          <input value={ownerRole} onChange={(e) => setOwnerRole(e.target.value)} placeholder="Андрей / Даня-вокал / Даня-барабанщик…" />
        </label>
        {create.isError && <div className="error-text">{(create.error as Error).message}</div>}
        <div className="modal-actions">
          <button className="btn-secondary" onClick={onClose}>
            Отмена
          </button>
          <button className="btn-primary" onClick={submit} disabled={!name.trim() || create.isPending}>
            Создать
          </button>
        </div>
      </div>
    </div>
  );
}
