import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export const AGENT_TONES = ['amable', 'profesional', 'vendedor', 'cercano'];

/** Configuración del agente de ventas (los datos de tienda salen de tec_tenant_settings). */
export class UpdateWhatsappSettingsDto {
  @IsOptional()
  @IsBoolean()
  agent_enabled?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  agent_name?: string;

  @IsOptional()
  @IsString()
  @IsIn(AGENT_TONES)
  agent_tone?: string;
}
