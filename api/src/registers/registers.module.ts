import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RegistersController } from './registers.controller';
import { RegistersService } from './registers.service';

@Module({
  imports: [AuthModule],
  controllers: [RegistersController],
  providers: [RegistersService]
})
export class RegistersModule {}
