import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  ValidateNested
} from 'class-validator';

const DECIMAL_PATTERN = /^\d{1,13}(?:\.\d{1,2})?$/;

export type SalePaymentMethod = 'cash' | 'CC' | 'Transferencia' | 'Sistecredito' | 'ADI' | 'credito';

const PAID_BY_VALUES: SalePaymentMethod[] = [
  'cash',
  'CC',
  'Transferencia',
  'Sistecredito',
  'ADI',
  'credito'
];

export class SaleLineDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2147483647)
  product_id!: number;

  @IsString()
  @Matches(DECIMAL_PATTERN)
  quantity!: string;
}

export class CreateSaleDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2147483647)
  store_id?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2147483647)
  customer_id?: number;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => SaleLineDto)
  items!: SaleLineDto[];

  @IsOptional()
  @IsString()
  @Matches(DECIMAL_PATTERN)
  paid_amount?: string;

  @IsOptional()
  @IsString()
  @IsIn(PAID_BY_VALUES)
  paid_by?: SalePaymentMethod;
}

export class UpdateSaleLineDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2147483647)
  product_id!: number;

  @IsString()
  @Matches(DECIMAL_PATTERN)
  quantity!: string;
}

export class UpdateSaleDto {
  @IsOptional()
  customer_id?: number | null;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => UpdateSaleLineDto)
  items!: UpdateSaleLineDto[];
}
