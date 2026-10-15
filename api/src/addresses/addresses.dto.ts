import { IsBoolean, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export const ADDRESS_LABELS = ['Casa', 'Trabajo', 'Otro'] as const;
export type AddressLabel = (typeof ADDRESS_LABELS)[number];

export class CreateAddressDto {
  @IsString()
  @IsIn(['Casa', 'Trabajo', 'Otro'])
  label!: AddressLabel;

  @IsString()
  @MinLength(5)
  @MaxLength(300)
  street_address!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  neighborhood?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  additional_notes?: string;

  @IsOptional()
  @IsBoolean()
  is_default?: boolean;
}

export class UpdateAddressDto {
  @IsOptional()
  @IsString()
  @IsIn(['Casa', 'Trabajo', 'Otro'])
  label?: AddressLabel;

  @IsOptional()
  @IsString()
  @MinLength(5)
  @MaxLength(300)
  street_address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  neighborhood?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  additional_notes?: string;

  // Solo se admite true: para quitar el estado predeterminado se marca otra dirección.
  @IsOptional()
  @IsBoolean()
  is_default?: boolean;
}
