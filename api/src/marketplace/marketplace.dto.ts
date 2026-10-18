import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested
} from 'class-validator';

export const MARKETPLACE_ADDRESS_LABELS = ['Casa', 'Trabajo', 'Otro'] as const;
export type MarketplaceAddressLabel = (typeof MARKETPLACE_ADDRESS_LABELS)[number];

export class MarketplaceRegisterDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @IsEmail()
  @MaxLength(150)
  email!: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password!: string;
}

export class MarketplaceLoginDto {
  @IsEmail()
  @MaxLength(150)
  email!: string;

  @IsString()
  @MaxLength(72)
  password!: string;
}

export class MarketplaceAccountUpdateDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;
}

export class MarketplaceAddressDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  recipient_name!: string;

  @IsString()
  @IsIn(MARKETPLACE_ADDRESS_LABELS)
  label!: MarketplaceAddressLabel;

  @IsString()
  @MinLength(5)
  @MaxLength(200)
  street_address!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  neighborhood?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  city?: string;

  @IsString()
  @MinLength(7)
  @MaxLength(30)
  phone!: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  additional_notes?: string;

  @IsOptional()
  @IsBoolean()
  is_default?: boolean;
}

export class MarketplaceAddressUpdateDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  recipient_name?: string;

  @IsOptional()
  @IsString()
  @IsIn(MARKETPLACE_ADDRESS_LABELS)
  label?: MarketplaceAddressLabel;

  @IsOptional()
  @IsString()
  @MinLength(5)
  @MaxLength(200)
  street_address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  neighborhood?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  city?: string;

  @IsOptional()
  @IsString()
  @MinLength(7)
  @MaxLength(30)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  additional_notes?: string;
}

export class MarketplaceCheckoutItemDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2147483647)
  product_id!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(999)
  quantity!: number;
}

export class MarketplaceCheckoutDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => MarketplaceCheckoutItemDto)
  items!: MarketplaceCheckoutItemDto[];

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2147483647)
  address_id!: number;
}

export class MarketplaceOrderStatusDto {
  @IsString()
  @IsIn(['preparing', 'shipped', 'delivered'])
  status!: 'preparing' | 'shipped' | 'delivered';

  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}

export class MarketplaceSettingsDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  markup_percent?: number;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  store_display_name?: string;
}

export class MarketplacePayoutMarkDto {
  @IsString()
  @MinLength(36)
  @MaxLength(36)
  tenant_id!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  suborder_ids?: number[];
}
