import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { RequestOtpDto, VerifyOtpDto } from './auth-otp.dto';
import { AuthOtpService } from './auth-otp.service';

@Controller('auth')
export class AuthOtpController {
  constructor(private readonly authOtp: AuthOtpService) {}

  @Post('customer-request-otp')
  @HttpCode(200)
  requestOtp(@Body() body: RequestOtpDto) {
    return this.authOtp.requestOtp(body.identity);
  }

  @Post('customer-verify-otp')
  @HttpCode(200)
  verifyOtp(@Body() body: VerifyOtpDto) {
    return this.authOtp.verifyOtp(body.identity, body.code, body.new_password);
  }
}