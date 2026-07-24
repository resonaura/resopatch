import { Body, Controller, HttpCode, Patch, Post, Res, UseGuards, UsePipes } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { changePasswordSchema, loginSchema } from '@resopatch/shared';
import { AuthGuard } from './auth.guard.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { AuthService } from './auth.service.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @HttpCode(200)
  @UsePipes(new ZodValidationPipe(loginSchema))
  async login(@Body() body: ReturnType<typeof loginSchema.parse>, @Res({ passthrough: true }) res: FastifyReply) {
    const token = await this.authService.login(body);
    res.setCookie('token', token, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 30,
    });
    return { ok: true };
  }

  @Post('logout')
  @HttpCode(200)
  logout(@Res({ passthrough: true }) res: FastifyReply) {
    res.clearCookie('token', { path: '/' });
    return { ok: true };
  }

  @UseGuards(AuthGuard)
  @Patch('password')
  @UsePipes(new ZodValidationPipe(changePasswordSchema))
  async changePassword(@Body() body: ReturnType<typeof changePasswordSchema.parse>) {
    await this.authService.changePassword(body);
    return { ok: true };
  }
}
