import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { DatabaseService } from './database/database.service';
import { SupabaseService } from './database/supabase.service';

@Controller('health')
export class HealthController {
  constructor(private readonly database: DatabaseService, private readonly supabase: SupabaseService) {}

  @Get()
  async health(): Promise<{ status: string }> {
    await this.database.query('SELECT 1');
    const result = await this.supabase.client.from('tec_settings').select('setting_id').limit(1);
    if (result.error) throw new ServiceUnavailableException('Supabase data API is unavailable');
    return { status: 'ok' };
  }
}
