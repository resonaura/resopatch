import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { LoginDto } from '@resopatch/shared';

@Injectable()
export class AuthService {
  constructor(private readonly jwt: JwtService) {}

  login(dto: LoginDto): string {
    if (dto.passphrase !== process.env.APP_PASSPHRASE) {
      throw new UnauthorizedException('Invalid passphrase.');
    }
    return this.jwt.sign({ sub: 'band' });
  }
}
