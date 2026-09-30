import { IsString, MaxLength, MinLength } from 'class-validator';

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
