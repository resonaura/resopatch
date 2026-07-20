import { FormEvent, useState } from 'react';
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
    <div className="center-screen">
      <form className="login-card" onSubmit={submit}>
        <h1>Resopatch</h1>
        <p className="muted">Конструктор сценического сетапа Resonaura</p>
        <input
          type="password"
          placeholder="Пароль"
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          autoFocus
        />
        {error && <div className="error-text">{error}</div>}
        <button type="submit" disabled={busy || !passphrase}>
          {busy ? 'Входим…' : 'Войти'}
        </button>
      </form>
    </div>
  );
}
