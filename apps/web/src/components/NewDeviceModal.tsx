import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Input, Label, ListBox, Modal, Select, TextField, toast } from '@heroui/react';
import { Plus } from 'lucide-react';
import { DeviceType, HostUsbType, InventoryStatus, PowerSourceType, type CreateDeviceDto } from '@resopatch/shared';
import { api } from '../api/client';
import { DeviceTypeIcon } from '../lib/deviceIcons';
import ImagePicker from './ImagePicker';

export default function NewDeviceModal({
  setupId,
  defaultParentId,
  onClose,
}: {
  setupId: string;
  defaultParentId?: string | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const graphQuery = useQuery({ queryKey: ['graph', setupId], queryFn: () => api.getGraph(setupId) });
  const [name, setName] = useState('');
  const [type, setType] = useState<DeviceType>(DeviceType.ACCESSORY);
  const [inventoryStatus, setInventoryStatus] = useState<InventoryStatus>(InventoryStatus.OWNED_ACTIVE);
  const [ownerRole, setOwnerRole] = useState('');
  const [parentDeviceId, setParentDeviceId] = useState<string>(defaultParentId ?? '__none__');
  const [imageUrl, setImageUrl] = useState<string | undefined>(undefined);

  const create = useMutation({
    mutationFn: (dto: CreateDeviceDto) => api.createDevice(dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['graph', setupId] });
      onClose();
    },
    onError: (err) => toast(err instanceof Error ? err.message : 'Не удалось создать устройство', { variant: 'danger' }),
  });

  const submit = () => {
    if (!name.trim()) return;
    create.mutate({
      setupId,
      name: name.trim(),
      type,
      inventoryStatus,
      ownerRole: ownerRole || undefined,
      parentDeviceId: parentDeviceId === '__none__' ? undefined : parentDeviceId,
      position: { x: 100 + Math.random() * 400, y: 100 + Math.random() * 400 },
      imageUrl,
      attrs: {},
      powerRequired: false,
      powerSourceType: PowerSourceType.NONE,
      hostUsbType: HostUsbType.NONE,
      power: {},
    });
  };

  // Devices that already belong to a parent can't themselves become a parent — keeps nesting flat.
  const parentCandidates = (graphQuery.data?.devices ?? []).filter((d) => !d.parentDeviceId);

  return (
    <Modal>
      <Modal.Backdrop isOpen onOpenChange={(open) => !open && onClose()}>
        <Modal.Container>
          <Modal.Dialog>
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>Новое устройство</Modal.Heading>
            </Modal.Header>
            <Modal.Body className="flex flex-col gap-3">
              <TextField isRequired autoFocus>
                <Label>Название</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Например: Boss RC-5 Loop Station" />
              </TextField>
              <Select value={type} onChange={(v) => setType(v as DeviceType)}>
                <Label>Тип</Label>
                <Select.Trigger>
                  <Select.Value />
                  <Select.Indicator />
                </Select.Trigger>
                <Select.Popover>
                  <ListBox>
                    {Object.values(DeviceType).map((t) => (
                      <ListBox.Item key={t} id={t} textValue={t}>
                        <DeviceTypeIcon type={t} className="h-3.5 w-3.5 text-default-500" />
                        {t}
                      </ListBox.Item>
                    ))}
                  </ListBox>
                </Select.Popover>
              </Select>
              <Select value={inventoryStatus} onChange={(v) => setInventoryStatus(v as InventoryStatus)}>
                <Label>Статус</Label>
                <Select.Trigger>
                  <Select.Value />
                  <Select.Indicator />
                </Select.Trigger>
                <Select.Popover>
                  <ListBox>
                    {Object.values(InventoryStatus).map((t) => (
                      <ListBox.Item key={t} id={t} textValue={t}>
                        {t}
                      </ListBox.Item>
                    ))}
                  </ListBox>
                </Select.Popover>
              </Select>
              <TextField>
                <Label>Владелец / роль</Label>
                <Input value={ownerRole} onChange={(e) => setOwnerRole(e.target.value)} placeholder="Андрей / Даня-вокал / Даня-барабанщик…" />
              </TextField>
              <ImagePicker value={imageUrl} onChange={setImageUrl} />
              <Select value={parentDeviceId} onChange={(v) => setParentDeviceId(v as string)}>
                <Label>Внутри устройства (необязательно)</Label>
                <Select.Trigger>
                  <Select.Value />
                  <Select.Indicator />
                </Select.Trigger>
                <Select.Popover>
                  <ListBox>
                    <ListBox.Item id="__none__" textValue="Отдельным узлом на схеме">
                      — отдельным узлом на схеме —
                    </ListBox.Item>
                    {parentCandidates.map((d) => (
                      <ListBox.Item key={d.id} id={d.id} textValue={d.name}>
                        <DeviceTypeIcon type={d.type} className="h-3.5 w-3.5 text-default-500" />
                        {d.name}
                      </ListBox.Item>
                    ))}
                  </ListBox>
                </Select.Popover>
              </Select>
              <p className="text-xs text-default-500">
                Если выбрать устройство — новое появится списком внутри его карточки (как тюнер на гитаре или педаль на педалборде),
                а не отдельным блоком на канвасе.
              </p>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="secondary" onPress={onClose}>
                Отмена
              </Button>
              <Button onPress={submit} isDisabled={!name.trim()} isPending={create.isPending}>
                <Plus className="h-3.5 w-3.5" />
                Создать
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
