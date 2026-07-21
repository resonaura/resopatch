import { Body, Controller, HttpCode, Patch, Post, Res, UseGuards, UsePipes } from '@nestjs/common';
import { Response } from 'express';
import { changePasswordSchema, loginSchema } from '@resopatch/shared';
import { AuthGuard } from './auth.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @HttpCode(200)
  @UsePipes(new ZodValidationPipe(loginSchema))
  async login(@Body() body: ReturnType<typeof loginSchema.parse>, @Res({ passthrough: true }) res: Response) {
    const token = await this.authService.login(body);
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

  @UseGuards(AuthGuard)
  @Patch('password')
  @UsePipes(new ZodValidationPipe(changePasswordSchema))
  async changePassword(@Body() body: ReturnType<typeof changePasswordSchema.parse>) {
    await this.authService.changePassword(body);
    return { ok: true };
  }
}
