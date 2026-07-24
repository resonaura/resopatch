import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Button, Input, Label, ListBox, Modal, Select, TextField, toast } from '@heroui/react';
import { KeyRound } from 'lucide-react';
import { api, ApiError } from '../api/client';
import { useI18n } from '../lib/i18n';

export default function SettingsModal({ onClose }: { onClose: () => void }) {
  const { t, language, setLanguage } = useI18n();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const change = useMutation({
    mutationFn: () => api.changePassword({ currentPassword, newPassword }),
    onSuccess: () => {
      toast(t('settings.success'), { variant: 'success' });
      onClose();
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : t('settings.errFailed'));
    },
  });

  const submit = () => {
    setError(null);
    if (newPassword.length < 4) {
      setError(t('settings.errShort'));
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(t('settings.errMismatch'));
      return;
    }
    change.mutate();
  };

  return (
    <Modal>
      <Modal.Backdrop isOpen onOpenChange={(open) => !open && onClose()}>
        <Modal.Container>
          <Modal.Dialog>
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>{t('settings.title')}</Modal.Heading>
            </Modal.Header>
            <Modal.Body className="flex flex-col gap-3">
              <Select value={language} onChange={(v) => setLanguage(v as 'en' | 'ru')}>
                <Label>{t('settings.language')}</Label>
                <Select.Trigger>
                  <Select.Value />
                  <Select.Indicator />
                </Select.Trigger>
                <Select.Popover>
                  <ListBox>
                    <ListBox.Item id="en" textValue="English">
                      English
                    </ListBox.Item>
                    <ListBox.Item id="ru" textValue="Русский">
                      Русский
                    </ListBox.Item>
                  </ListBox>
                </Select.Popover>
              </Select>
              <TextField isRequired>
                <Label>{t('settings.currentPassword')}</Label>
                <Input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} autoFocus />
              </TextField>
              <TextField isRequired>
                <Label>{t('settings.newPassword')}</Label>
                <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
              </TextField>
              <TextField isRequired>
                <Label>{t('settings.repeatPassword')}</Label>
                <Input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
              </TextField>
              {error && <p className="text-sm text-danger">{error}</p>}
            </Modal.Body>
            <Modal.Footer>
              <Button variant="secondary" onPress={onClose}>
                {t('settings.cancel')}
              </Button>
              <Button onPress={submit} isDisabled={!currentPassword || !newPassword} isPending={change.isPending}>
                <KeyRound className="h-3.5 w-3.5" />
                {t('settings.save')}
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
