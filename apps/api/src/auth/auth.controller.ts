import { Body, Controller, HttpCode, Post, Res, UsePipes } from '@nestjs/common';
import { Response } from 'express';
import { loginSchema } from '@resopatch/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @HttpCode(200)
  @UsePipes(new ZodValidationPipe(loginSchema))
  login(@Body() body: { passphrase: string }, @Res({ passthrough: true }) res: Response) {
    const token = this.authService.login(body);
    res.cookie('token', token, {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 1000 * 60 * 60 * 24 * 30,
    });
    return { ok: true };
  }

  @Post('logout')
  @HttpCode(200)
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie('token');
    return { ok: true };
  }
}
