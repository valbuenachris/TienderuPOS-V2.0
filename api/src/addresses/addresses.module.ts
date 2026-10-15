import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AddressesController } from './addresses.controller';
import { AddressesService } from './addresses.service';

@Module({
  imports: [AuthModule],
  controllers: [AddressesController],
  providers: [AddressesService]
})
export class AddressesModule {}
