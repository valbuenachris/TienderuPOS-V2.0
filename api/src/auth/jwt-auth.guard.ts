import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PosClaims, PosRequest } from './auth.types';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService, private readonly config: ConfigService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<PosRequest>();
    const match = /^Bearer\s+(.+)$/i.exec(request.headers.authorization ?? '');
    if (!match) throw new UnauthorizedException('Bearer token required');

    try {
      const claims = await this.jwt.verifyAsync<PosClaims>(match[1], {
        secret: this.config.getOrThrow<string>('JWT_SECRET'),
        issuer: 'pos-gres-v2',
        algorithms: ['HS256']
      });
      if (!claims.sub) throw new Error('Missing token claims');
      // La cuenta global de tienderu.com no es tenant-scoped y no usa sesión.
      if (claims.type === 'marketplace_customer') {
        request.posClaims = claims;
        return true;
      }
      if (!claims.tenant_id) throw new Error('Missing token claims');
      if (claims.type !== 'customer' && !claims.sid) throw new Error('Missing token claims');
      request.posClaims = claims;
      return true;
    } catch (_error: unknown) {
      throw new UnauthorizedException('Bearer token invalid or expired');
    }
  }
}
