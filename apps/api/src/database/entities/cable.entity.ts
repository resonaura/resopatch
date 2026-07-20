import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, CreateDateColumn } from 'typeorm';
import { CableType } from '@resopatch/shared';
import { Port } from './port.entity';
import { Adapter } from './adapter.entity';

@Entity({ name: 'cables' })
export class Cable {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'varchar' })
  sourcePortId: string;

  @ManyToOne(() => Port, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'sourcePortId' })
  sourcePort: Port;

  @Index()
  @Column({ type: 'varchar' })
  targetPortId: string;

  @ManyToOne(() => Port, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'targetPortId' })
  targetPort: Port;

  @Column({ type: 'varchar' })
  cableType: CableType;

  @Column({ type: 'float' })
  length: number;

  @Column({ type: 'varchar', nullable: true })
  adapterId: string | null;

  @ManyToOne(() => Adapter, (adapter) => adapter.cables, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'adapterId' })
  adapter: Adapter | null;

  @Column({ type: 'boolean', default: true })
  isUserOwned: boolean;

  @Column({ type: 'varchar', nullable: true })
  color: string | null;

  @Column({ type: 'boolean', default: false })
  isPatchCable: boolean;

  @CreateDateColumn()
  createdAt: Date;
}
