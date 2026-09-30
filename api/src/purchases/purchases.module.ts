import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PurchasesController } from './purchases.controller';
import { PurchasesService } from './purchases.service';

@Module({
  imports: [AuthModule],
  controllers: [PurchasesController],
  providers: [PurchasesService]
})
export class PurchasesModule {}
