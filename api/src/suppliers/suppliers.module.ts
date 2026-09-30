import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SuppliersController } from './suppliers.controller';
import { SuppliersService } from './suppliers.service';

@Module({
  imports: [AuthModule],
  controllers: [SuppliersController],
  providers: [SuppliersService]
})
export class SuppliersModule {}
