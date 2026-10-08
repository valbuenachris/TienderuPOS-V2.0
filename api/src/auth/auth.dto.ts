import { IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  identity!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(1024)
  password!: string;
}

export class SwitchTenantDto {
  @IsUUID()
  tenant_id!: string;
}
