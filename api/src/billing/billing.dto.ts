import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export const BILLING_PAYMENT_METHODS = ['cash', 'CC', 'Transferencia', 'Sistecredito', 'ADI', 'credito'];

export class RequestPaymentDto {
  @IsString()
  @MinLength(3)
  @MaxLength(160)
  invoice_id!: string;

  @IsIn(BILLING_PAYMENT_METHODS)
  payment_method!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
