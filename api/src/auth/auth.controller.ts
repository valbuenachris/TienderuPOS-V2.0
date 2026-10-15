import { Body, Controller, Get, Headers, Ip, Post, Req, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { SuperAdminGuard } from './super-admin.guard';
import { TenantContextGuard } from './tenant-context.guard';
import { CustomerContextGuard } from './customer-context.guard';
import { CustomerLoginDto, CustomerSetPasswordDto, LoginDto, SwitchTenantDto } from './auth.dto';
import { PosRequest } from './auth.types';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  login(@Body() body: LoginDto, @Headers('host') host: string, @Ip() ip: string) {
    const hostname = (host || '').split(':')[0].toLowerCase();
    return this.auth.login(body.identity, body.password, hostname, ip || '');
  }

  @Post('customer-login')
  customerLogin(@Body() body: CustomerLoginDto, @Ip() ip: string) {
    return this.auth.customerLogin(body.identity, body.password, ip || '');
  }

  @Post('customer-set-password')
  customerSetPassword(@Body() body: CustomerSetPasswordDto, @Ip() ip: string) {
    return this.auth.customerSetPassword(body.identity, body.new_password, ip || '');
  }

  @Get('customer-me')
  @UseGuards(JwtAuthGuard, CustomerContextGuard)
  customerMe(@Req() request: PosRequest) {
    return {
      tenant_id: request.tenantId,
      customer: request.posCustomer,
      role: 'customer'
    };
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
    await this.auth.logout(request.posClaims!.sid!, request.tenantId!);
    return { ok: true };
  }

  @Post('switch-tenant')
  @UseGuards(JwtAuthGuard, TenantContextGuard, SuperAdminGuard)
  switchTenant(@Req() request: PosRequest, @Body() body: SwitchTenantDto, @Ip() ip: string) {
    return this.auth.switchTenant(request.posUser!, request.posClaims!.sid!, body.tenant_id, ip || '');
  }
}
