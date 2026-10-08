import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength
} from 'class-validator';

export class CreatePlanDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsNumberString()
  price_monthly?: string;

  @IsOptional()
  @IsNumberString()
  price_yearly?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(-1)
  max_users?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(-1)
  max_stores?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  features?: string[];

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

export class UpdatePlanDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsNumberString()
  price_monthly?: string;

  @IsOptional()
  @IsNumberString()
  price_yearly?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(-1)
  max_users?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(-1)
  max_stores?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  features?: string[];

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

export class UpdateSubscriptionDto {
  @IsOptional()
  @IsUUID()
  plan_id?: string;

  @IsOptional()
  @IsIn(['monthly', 'yearly'])
  billing_cycle?: 'monthly' | 'yearly';

  @IsOptional()
  @IsBoolean()
  auto_renew?: boolean;
}

export class ExtendTrialDto {
  @IsDateString()
  trial_end_date!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class SuspendTenantDto {
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;

  @IsOptional()
  @IsDateString()
  end_date?: string;
}

export class RecordPaymentDto {
  @IsNumberString()
  amount!: string;

  @IsOptional()
  @IsDateString()
  payment_date?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  payment_method?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
