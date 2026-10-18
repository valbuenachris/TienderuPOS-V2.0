import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min
} from 'class-validator';

export const LEAD_STAGES = ['new', 'contacted', 'qualified', 'proposal', 'won', 'lost'];
export const LEAD_SOURCES = ['whatsapp', 'manual', 'pos'];
export const ACTIVITY_TYPES = ['note', 'call', 'task'];
export const AUTOMATION_TRIGGERS = ['new_lead', 'inactive_customer', 'due_order', 'post_sale'];

export class CreateLeadDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsString()
  @Matches(/^\+?[\d\s-]{7,20}$/, { message: 'phone debe ser un teléfono válido' })
  phone!: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(150)
  email?: string;

  @IsOptional()
  @IsString()
  @IsIn(LEAD_SOURCES)
  source?: string;

  @IsOptional()
  @IsString()
  @IsIn(LEAD_STAGES)
  stage?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  owner_id?: number;

  @IsOptional()
  @IsISO8601()
  next_followup_at?: string;
}

export class UpdateLeadDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(150)
  email?: string;

  @IsOptional()
  @IsString()
  @IsIn(LEAD_STAGES)
  stage?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10000)
  score?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  owner_id?: number;

  @IsOptional()
  @IsBoolean()
  opt_out?: boolean;

  /** ISO o null para limpiar el próximo seguimiento. */
  @IsOptional()
  @IsISO8601()
  next_followup_at?: string | null;
}

export class CreateActivityDto {
  @IsString()
  @IsIn(ACTIVITY_TYPES)
  type!: string;

  @IsString()
  @MaxLength(2000)
  content!: string;

  @IsOptional()
  @IsISO8601()
  due_at?: string;
}

export class SendLeadMessageDto {
  @IsString()
  @MaxLength(2000)
  content!: string;
}

export class TemplateDto {
  @IsString()
  @MaxLength(120)
  name!: string;

  @IsString()
  @MaxLength(1000)
  body!: string;
}

export class AutomationDto {
  @IsString()
  @MaxLength(120)
  name!: string;

  @IsString()
  @IsIn(AUTOMATION_TRIGGERS)
  trigger!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(8760)
  delay_hours!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  template_id?: number;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
