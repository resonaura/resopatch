import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcryptjs';
import { ChangePasswordDto, LoginDto } from '@resopatch/shared';
import { AuthCredential } from '../database/entities/auth-credential.entity';

const DEFAULT_PASSPHRASE = 'admin';
const SALT_ROUNDS = 10;

@Injectable()
export class AuthService {
  constructor(
    private readonly jwt: JwtService,
    @InjectRepository(AuthCredential) private readonly credentials: Repository<AuthCredential>,
  ) {}

  /** The band shares one login — this table only ever has one row, created lazily on first use. */
  private async getOrCreateCredential(): Promise<AuthCredential> {
    const [existing] = await this.credentials.find({ take: 1 });
    if (existing) return existing;
    const created = this.credentials.create({
      passphraseHash: bcrypt.hashSync(DEFAULT_PASSPHRASE, SALT_ROUNDS),
      role: 'admin',
    });
    return this.credentials.save(created);
  }

  async login(dto: LoginDto): Promise<string> {
    const credential = await this.getOrCreateCredential();
    const valid = bcrypt.compareSync(dto.passphrase, credential.passphraseHash);
    if (!valid) {
      throw new UnauthorizedException('Invalid passphrase.');
    }
    return this.jwt.sign({ sub: 'band', role: credential.role });
  }

  async changePassword(dto: ChangePasswordDto): Promise<void> {
    const credential = await this.getOrCreateCredential();
    const valid = bcrypt.compareSync(dto.currentPassword, credential.passphraseHash);
    if (!valid) {
      throw new UnauthorizedException('Текущий пароль неверен.');
    }
    credential.passphraseHash = bcrypt.hashSync(dto.newPassword, SALT_ROUNDS);
    await this.credentials.save(credential);
  }
}
