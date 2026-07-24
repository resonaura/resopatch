import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import { Spinner, Toast } from '@heroui/react';
import { ApiError, api } from './api/client';
import { I18nProvider, useI18n } from './lib/i18n';
import { useCloudSync } from './lib/sync';
import Login from './pages/Login';
import Constructor from './pages/Constructor';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});

function CenterScreen({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full items-center justify-center text-default-500">{children}</div>;
}

function Gate() {
  const { t } = useI18n();
  const qc = useQueryClient();
  useCloudSync(qc);
  const setups = useQuery({
    queryKey: ['setups'],
    queryFn: api.listSetups,
    // A 401 means "show the login screen", not a connectivity problem — don't retry that.
    // Anything else (server not up yet, network hiccup, etc.) retries forever with backoff,
    // since there's no useful error state to show the user here beyond "still connecting".
    retry: (_failureCount, error) => !(error instanceof ApiError && error.status === 401),
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 10000),
  });

  const needsLogin = setups.isError && setups.error instanceof ApiError && setups.error.status === 401;

  if (needsLogin) {
    return <Login onSuccess={() => qc.invalidateQueries({ queryKey: ['setups'] })} />;
  }

  if (!setups.data) {
    return (
      <CenterScreen>
        <Spinner size="lg" />
      </CenterScreen>
    );
  }

  const list = setups.data ?? [];
  if (list.length === 0) {
    return <CenterScreen>{t('app.noSetup')}</CenterScreen>;
  }

  return <Constructor setupId={list[0].id} setupName={list[0].name} />;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <Toast.Provider />
        <Gate />
      </I18nProvider>
    </QueryClientProvider>
  );
}
