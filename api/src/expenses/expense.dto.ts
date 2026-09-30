import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

const MONEY_PATTERN = /^\d{1,10}(?:\.\d{1,2})?$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export class CreateExpenseDto {
  @IsString()
  @MaxLength(50)
  reference!: string;

  @IsString()
  @Matches(MONEY_PATTERN)
  amount!: string;

  @IsOptional()
  @IsString()
  @Matches(DATE_PATTERN)
  date?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class UpdateExpenseDto {
  @IsOptional()
  @IsString()
  @MaxLength(50)
  reference?: string;

  @IsOptional()
  @IsString()
  @Matches(MONEY_PATTERN)
  amount?: string;

  @IsOptional()
  @IsString()
  @Matches(DATE_PATTERN)
  date?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}
