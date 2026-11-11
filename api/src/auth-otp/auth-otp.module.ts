import { Module } from '@nestjs/common';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { AuthOtpController } from './auth-otp.controller';
import { AuthOtpService } from './auth-otp.service';

@Module({
  imports: [WhatsappModule],
  controllers: [AuthOtpController],
  providers: [AuthOtpService]
})
export class AuthOtpModule {}