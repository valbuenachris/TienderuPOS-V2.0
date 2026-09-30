import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

const MONEY_PATTERN = /^\d{1,10}(?:\.\d{1,2})?$/;

export class OpenRegisterDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2147483647)
  store_id?: number;

  @IsString()
  @Matches(MONEY_PATTERN)
  cash_in_hand!: string;
}

export class CloseRegisterDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;

  @IsOptional()
  @IsString()
  @Matches(MONEY_PATTERN)
  total_cash_submitted?: string;
}
