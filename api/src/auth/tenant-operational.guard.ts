import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { TenantManagementService } from '../tenant-management/tenant-management.service';
import { PosRequest } from './auth.types';

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

@Injectable()
export class TenantOperationalGuard implements CanActivate {
  constructor(private readonly tenantManagement: TenantManagementService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<PosRequest>();
    if (READ_METHODS.has(request.method.toUpperCase())) return true;
    const tenantId = request.tenantId;
    if (!tenantId) return true;
    const state = await this.tenantManagement.operationalState(tenantId);
    if (!state.blocked) return true;
    throw new HttpException(
      {
        error: 'Payment Overdue',
        message: 'Tu suscripción está suspendida. Realiza el pago para reactivar el servicio.',
        subscription_status: state.status
      },
      HttpStatus.PAYMENT_REQUIRED
    );
  }
}
