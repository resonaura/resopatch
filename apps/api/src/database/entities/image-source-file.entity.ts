import { Column, CreateDateColumn, Entity, Index, OneToMany, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { ImageCacheVariant } from './image-cache-variant.entity';

/**
 * One row per file under the image storage dir (device/gear photos). Separate sqlite db from
 * the app's json-db (see database/json-db.ts) — this is a disposable index the reconciliation
 * pipeline rebuilds from disk, not primary app data.
 */
@Entity('image_source_files')
export class ImageSourceFile {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index({ unique: true })
  @Column({ type: 'text' })
  relativePath!: string;

  @Column({ type: 'text' })
  contentHash!: string;

  @Column({ type: 'integer' })
  size!: number;

  @Column({ type: 'float' })
  mtimeMs!: number;

  @Column({ type: 'integer', nullable: true })
  width!: number | null;

  @Column({ type: 'integer', nullable: true })
  height!: number | null;

  @Column({ type: 'text', default: '' })
  lqip!: string;

  /** Per-row brightness profile (0 = black, 1 = white), top to bottom — see
   * OptimizerService.computeBrightnessProfile. */
  @Column({ type: 'simple-json', nullable: true })
  contrastProfile!: number[] | null;

  @OneToMany(() => ImageCacheVariant, (variant) => variant.sourceFile)
  variants!: ImageCacheVariant[];

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
