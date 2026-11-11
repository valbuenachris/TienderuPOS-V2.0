import { IsString, Length, Matches, MaxLength, MinLength } from 'class-validator';

export class RequestOtpDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  identity!: string;
}

export class VerifyOtpDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  identity!: string;

  @IsString()
  @Length(6, 6)
  @Matches(/^\d{6}$/)
  code!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(72)
  new_password!: string;
}