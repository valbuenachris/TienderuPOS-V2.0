import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested
} from 'class-validator';

const DECIMAL_PATTERN = /^\d{1,13}(?:\.\d{1,2})?$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export class PurchaseItemDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2147483647)
  product_id!: number;

  @IsString()
  @Matches(DECIMAL_PATTERN)
  quantity!: string;

  @IsString()
  @Matches(DECIMAL_PATTERN)
  cost!: string;

  @IsOptional()
  @IsString()
  @Matches(DECIMAL_PATTERN)
  sale_price?: string;
}

export class CreatePurchaseDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2147483647)
  supplier_id?: number;

  @IsOptional()
  @IsString()
  @MaxLength(55)
  reference?: string;

  @IsOptional()
  @IsString()
  @Matches(DATE_PATTERN)
  date?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2147483647)
  store_id?: number;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => PurchaseItemDto)
  items!: PurchaseItemDto[];
}
