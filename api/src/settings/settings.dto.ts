import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min
} from 'class-validator';

export class UpdateSettingsDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  site_name?: string | null;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z]{1,3}$/)
  currency_prefix?: string | null;

  @IsOptional()
  default_customer?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  address?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string | null;

  @IsOptional()
  @IsEmail()
  @MaxLength(100)
  email?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  nit?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(8)
  language?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  default_tax?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(4)
  decimal_digits?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  thank_you_message?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  return_policy?: string | null;

  @IsOptional()
  @IsBoolean()
  show_qr_on_ticket?: boolean | null;

  @IsOptional()
  @IsIn(['58mm', '80mm'])
  printer_width?: '58mm' | '80mm' | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  logo_url?: string | null;
}
