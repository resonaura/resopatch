import { Column, Entity, JoinColumn, OneToOne, PrimaryGeneratedColumn } from 'typeorm';
import { FurnitureKind } from '@resopatch/shared';
import { Device } from './device.entity.js';

@Entity({ name: 'furniture' })
export class Furniture {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', unique: true })
  deviceId: string;

  @OneToOne(() => Device, (device) => device.furniture, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'deviceId' })
  device: Device;

  @Column({ type: 'varchar' })
  kind: FurnitureKind;

  @Column({ type: 'boolean', default: false })
  isVenueProvided: boolean;
}
