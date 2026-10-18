import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Req,
  UseGuards
} from '@nestjs/common';
import { AdminGuard } from '../auth/admin.guard';
import { PosRequest } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantContextGuard } from '../auth/tenant-context.guard';
import { TenantOperationalGuard } from '../auth/tenant-operational.guard';
import { parsePagination } from '../common/pagination';
import {
  AutomationDto,
  CreateActivityDto,
  CreateLeadDto,
  SendLeadMessageDto,
  TemplateDto,
  UpdateLeadDto
} from './crm.dto';
import { CrmService } from './crm.service';

/** CRM de ventas por tenant: solo el admin de la tienda. */
@Controller('crm')
@UseGuards(JwtAuthGuard, TenantContextGuard, AdminGuard, TenantOperationalGuard)
export class CrmController {
  constructor(private readonly crm: CrmService) {}

  @Get('leads')
  listLeads(
    @Req() request: PosRequest,
    @Query('stage') stage?: string,
    @Query('source') source?: string,
    @Query('q') q?: string,
    @Query('overdue') overdue?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string
  ) {
    return this.crm.listLeads(request.tenantId!, {
      stage,
      source,
      q: q === undefined ? undefined : q.trim().slice(0, 100),
      overdue: overdue === 'true' || overdue === '1',
      pagination: parsePagination(page, limit, 30, 100)
    });
  }

  @Post('leads')
  createLead(@Req() request: PosRequest, @Body() body: CreateLeadDto) {
    return this.crm.createLead(request.tenantId!, body);
  }

  @Get('leads/:id')
  getLead(@Req() request: PosRequest, @Param('id', ParseIntPipe) id: number) {
    return this.crm.getLead(request.tenantId!, id);
  }

  @Put('leads/:id')
  updateLead(
    @Req() request: PosRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateLeadDto
  ) {
    return this.crm.updateLead(request.tenantId!, request.posUser?.id ?? null, id, body);
  }

  @Post('leads/:id/activities')
  addActivity(
    @Req() request: PosRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: CreateActivityDto
  ) {
    return this.crm.addActivity(request.tenantId!, request.posUser?.id ?? null, id, body);
  }

  @Put('leads/:id/activities/:activityId/complete')
  completeActivity(
    @Req() request: PosRequest,
    @Param('id', ParseIntPipe) id: number,
    @Param('activityId', ParseIntPipe) activityId: number
  ) {
    return this.crm.completeActivity(request.tenantId!, id, activityId);
  }

  @Post('leads/:id/message')
  sendMessage(
    @Req() request: PosRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: SendLeadMessageDto
  ) {
    return this.crm.sendMessage(request.tenantId!, request.posUser?.id ?? null, id, body);
  }

  @Get('templates')
  listTemplates(@Req() request: PosRequest) {
    return this.crm.listTemplates(request.tenantId!);
  }

  @Post('templates')
  createTemplate(@Req() request: PosRequest, @Body() body: TemplateDto) {
    return this.crm.createTemplate(request.tenantId!, body);
  }

  @Put('templates/:id')
  updateTemplate(
    @Req() request: PosRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: TemplateDto
  ) {
    return this.crm.updateTemplate(request.tenantId!, id, body);
  }

  @Delete('templates/:id')
  deleteTemplate(@Req() request: PosRequest, @Param('id', ParseIntPipe) id: number) {
    return this.crm.deleteTemplate(request.tenantId!, id);
  }

  @Get('automations')
  listAutomations(@Req() request: PosRequest) {
    return this.crm.listAutomations(request.tenantId!);
  }

  @Post('automations')
  createAutomation(@Req() request: PosRequest, @Body() body: AutomationDto) {
    return this.crm.createAutomation(request.tenantId!, body);
  }

  @Put('automations/:id')
  updateAutomation(
    @Req() request: PosRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: AutomationDto
  ) {
    return this.crm.updateAutomation(request.tenantId!, id, body);
  }

  @Delete('automations/:id')
  deleteAutomation(@Req() request: PosRequest, @Param('id', ParseIntPipe) id: number) {
    return this.crm.deleteAutomation(request.tenantId!, id);
  }

  @Get('summary')
  summary(@Req() request: PosRequest) {
    return this.crm.summary(request.tenantId!);
  }
}
