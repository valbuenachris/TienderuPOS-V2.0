import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AdminGuard } from './admin.guard';
import { CustomerContextGuard } from './customer-context.guard';
import { JwtAuthGuard } from './jwt-auth.guard';
import { TenantContextGuard } from './tenant-context.guard';

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const secret = config.getOrThrow<string>('JWT_SECRET');
        if (Buffer.byteLength(secret, 'utf8') < 32) {
          throw new Error('JWT_SECRET must contain at least 32 bytes');
        }
        return {
          secret,
          signOptions: { issuer: 'pos-gres-v2', algorithm: 'HS256' as const }
        };
      }
    })
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard, TenantContextGuard, CustomerContextGuard, AdminGuard],
  exports: [JwtModule, JwtAuthGuard, TenantContextGuard, CustomerContextGuard, AdminGuard]
})
export class AuthModule {}
