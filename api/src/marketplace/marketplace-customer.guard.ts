import { CanActivate, ExecutionContext, ForbiddenException, HttpException, Injectable, UnauthorizedException } from '@nestjs/common';
import { PosMarketplaceCustomer, PosRequest } from '../auth/auth.types';
import { DatabaseService } from '../database/database.service';

/**
 * Guard de la cuenta global de tienderu.com (token `marketplace_customer`).
 * El cliente SIEMPRE sale del token; nunca de parámetros del request.
 */
@Injectable()
export class MarketplaceCustomerGuard implements CanActivate {
  constructor(private readonly database: DatabaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<PosRequest>();
    const claims = request.posClaims;
    if (claims?.type !== 'marketplace_customer') {
      throw new ForbiddenException('Marketplace customer token required');
    }
    const customerId = Number(claims.sub);
    if (!Number.isSafeInteger(customerId) || customerId < 1) {
      throw new UnauthorizedException('Invalid customer claim');
    }

    try {
      const result = await this.database.query<PosMarketplaceCustomer>(
        `SELECT id, name, email, phone
         FROM public.tec_marketplace_customers
         WHERE id = $1
         LIMIT 1`,
        [customerId]
      );
      const customer = result.rows[0];
      if (!customer) throw new UnauthorizedException('Marketplace account is unavailable');
      request.posMarketplaceCustomer = customer;
      return true;
    } catch (error: unknown) {
      if (error instanceof HttpException) throw error;
      // Tabla ausente antes de la migración v0.8.0: no autenticar.
      throw new UnauthorizedException('Marketplace account is unavailable');
    }
  }
}
