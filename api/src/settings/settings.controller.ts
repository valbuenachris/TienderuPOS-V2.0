import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Post,
  Put,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AdminGuard } from '../auth/admin.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PosRequest } from '../auth/auth.types';
import { TenantContextGuard } from '../auth/tenant-context.guard';
import { UpdateSettingsDto } from './settings.dto';
import { SettingsService } from './settings.service';

function requireTenant(request: PosRequest): string {
  if (!request.tenantId) {
    throw new BadRequestException('Tenant context required. Please select a tenant.');
  }
  return request.tenantId;
}

@Controller('settings')
@UseGuards(JwtAuthGuard, TenantContextGuard)
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get('pos')
  async getPos(@Req() request: PosRequest) {
    const settings = await this.settings.getPosForTenant(requireTenant(request));
    if (!settings) throw new NotFoundException('Global POS settings are unavailable');
    return settings;
  }

  @Get()
  @UseGuards(AdminGuard)
  async get(@Req() request: PosRequest) {
    const settings = await this.settings.getGlobalForTenant(requireTenant(request));
    if (!settings) throw new NotFoundException('Global POS settings are unavailable');
    return settings;
  }

  @Put()
  @UseGuards(AdminGuard)
  update(@Req() request: PosRequest, @Body() body: UpdateSettingsDto) {
    return this.settings.update(requireTenant(request), body);
  }

  @Post('logo')
  @UseGuards(AdminGuard)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 3 * 1024 * 1024 } }))
  uploadLogo(@Req() request: PosRequest, @UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('file is required');
    return this.settings.uploadLogo(requireTenant(request), file);
  }

  @Delete('logo')
  @UseGuards(AdminGuard)
  deleteLogo(@Req() request: PosRequest) {
    return this.settings.deleteLogo(requireTenant(request));
  }
}
