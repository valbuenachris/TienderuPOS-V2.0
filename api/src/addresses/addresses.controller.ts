import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Req, UseGuards } from '@nestjs/common';
import { CustomerContextGuard } from '../auth/customer-context.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PosRequest } from '../auth/auth.types';
import { CreateAddressDto, UpdateAddressDto } from './addresses.dto';
import { AddressesService } from './addresses.service';

@Controller('customer/addresses')
@UseGuards(JwtAuthGuard, CustomerContextGuard)
export class AddressesController {
  constructor(private readonly addresses: AddressesService) {}

  @Get()
  list(@Req() request: PosRequest) {
    return this.addresses.list(request.tenantId!, request.posCustomer!.id);
  }

  @Post()
  create(@Req() request: PosRequest, @Body() body: CreateAddressDto) {
    return this.addresses.create(request.tenantId!, request.posCustomer!.id, body);
  }

  @Put(':id/set-default')
  setDefault(@Req() request: PosRequest, @Param('id', ParseIntPipe) id: number) {
    return this.addresses.setDefault(request.tenantId!, request.posCustomer!.id, id);
  }

  @Put(':id')
  update(@Req() request: PosRequest, @Param('id', ParseIntPipe) id: number, @Body() body: UpdateAddressDto) {
    return this.addresses.update(request.tenantId!, request.posCustomer!.id, id, body);
  }

  @Delete(':id')
  remove(@Req() request: PosRequest, @Param('id', ParseIntPipe) id: number) {
    return this.addresses.remove(request.tenantId!, request.posCustomer!.id, id);
  }
}
