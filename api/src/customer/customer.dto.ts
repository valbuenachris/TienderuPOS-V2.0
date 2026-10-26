import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsEmail, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { DECIMAL_PATTERN, SaleLineDto } from '../sales/sale.dto';

export type CustomerPaymentMethod = 'cash' | 'bold' | 'addi' | 'sistecredito';

export class CustomerComboLineDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2147483647)
  combo_id!: number;

  @IsString()
  @Matches(DECIMAL_PATTERN)
  quantity!: string;
}

export class CustomerCheckoutDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2147483647)
  store_id?: number;

  // Opcional: un pedido puede ser solo de combos (sin items sueltos).
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => SaleLineDto)
  items?: SaleLineDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => CustomerComboLineDto)
  combos?: CustomerComboLineDto[];
}

export class CustomerCheckoutWithPaymentDto extends CustomerCheckoutDto {
  @IsString()
  @IsIn(['cash', 'bold', 'addi', 'sistecredito'])
  payment_method!: CustomerPaymentMethod;
}

export class UpdateCustomerProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(100)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  // Documento para pagos con Addi en producción (v0.12.5): Addi solo acepta CC.
  @IsOptional()
  @IsString()
  @IsIn(['CC'])
  document_type?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{5,15}$/)
  document_number?: string;
}

export class RedeemProductDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2147483647)
  product_id!: number;
}
