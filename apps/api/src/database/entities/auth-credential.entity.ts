import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * Single-row table holding the shared band passphrase (hashed) and its role.
 * There's only ever one login for this app — the whole band shares one dashboard — so this
 * intentionally isn't a users table. `role` exists so the concept is representable if the app
 * ever grows real multi-user accounts; today the one row is always 'admin'.
 */
@Entity({ name: 'auth_credentials' })
export class AuthCredential {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar' })
  passphraseHash: string;

  @Column({ type: 'varchar', default: 'admin' })
  role: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
