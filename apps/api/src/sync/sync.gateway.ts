import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { OnGatewayConnection, OnGatewayDisconnect, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { dbEvents } from '../database/json-db.js';

function extractToken(socket: Socket): string | undefined {
  const auth = socket.handshake.auth as Record<string, unknown> | undefined;
  if (typeof auth?.token === 'string') return auth.token;
  const cookieHeader = socket.handshake.headers.cookie;
  const match = cookieHeader?.match(/(?:^|;\s*)token=([^;]+)/);
  return match?.[1];
}

/** Persistent, account-authenticated live-sync channel: broadcasts a `db:changed` event to every
 *  connected client whenever anything is written to the JSON store (device positions, pedalboard
 *  arrangements, checklist state, …) — see `dbEvents` in json-db.ts, the single choke point every
 *  repo write already goes through. Clients react by refetching the affected queries (see
 *  apps/web/src/lib/sync.ts) rather than the gateway pushing full payloads itself, keeping this
 *  side deliberately dumb: one event, no per-entity-type protocol to keep in sync. */
@WebSocketGateway({ cors: { origin: process.env.WEB_ORIGIN ?? 'http://localhost:5173', credentials: true } })
export class SyncGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;

  private readonly logger = new Logger(SyncGateway.name);
  private broadcastTimer: NodeJS.Timeout | null = null;

  constructor(private readonly jwt: JwtService) {
    // Coalesce bursts of writes (e.g. auto-layout touching every device) into one broadcast.
    dbEvents.on('change', () => {
      if (this.broadcastTimer) return;
      this.broadcastTimer = setTimeout(() => {
        this.broadcastTimer = null;
        this.server?.emit('db:changed');
      }, 150);
    });
  }

  handleConnection(client: Socket): void {
    const token = extractToken(client);
    if (!token) {
      client.disconnect(true);
      return;
    }
    try {
      this.jwt.verify(token);
    } catch {
      client.disconnect(true);
      return;
    }
    this.logger.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket): void {
    this.logger.log(`Client disconnected: ${client.id}`);
  }
}
