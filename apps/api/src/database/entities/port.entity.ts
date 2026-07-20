import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { CurrentType, Polarity, PortDirection, PortType, SignalFormat } from '@resopatch/shared';
import { Device } from './device.entity';

@Entity({ name: 'ports' })
export class Port {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'varchar' })
  deviceId: string;

  @ManyToOne(() => Device, (device) => device.ports, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'deviceId' })
  device: Device;

  @Column({ type: 'varchar' })
  name: string;

  @Column({ type: 'varchar' })
  portType: PortType;

  @Column({ type: 'varchar' })
  direction: PortDirection;

  @Column({ type: 'varchar', nullable: true })
  signalFormat: SignalFormat | null;

  // --- power profile: only meaningful for power-carrying ports (DC_BARREL / POWER_IEC / POWER_SCHUKO) ---
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
}
