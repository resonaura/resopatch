import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import { Toast } from '@heroui/react';
import { ApiError, api } from './api/client';
import Login from './pages/Login';
import Constructor from './pages/Constructor';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});

function CenterScreen({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full items-center justify-center text-default-500">{children}</div>;
}

function Gate() {
  const qc = useQueryClient();
  const setups = useQuery({ queryKey: ['setups'], queryFn: api.listSetups });

  const needsLogin = setups.isError && setups.error instanceof ApiError && setups.error.status === 401;

  if (needsLogin) {
    return <Login onSuccess={() => qc.invalidateQueries({ queryKey: ['setups'] })} />;
  }

  if (setups.isLoading) {
    return <CenterScreen>Загрузка…</CenterScreen>;
  }

  if (setups.isError) {
    return <CenterScreen>Ошибка: {(setups.error as Error).message}</CenterScreen>;
  }

  const list = setups.data ?? [];
  if (list.length === 0) {
    return <CenterScreen>Нет ни одного сетапа. Запусти `pnpm seed` в apps/api.</CenterScreen>;
  }

  return <Constructor setupId={list[0].id} setupName={list[0].name} />;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Toast.Provider />
      <Gate />
    </QueryClientProvider>
  );
}
