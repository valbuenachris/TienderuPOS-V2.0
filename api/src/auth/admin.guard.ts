import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { PosRequest } from './auth.types';

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<PosRequest>();
    if (request.posUser?.group_name?.toLowerCase() !== 'admin') {
      throw new ForbiddenException('Administrator access required');
    }
    return true;
  }
}
