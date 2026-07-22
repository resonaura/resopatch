import fs from 'node:fs';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import { HostUsbType, InventoryStatus, PowerSourceType } from '@resopatch/shared';
import { Setup } from './entities/setup.entity';
import { Device } from './entities/device.entity';
import { Port } from './entities/port.entity';
import { Adapter } from './entities/adapter.entity';
import { Cable } from './entities/cable.entity';
import { Furniture } from './entities/furniture.entity';
import { AuthCredential } from './entities/auth-credential.entity';

interface DbShape {
  setups: Setup[];
  devices: Device[];
  ports: Port[];
  adapters: Adapter[];
  cables: Cable[];
  furniture: Furniture[];
  authCredentials: AuthCredential[];
}

function emptyDb(): DbShape {
  return { setups: [], devices: [], ports: [], adapters: [], cables: [], furniture: [], authCredentials: [] };
}

export const jsonDbPath = process.env.JSON_DB_PATH
  ? path.resolve(process.cwd(), process.env.JSON_DB_PATH)
  : path.resolve(process.cwd(), 'data', 'resopatch.json');

/**
 * Whole app's persistence: one hand-editable JSON file, loaded into memory at startup and
 * rewritten in full on every mutation. Deliberately not a real database while the setup data is
 * still being corrected by hand (see `pnpm seed`'s docstring) — GUI edits survive server restarts
 * without needing a reseed, and the file itself can be corrected directly. Swap for TypeORM/sqlite
 * again (see git history for `data-source.ts`) once the data model has settled.
 */
class JsonDatabase {
  data: DbShape;

  constructor() {
    fs.mkdirSync(path.dirname(jsonDbPath), { recursive: true });
    if (fs.existsSync(jsonDbPath)) {
      this.data = { ...emptyDb(), ...JSON.parse(fs.readFileSync(jsonDbPath, 'utf-8')) };
    } else {
      this.data = emptyDb();
      this.persist();
    }
  }

  persist() {
    fs.writeFileSync(jsonDbPath, JSON.stringify(this.data, null, 2));
  }
}

const db = new JsonDatabase();

/** Wipes every collection back to empty — the one genuinely destructive operation, used only by
 *  the explicit `pnpm seed` script to rebuild the documented baseline from scratch. */
export function resetDatabase() {
  db.data = emptyDb();
  db.persist();
}

const IN = Symbol('in');
type InClause<V> = { [IN]: true; values: V[] };
type WhereValue<V> = V | InClause<V>;
type WhereClause<T> = { [K in keyof T]?: WhereValue<T[K]> };

export function In<V>(values: V[]): WhereValue<V> {
  return { [IN]: true, values };
}

function isInClause(v: unknown): v is InClause<unknown> {
  return !!v && typeof v === 'object' && (v as Record<symbol, unknown>)[IN] === true;
}

function matches<T>(row: T, where?: WhereClause<T>): boolean {
  if (!where) return true;
  return (Object.keys(where) as (keyof T)[]).every((key) => {
    const cond = where[key];
    const value = row[key];
    return isInClause(cond) ? cond.values.includes(value) : value === cond;
  });
}

export class JsonRepository<T extends { id: string }> {
  constructor(
    private readonly collection: keyof DbShape,
    private readonly defaults: () => Partial<T> = () => ({}),
  ) {}

  private rows(): T[] {
    return db.data[this.collection] as unknown as T[];
  }

  /** Mirrors `Repository.create()`: builds a fresh row (with defaults applied) that isn't
   *  persisted until passed to `save()`. */
  create(partial: Partial<T> = {}): T {
    const now = new Date().toISOString();
    return { id: uuidv4(), createdAt: now, updatedAt: now, ...this.defaults(), ...partial } as unknown as T;
  }

