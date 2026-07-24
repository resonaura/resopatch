import { Column, CreateDateColumn, Entity, OneToMany, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { Device } from './device.entity.js';

@Entity({ name: 'setups' })
export class Setup {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar' })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'simple-json', nullable: true })
  checklistState: Record<string, boolean> | null;

  @OneToMany(() => Device, (device) => device.setup)
  devices: Device[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
