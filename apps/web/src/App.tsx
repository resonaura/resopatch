import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, api } from './api/client';
import Login from './pages/Login';
import Constructor from './pages/Constructor';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});

function Gate() {
  const qc = useQueryClient();
  const setups = useQuery({ queryKey: ['setups'], queryFn: api.listSetups });

  const needsLogin = setups.isError && setups.error instanceof ApiError && setups.error.status === 401;

  if (needsLogin) {
    return <Login onSuccess={() => qc.invalidateQueries({ queryKey: ['setups'] })} />;
  }

  if (setups.isLoading) {
    return <div className="center-screen">Загрузка…</div>;
  }

  if (setups.isError) {
    return <div className="center-screen">Ошибка: {(setups.error as Error).message}</div>;
  }

  const list = setups.data ?? [];
  if (list.length === 0) {
    return <div className="center-screen">Нет ни одного сетапа. Запусти `pnpm seed` в apps/api.</div>;
  }

  return <Constructor setupId={list[0].id} setupName={list[0].name} />;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Gate />
    </QueryClientProvider>
  );
}
