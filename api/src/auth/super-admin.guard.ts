import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { PosRequest } from './auth.types';

@Injectable()
export class SuperAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<PosRequest>();
    if (request.posUser?.group_name?.toLowerCase() !== 'super_admin') {
      throw new ForbiddenException('Super administrator access required');
    }
    return true;
  }
}
