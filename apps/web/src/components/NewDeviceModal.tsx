import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Input, Label, ListBox, Modal, Select, TextField, toast } from '@heroui/react';
import { Plus } from 'lucide-react';
import { DeviceType, HostUsbType, InventoryStatus, PowerSourceType, type CreateDeviceDto } from '@resopatch/shared';
import { api } from '../api/client';
import { DeviceTypeIcon } from '../lib/deviceIcons';
import { deviceTypeKey, getDisplayName } from '../lib/deviceNaming';
import { useI18n } from '../lib/i18n';
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
  const { t, language } = useI18n();
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
    onError: (err) => toast(err instanceof Error ? err.message : t('inspector.saveError'), { variant: 'danger' }),
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
              <Modal.Heading>{t('newDeviceModal.title')}</Modal.Heading>
            </Modal.Header>
            <Modal.Body className="flex flex-col gap-3">
              <TextField isRequired autoFocus>
                <Label>{t('newDeviceModal.name')}</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Boss RC-5 Loop Station" />
              </TextField>
              <Select value={type} onChange={(v) => setType(v as DeviceType)}>
                <Label>{t('newDeviceModal.type')}</Label>
                <Select.Trigger>
                  <Select.Value />
                  <Select.Indicator />
                </Select.Trigger>
                <Select.Popover>
                  <ListBox>
                    {Object.values(DeviceType).map((devType) => (
                      <ListBox.Item key={devType} id={devType} textValue={t(deviceTypeKey(devType))}>
                        <DeviceTypeIcon type={devType} className="h-3.5 w-3.5 text-default-500" />
                        {t(deviceTypeKey(devType))}
                      </ListBox.Item>
                    ))}
                  </ListBox>
                </Select.Popover>
              </Select>
              <Select value={inventoryStatus} onChange={(v) => setInventoryStatus(v as InventoryStatus)}>
                <Label>{t('newDeviceModal.status')}</Label>
                <Select.Trigger>
                  <Select.Value />
                  <Select.Indicator />
                </Select.Trigger>
                <Select.Popover>
                  <ListBox>
                    {Object.values(InventoryStatus).map((status) => (
                      <ListBox.Item key={status} id={status} textValue={status}>
                        {status}
                      </ListBox.Item>
                    ))}
                  </ListBox>
                </Select.Popover>
              </Select>
              <TextField>
                <Label>{t('newDeviceModal.ownerRole')}</Label>
                <Input value={ownerRole} onChange={(e) => setOwnerRole(e.target.value)} placeholder={t('ownerRole.placeholder')} />
              </TextField>
              <ImagePicker value={imageUrl} onChange={setImageUrl} />
              <Select value={parentDeviceId} onChange={(v) => setParentDeviceId(v as string)}>
                <Label>{t('newDeviceModal.parent')}</Label>
                <Select.Trigger>
                  <Select.Value />
                  <Select.Indicator />
                </Select.Trigger>
                <Select.Popover>
                  <ListBox>
                    <ListBox.Item id="__none__" textValue={t('newDeviceModal.parentNone')}>
                      — {t('newDeviceModal.parentNone')} —
                    </ListBox.Item>
                    {parentCandidates.map((d) => (
                      <ListBox.Item key={d.id} id={d.id} textValue={getDisplayName(d, t, language)}>
                        <DeviceTypeIcon type={d.type} className="h-3.5 w-3.5 text-default-500" />
                        {getDisplayName(d, t, language)}
                      </ListBox.Item>
                    ))}
                  </ListBox>
                </Select.Popover>
              </Select>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="secondary" onPress={onClose}>
                {t('newDeviceModal.cancel')}
              </Button>
              <Button onPress={submit} isDisabled={!name.trim()} isPending={create.isPending}>
                <Plus className="h-3.5 w-3.5" />
                {t('newDeviceModal.submit')}
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
