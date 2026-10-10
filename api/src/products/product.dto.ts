import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

const MONEY_PATTERN = /^\d{1,10}(?:\.\d{1,2})?$/;
const TAX_PATTERN = /^\d{1,3}(?:\.\d{1,2})?$/;
// UUID (migración v0.3.52) o id numérico (tablas creadas con serial).
const CATEGORY_ID_PATTERN = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\d{1,10})$/i;

export class CreateProductDto {
  @IsString()
  @MaxLength(50)
  code!: string;

  @IsString()
  @MaxLength(55)
  name!: string;

  @IsString()
  @Matches(MONEY_PATTERN)
  price!: string;

  @IsOptional()
  @IsString()
  @Matches(MONEY_PATTERN)
  cost?: string;

  @IsOptional()
  @IsString()
  @Matches(TAX_PATTERN)
  tax?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(2147483647)
  reward_points?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2147483647)
  store_id?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(2147483647)
  quantity?: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  details?: string;

  @IsOptional()
  @IsString()
  @Matches(CATEGORY_ID_PATTERN)
  category_id?: string | null;
}

export class UpdateProductDto {
  @IsOptional()
  @IsString()
  @MaxLength(50)
  code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(55)
  name?: string;

  @IsOptional()
  @IsString()
  @Matches(MONEY_PATTERN)
  price?: string;

  @IsOptional()
  @IsString()
  @Matches(MONEY_PATTERN)
  cost?: string;

  @IsOptional()
  @IsString()
  @Matches(TAX_PATTERN)
  tax?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(2147483647)
  reward_points?: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  details?: string;

  @IsOptional()
  @IsString()
  @Matches(CATEGORY_ID_PATTERN)
  category_id?: string | null;
}

export class SetStockDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2147483647)
  store_id!: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(2147483647)
  quantity!: number;
}
