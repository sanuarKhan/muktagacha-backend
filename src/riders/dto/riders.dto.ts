import { IsString, IsOptional, IsInt, Min, Max } from 'class-validator';

export class ApplyAsRiderDto {
  @IsOptional()
  @IsString()
  vehicleType?: string;

  @IsOptional()
  @IsString()
  coverageArea?: string;
}

export class AssignRiderDto {
  @IsString()
  riderId!: string;
}

export class MarkDeliveredDto {
  @IsOptional()
  @IsString()
  deliveryNote?: string;
}

export class RateDeliveryDto {
  @IsInt()
  @Min(1)
  @Max(5)
  rating!: number;

  @IsOptional()
  @IsString()
  comment?: string;
}
