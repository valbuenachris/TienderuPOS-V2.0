import { IsInt, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class AdjustPointsDto {
  @IsInt()
  amount!: number;

  @IsString()
  @MinLength(2)
  @MaxLength(255)
  reason!: string;
}

export class UpdateDeliveryStatusDto {
  @IsString()
  @MaxLength(20)
  status_delivery!: string;
}

export class CreateBannerDto {
  @IsString()
  @MinLength(4)
  @MaxLength(1000)
  image_url!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  target_url?: string;
}
