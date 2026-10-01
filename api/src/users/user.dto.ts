import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength
} from 'class-validator';

const USERNAME_PATTERN = /^[A-Za-z0-9]{3,20}$/;
const PASSWORD_PATTERN = /^(?=.*[A-Z])(?=.*\d).{8,72}$/;

export class CreateUserDto {
  @IsString()
  @Matches(USERNAME_PATTERN, { message: 'Usuario: 3-20 caracteres alfanuméricos' })
  username!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(55)
  first_name!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(55)
  last_name!: string;

  @IsEmail()
  @MaxLength(100)
  email!: string;

  @IsString()
  @Matches(PASSWORD_PATTERN, { message: 'La contraseña debe tener 8+ caracteres, una mayúscula y un número' })
  password!: string;

  @IsIn(['admin', 'staff'])
  role!: 'admin' | 'staff';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2147483647)
  store_id?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @Matches(USERNAME_PATTERN, { message: 'Usuario: 3-20 caracteres alfanuméricos' })
  username?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(55)
  first_name?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(55)
  last_name?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(100)
  email?: string;

  @IsOptional()
  @IsString()
  @Matches(PASSWORD_PATTERN, { message: 'La contraseña debe tener 8+ caracteres, una mayúscula y un número' })
  password?: string;

  @IsOptional()
  @IsIn(['admin', 'staff'])
  role?: 'admin' | 'staff';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2147483647)
  store_id?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class SetUserActiveDto {
  @IsBoolean()
  active!: boolean;
}
