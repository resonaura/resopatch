import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Button, Input, Label, Modal, TextField, toast } from '@heroui/react';
import { KeyRound } from 'lucide-react';
import { api, ApiError } from '../api/client';

export default function SettingsModal({ onClose }: { onClose: () => void }) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const change = useMutation({
    mutationFn: () => api.changePassword({ currentPassword, newPassword }),
    onSuccess: () => {
      toast('Пароль обновлён.', { variant: 'success' });
      onClose();
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : 'Не удалось сменить пароль');
    },
  });

  const submit = () => {
    setError(null);
    if (newPassword.length < 4) {
      setError('Новый пароль должен быть не короче 4 символов.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Пароли не совпадают.');
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
              <Modal.Heading>Настройки — смена пароля</Modal.Heading>
            </Modal.Header>
            <Modal.Body className="flex flex-col gap-3">
              <TextField isRequired>
                <Label>Текущий пароль</Label>
                <Input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} autoFocus />
              </TextField>
              <TextField isRequired>
                <Label>Новый пароль</Label>
                <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
              </TextField>
              <TextField isRequired>
                <Label>Повтори новый пароль</Label>
                <Input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
              </TextField>
              {error && <p className="text-sm text-danger">{error}</p>}
            </Modal.Body>
            <Modal.Footer>
              <Button variant="secondary" onPress={onClose}>
                Отмена
              </Button>
              <Button onPress={submit} isDisabled={!currentPassword || !newPassword} isPending={change.isPending}>
                <KeyRound className="h-3.5 w-3.5" />
                Сохранить
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
