import { Column, Entity, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { PortType } from '@resopatch/shared';
import { Cable } from './cable.entity';

@Entity({ name: 'adapters' })
export class Adapter {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar' })
  name: string;

  @Column({ type: 'varchar' })
  inputType: PortType;

  @Column({ type: 'varchar' })
  outputType: PortType;

  @Column({ type: 'boolean', default: false })
  isActive: boolean;

  @Column({ type: 'boolean', default: false })
  invertsPolarity: boolean;

  @OneToMany(() => Cable, (cable) => cable.adapter)
  cables: Cable[];
}
