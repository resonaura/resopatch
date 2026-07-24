import { useEffect } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import { io } from 'socket.io-client';

const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3001';

/** Opens one persistent, auth-cookie-scoped WebSocket connection to the API and invalidates the
 *  affected React Query caches whenever the server reports a write (device moved, cable added,
 *  checklist checked off, …) — see json-db.ts's `dbEvents` / sync.gateway.ts on the API side.
 *  socket.io's client already retries indefinitely with backoff on its own, so no custom
 *  reconnect loop is needed here beyond just letting it run for the component's lifetime. */
export function useCloudSync(queryClient: QueryClient) {
  useEffect(() => {
    const socket = io(API_URL, {
      withCredentials: true,
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
    });

    socket.on('db:changed', () => {
      queryClient.invalidateQueries({ queryKey: ['graph'] });
      queryClient.invalidateQueries({ queryKey: ['setup'] });
      queryClient.invalidateQueries({ queryKey: ['setups'] });
      queryClient.invalidateQueries({ queryKey: ['input-list'] });
      queryClient.invalidateQueries({ queryKey: ['rider'] });
    });

    return () => {
      socket.disconnect();
    };
  }, [queryClient]);
}
