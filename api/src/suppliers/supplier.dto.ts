import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateSupplierDto {
  @IsString()
  @MaxLength(55)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  cf1?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  cf2?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  email?: string;
}

export class UpdateSupplierDto {
  @IsOptional()
  @IsString()
  @MaxLength(55)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  cf1?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  cf2?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  email?: string;
}
