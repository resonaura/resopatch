import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CableType, POWER_PORT_TYPES, PortType, type CreateCableDto, type PortDto } from '@resopatch/shared';
import { api } from '../api/client';

function guessCableType(source: PortDto, target: PortDto): CableType {
  if (POWER_PORT_TYPES.includes(source.portType) && POWER_PORT_TYPES.includes(target.portType)) return CableType.POWER_LINE;
  if (source.portType === PortType.MIDI_DIN && target.portType === PortType.MIDI_DIN) return CableType.MIDI;
  if (source.portType === PortType.WIRELESS && target.portType === PortType.WIRELESS) return CableType.CONTROL_LINK;
  const usbTypes: PortType[] = [PortType.USB_A, PortType.USB_B, PortType.USB_C];
  if (usbTypes.includes(source.portType) && usbTypes.includes(target.portType)) return CableType.USB_DATA;
  return CableType.AUDIO_UNBALANCED;
}

export default function NewCableModal({
  setupId,
  sourcePortId,
  targetPortId,
  sourcePort,
  targetPort,
  sourceDeviceName,
  targetDeviceName,
  onClose,
}: {
  setupId: string;
  sourcePortId: string;
  targetPortId: string;
  sourcePort: PortDto;
  targetPort: PortDto;
  sourceDeviceName: string;
  targetDeviceName: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [cableType, setCableType] = useState<CableType>(() => guessCableType(sourcePort, targetPort));
  const [length, setLength] = useState(1);
  const [adapterId, setAdapterId] = useState<string>('');
  const [color, setColor] = useState('');

  const adapters = useQuery({ queryKey: ['adapters'], queryFn: api.listAdapters });

  const create = useMutation({
    mutationFn: (dto: CreateCableDto) => api.createCable(dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['graph', setupId] });
      onClose();
    },
  });

  const submit = () => {
    create.mutate({
      sourcePortId,
      targetPortId,
      cableType,
      length,
      adapterId: adapterId || undefined,
      color: color || undefined,
      isUserOwned: true,
      isPatchCable: false,
    });
  };

  const relevantAdapters = useMemo(() => adapters.data ?? [], [adapters.data]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Новый кабель</h3>
        <div className="cable-endpoints">
          <div>
            {sourceDeviceName} — {sourcePort.name} ({sourcePort.portType})
          </div>
          <div className="muted">→</div>
          <div>
            {targetDeviceName} — {targetPort.name} ({targetPort.portType})
          </div>
        </div>
        <label className="field">
          <span className="field-label">Тип кабеля</span>
          <select value={cableType} onChange={(e) => setCableType(e.target.value as CableType)}>
            {Object.values(CableType).map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Длина, м</span>
          <input type="number" step="0.1" value={length} onChange={(e) => setLength(Number(e.target.value))} />
        </label>
        <label className="field">
          <span className="field-label">Переходник (если нужен)</span>
          <select value={adapterId} onChange={(e) => setAdapterId(e.target.value)}>
            <option value="">— без переходника —</option>
            {relevantAdapters.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.inputType} → {a.outputType})
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Цвет кабеля</span>
          <input value={color} onChange={(e) => setColor(e.target.value)} placeholder="красный / синий / зелёный…" />
        </label>
        {create.isError && <div className="error-text">{(create.error as Error).message}</div>}
        <div className="modal-actions">
          <button className="btn-secondary" onClick={onClose}>
            Отмена
          </button>
          <button className="btn-primary" onClick={submit} disabled={create.isPending}>
            Соединить
          </button>
        </div>
      </div>
    </div>
  );
}
