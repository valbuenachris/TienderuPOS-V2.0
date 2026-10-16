import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { CustomerContextGuard } from '../auth/customer-context.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PosRequest } from '../auth/auth.types';
import { CombosService } from './combos.service';

@Controller('customer/combos')
@UseGuards(JwtAuthGuard, CustomerContextGuard)
export class CombosController {
  constructor(private readonly combos: CombosService) {}

  @Get()
  list(@Req() request: PosRequest) {
    return this.combos.listActive(request.tenantId!);
  }
}
