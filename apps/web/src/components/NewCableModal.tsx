import { Button, Input, Label, ListBox, Modal, Select, TextField, toast } from '@heroui/react';
import { CableType, POWER_PORT_TYPES, PortType, type CreateCableDto, type PortDto } from '@resopatch/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Cable as CableIcon } from 'lucide-react';
import { useState } from 'react';
import { api } from '../api/client';
import { cableTypeLabel, portTypeLabel } from '../lib/enumLabels';
import { useI18n } from '../lib/i18n';
import { formatI18nText } from '../lib/i18nText';

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
  const { t, language } = useI18n();
  const qc = useQueryClient();
  const [cableType, setCableType] = useState<CableType>(() => guessCableType(sourcePort, targetPort));
  const [length, setLength] = useState('1');
  const [adapterId, setAdapterId] = useState<string>('__none__');
  const [color, setColor] = useState('');

  const adapters = useQuery({ queryKey: ['adapters'], queryFn: api.listAdapters });

  const create = useMutation({
    mutationFn: (dto: CreateCableDto) => api.createCable(dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['graph', setupId] });
      onClose();
    },
    onError: (err) => toast(err instanceof Error ? err.message : t('newCableModal.createError'), { variant: 'danger' }),
  });

  const submit = () => {
    create.mutate({
      sourcePortId,
      targetPortId,
      cableType,
      length: Number(length) || 1,
      adapterId: adapterId === '__none__' ? undefined : adapterId,
      color: color || undefined,
      isUserOwned: true,
      isPatchCable: false,
    });
  };

  return (
    <Modal>
      <Modal.Backdrop isOpen onOpenChange={(open) => !open && onClose()}>
        <Modal.Container>
          <Modal.Dialog>
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>{t('newCableModal.title')}</Modal.Heading>
            </Modal.Header>
            <Modal.Body className="flex flex-col gap-3">
              <div className="rounded-lg border border-default-200 bg-surface-secondary p-2.5 text-xs">
                <div>
                  {sourceDeviceName} — {formatI18nText(sourcePort.name, language)} ({portTypeLabel(sourcePort.portType, t)})
                </div>
                <div className="text-default-500">→</div>
                <div>
                  {targetDeviceName} — {formatI18nText(targetPort.name, language)} ({portTypeLabel(targetPort.portType, t)})
                </div>
              </div>
              <Select value={cableType} onChange={(v) => setCableType(v as CableType)}>
                <Label>{t('newCableModal.type')}</Label>
                <Select.Trigger>
                  <Select.Value>{cableTypeLabel(cableType, t)}</Select.Value>
                  <Select.Indicator />
                </Select.Trigger>
                <Select.Popover>
                  <ListBox>
                    {Object.values(CableType).map((ct) => (
                      <ListBox.Item key={ct} id={ct} textValue={cableTypeLabel(ct, t)}>
                        {cableTypeLabel(ct, t)}
                      </ListBox.Item>
                    ))}
                  </ListBox>
                </Select.Popover>
              </Select>
              <TextField>
                <Label>{t('newCableModal.length')}</Label>
                <Input type="number" step="0.1" value={length} onChange={(e) => setLength(e.target.value)} />
              </TextField>
              <Select value={adapterId} onChange={(v) => setAdapterId(v as string)}>
                <Label>{t('newCableModal.adapter')}</Label>
                <Select.Trigger>
                  <Select.Value />
                  <Select.Indicator />
                </Select.Trigger>
                <Select.Popover>
                  <ListBox>
                    <ListBox.Item id="__none__" textValue={t('newCableModal.noAdapter')}>
                      {t('newCableModal.noAdapter')}
                    </ListBox.Item>
                    {(adapters.data ?? []).map((a) => (
                      <ListBox.Item
                        key={a.id}
                        id={a.id}
                        textValue={formatI18nText(a.name, language)}
                      >
                        {formatI18nText(a.name, language)} ({portTypeLabel(a.inputType, t)} → {portTypeLabel(a.outputType, t)})
                      </ListBox.Item>
                    ))}
                  </ListBox>
                </Select.Popover>
              </Select>
              <TextField>
                <Label>{t('newCableModal.color')}</Label>
                <Input value={color} onChange={(e) => setColor(e.target.value)} placeholder={t('newCableModal.colorPlaceholder')} />
              </TextField>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="secondary" onPress={onClose}>
                {t('newCableModal.cancel')}
              </Button>
              <Button onPress={submit} isPending={create.isPending}>
                <CableIcon className="h-3.5 w-3.5" />
                {t('newCableModal.connect')}
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
