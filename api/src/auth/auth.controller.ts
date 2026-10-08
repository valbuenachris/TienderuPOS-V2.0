import { Body, Controller, Get, Headers, Ip, Post, Req, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { SuperAdminGuard } from './super-admin.guard';
import { TenantContextGuard } from './tenant-context.guard';
import { LoginDto, SwitchTenantDto } from './auth.dto';
import { PosRequest } from './auth.types';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  login(@Body() body: LoginDto, @Headers('host') host: string, @Ip() ip: string) {
    const hostname = (host || '').split(':')[0].toLowerCase();
    return this.auth.login(body.identity, body.password, hostname, ip || '');
  }

  @Get('me')
  @UseGuards(JwtAuthGuard, TenantContextGuard)
  me(@Req() request: PosRequest) {
    return {
      tenant_id: request.tenantId,
      user: request.posUser,
      super: request.posClaims?.super === true
    };
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard, TenantContextGuard)
  async logout(@Req() request: PosRequest) {
    await this.auth.logout(request.posClaims!.sid, request.tenantId!);
    return { ok: true };
  }

  @Post('switch-tenant')
  @UseGuards(JwtAuthGuard, TenantContextGuard, SuperAdminGuard)
  switchTenant(@Req() request: PosRequest, @Body() body: SwitchTenantDto, @Ip() ip: string) {
    return this.auth.switchTenant(request.posUser!, request.posClaims!.sid, body.tenant_id, ip || '');
  }
}