  async find(options: { where?: WhereClause<T>; order?: Partial<Record<keyof T, 'ASC' | 'DESC'>>; take?: number } = {}): Promise<T[]> {
    let rows = this.rows().filter((r) => matches(r, options.where));
    const orderEntry = options.order ? (Object.entries(options.order)[0] as [keyof T, 'ASC' | 'DESC'] | undefined) : undefined;
    if (orderEntry) {
      const [key, dir] = orderEntry;
      rows = [...rows].sort((a, b) => {
        const av = a[key] as unknown as string | number;
        const bv = b[key] as unknown as string | number;
        const cmp = av < bv ? -1 : av > bv ? 1 : 0;
        return dir === 'DESC' ? -cmp : cmp;
      });
    }
    if (options.take != null) rows = rows.slice(0, options.take);
    return rows.map((r) => ({ ...r }));
  }

  async findOne(options: { where: WhereClause<T> }): Promise<T | null> {
    const row = this.rows().find((r) => matches(r, options.where));
    return row ? { ...row } : null;
  }

  async save(entity: T): Promise<T>;
  async save(entities: T[]): Promise<T[]>;
  async save(entityOrEntities: T | T[]): Promise<T | T[]> {
    const list = Array.isArray(entityOrEntities) ? entityOrEntities : [entityOrEntities];
    const rows = this.rows();
    for (const entity of list) {
      if ('updatedAt' in (entity as Record<string, unknown>)) (entity as Record<string, unknown>).updatedAt = new Date().toISOString();
      const idx = rows.findIndex((r) => r.id === entity.id);
      if (idx >= 0) rows[idx] = { ...entity };
      else rows.push({ ...entity });
    }
    db.persist();
    return entityOrEntities;
  }

  async delete(id: string | string[]): Promise<{ affected: number }> {
    const ids = new Set(Array.isArray(id) ? id : [id]);
    const before = this.rows().length;
    const remaining = this.rows().filter((r) => !ids.has(r.id));
    (db.data as unknown as Record<string, unknown[]>)[this.collection] = remaining;
    db.persist();
    return { affected: before - remaining.length };
  }
}

export const setupsRepo = new JsonRepository<Setup>('setups', () => ({ description: null }) as Partial<Setup>);

export const devicesRepo = new JsonRepository<Device>(
  'devices',
  () =>
    ({
      inventoryStatus: InventoryStatus.OWNED_ACTIVE,
      powerRequired: false,
      powerSourceType: PowerSourceType.NONE,
      hostUsbType: HostUsbType.NONE,
      ownerRole: null,
      parentDeviceId: null,
      positionX: 0,
      positionY: 0,
      powerCurrentType: null,
      powerVoltageV: null,
      powerCurrentMA: null,
      powerPolarity: null,
      powerMaxOutputCurrentMA: null,
      powerMaxOutputPowerW: null,
      pedalIsStereoIn: null,
      pedalIsStereoOut: null,
      pedalHasPresets: null,
      pedalPresetCount: null,
      pedalHasMidiControl: null,
      pedalSmartModes: null,
      imageUrl: null,
      notes: null,
      attrs: {},
    }) as Partial<Device>,
);

export const portsRepo = new JsonRepository<Port>(
  'ports',
  () =>
    ({
      signalFormat: null,
      powerCurrentType: null,
      powerVoltageV: null,
      powerCurrentMA: null,
      powerPolarity: null,
      powerMaxOutputCurrentMA: null,
      powerMaxOutputPowerW: null,
    }) as Partial<Port>,
);

export const adaptersRepo = new JsonRepository<Adapter>('adapters', () => ({ isActive: false, invertsPolarity: false }) as Partial<Adapter>);

export const cablesRepo = new JsonRepository<Cable>(
  'cables',
  () => ({ adapterId: null, isUserOwned: true, color: null, isPatchCable: false }) as Partial<Cable>,
);

export const furnitureRepo = new JsonRepository<Furniture>('furniture', () => ({ isVenueProvided: false }) as Partial<Furniture>);

export const authRepo = new JsonRepository<AuthCredential>('authCredentials', () => ({ role: 'admin' }) as Partial<AuthCredential>);
