import { Global, Module } from '@nestjs/common';
import { TenantTimezoneService } from '../common/tenant-timezone.service';
import { DatabaseService } from './database.service';
import { SupabaseService } from './supabase.service';

@Global()
@Module({
  providers: [DatabaseService, SupabaseService, TenantTimezoneService],
  exports: [DatabaseService, SupabaseService, TenantTimezoneService]
})
export class DatabaseModule {}
