import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import {
  CurrentType,
  DeviceType,
  HostUsbType,
  InventoryStatus,
  Polarity,
  PowerSourceType,
} from '@resopatch/shared';
import { Setup } from './setup.entity.js';
import { Port } from './port.entity.js';
import { Furniture } from './furniture.entity.js';

/**
 * A device is any physical item in the setup: an audio interface, a pedal, a power splitter,
 * a strap, a lamp — anything that can appear in the inventory. Power and pedal metadata are
 * flattened onto the row (rather than split into side-tables) because they're always small,
 * always optional, and always read together with the device — see docs/stage-setup.md §13.
 */
@Entity({ name: 'devices' })
export class Device {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'varchar' })
  setupId: string;

  @ManyToOne(() => Setup, (setup) => setup.devices, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'setupId' })
  setup: Setup;

  @Column({ type: 'varchar' })
  name: string;

  @Column({ type: 'varchar' })
  type: DeviceType;

  @Column({ type: 'varchar', default: InventoryStatus.OWNED_ACTIVE })
  inventoryStatus: InventoryStatus;

  @Column({ type: 'boolean', default: false })
  powerRequired: boolean;

  @Column({ type: 'varchar', default: PowerSourceType.NONE })
  powerSourceType: PowerSourceType;

  @Column({ type: 'varchar', default: HostUsbType.NONE })
  hostUsbType: HostUsbType;

  @Column({ type: 'varchar', nullable: true })
  ownerRole: string | null;

  @Index()
  @Column({ type: 'varchar', nullable: true })
  parentDeviceId: string | null;

  @Column({ type: 'float', default: 0 })
  positionX: number;

  @Column({ type: 'float', default: 0 })
  positionY: number;

  // --- power profile: this device's own power input (see shared PowerProfile) -----------------
  @Column({ type: 'varchar', nullable: true })
  powerCurrentType: CurrentType | null;

  @Column({ type: 'float', nullable: true })
  powerVoltageV: number | null;

  @Column({ type: 'float', nullable: true })
  powerCurrentMA: number | null;

  @Column({ type: 'varchar', nullable: true })
  powerPolarity: Polarity | null;

  @Column({ type: 'float', nullable: true })
  powerMaxOutputCurrentMA: number | null;

  @Column({ type: 'float', nullable: true })
  powerMaxOutputPowerW: number | null;

  // --- pedal profile: only meaningful when type === 'PEDAL' --------------------------------------
  @Column({ type: 'boolean', nullable: true })
  pedalIsStereoIn: boolean | null;

  @Column({ type: 'boolean', nullable: true })
  pedalIsStereoOut: boolean | null;

  @Column({ type: 'boolean', nullable: true })
  pedalHasPresets: boolean | null;

  @Column({ type: 'int', nullable: true })
  pedalPresetCount: number | null;

  @Column({ type: 'boolean', nullable: true })
  pedalHasMidiControl: boolean | null;

  @Column({ type: 'simple-json', nullable: true })
  pedalSmartModes: string[] | null;

  @Column({ type: 'varchar', nullable: true })
  imageUrl: string | null;

  @Column({ type: 'simple-json', nullable: true })
  imageUrls: string[] | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ type: 'simple-json', default: '{}' })
  attrs: Record<string, unknown>;

  @OneToMany(() => Port, (port) => port.device)
  ports: Port[];

  @OneToOne(() => Furniture, (furniture) => furniture.device)
  furniture: Furniture | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
