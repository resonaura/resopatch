import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, CreateDateColumn } from 'typeorm';
import { CableType } from '@resopatch/shared';
import { Port } from './port.entity.js';
import { Adapter } from './adapter.entity.js';

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

  /** Brand/model of the physical cable product, e.g. "Fender Professional Series Tweed
   *  Instrument Cable" — kept separate from `length`/`color` per the naming convention. */
  @Column({ type: 'varchar', nullable: true })
  productName: string | null;

  @Column({ type: 'boolean', default: false })
  isPatchCable: boolean;

  /** A plain reference photo of the cable — shown in thumbnails (e.g. the staff checklist), as
   *  opposed to the texture fields below which are for rendering the wire's path on the canvas. */
  @Column({ type: 'varchar', nullable: true })
  imageUrl: string | null;

  /** Data URLs (or plain URLs) for a custom cable texture, split into the two end caps and the
   *  repeating middle section — bent/stamped along the routed path at render time. */
  @Column({ type: 'varchar', nullable: true })
  textureStartUrl: string | null;

  @Column({ type: 'varchar', nullable: true })
  textureEndUrl: string | null;

  @Column({ type: 'varchar', nullable: true })
  textureMiddleUrl: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
