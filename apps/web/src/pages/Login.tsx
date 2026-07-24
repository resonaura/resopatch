import { FormEvent, useState } from 'react';
import { Button, Card, Input, Label, TextField } from '@heroui/react';
import { api } from '../api/client';

export default function Login({ onSuccess }: { onSuccess: () => void }) {
  const [passphrase, setPassphrase] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.login(passphrase);
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось войти');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full items-center justify-center px-4">
      <form onSubmit={submit} className="w-full max-w-80">
        <Card className="w-full">
          <Card.Header>
            <Card.Title>Resopatch</Card.Title>
            <Card.Description>Конструктор сценического сетапа Resonaura</Card.Description>
          </Card.Header>
          <Card.Content className="flex flex-col gap-3">
            <TextField autoFocus isRequired>
              <Label>Пароль</Label>
              <Input type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} />
            </TextField>
            {error && <p className="text-sm text-danger">{error}</p>}
          </Card.Content>
          <Card.Footer>
            <Button type="submit" fullWidth isDisabled={busy || !passphrase} isPending={busy}>
              Войти
            </Button>
          </Card.Footer>
        </Card>
      </form>
    </div>
  );
}
