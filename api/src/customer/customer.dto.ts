import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsEmail, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { SaleLineDto } from '../sales/sale.dto';

export type CustomerPaymentMethod = 'cash' | 'bold' | 'addi' | 'sistecredito';

export class CustomerCheckoutDto {
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
  @Type(() => SaleLineDto)
  items!: SaleLineDto[];
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
}
