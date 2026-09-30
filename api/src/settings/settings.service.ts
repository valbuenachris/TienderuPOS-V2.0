import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { SupabaseService } from '../database/supabase.service';

@Injectable()
export class SettingsService {
  constructor(private readonly supabase: SupabaseService) {}

  async getGlobalForTenant(tenantId: string) {
    const tenantUser = await this.supabase.client.from('tec_users')
      .select('id').eq('tenant_id', tenantId).limit(1).maybeSingle();
    if (tenantUser.error) throw new InternalServerErrorException('Could not verify settings tenant');
    if (!tenantUser.data) return null;

    const settings = await this.supabase.client.from('tec_settings')
      .select('site_name, currency_prefix, default_customer')
      .order('setting_id')
      .limit(1)
      .maybeSingle();
    if (settings.error) throw new InternalServerErrorException('Could not load global POS settings');
    return settings.data;
  }
}
