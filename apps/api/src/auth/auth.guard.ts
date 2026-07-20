import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();

    const botKey = req.headers['x-bot-key'];
    if (botKey && process.env.BOT_API_KEY && botKey === process.env.BOT_API_KEY) {
      return true;
    }

    const token = req.cookies?.token ?? req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      throw new UnauthorizedException('Missing auth token.');
    }
    try {
      this.jwt.verify(token);
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired token.');
    }
  }
}
