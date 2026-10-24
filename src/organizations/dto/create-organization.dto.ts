import { IsString, IsIn, IsOptional, IsNumber } from 'class-validator';

export class CreateOrganizationDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  logoUrl?: string;

  @IsIn(['MARKETPLACE', 'PHARMACY', 'SERVICES'])
  vertical: 'MARKETPLACE' | 'PHARMACY' | 'SERVICES';

  @IsOptional()
  @IsString()
  area?: string;

  @IsOptional()
  @IsString()
  ward?: string;

  @IsOptional()
  @IsNumber()
  deliveryRadiusKm?: number;
}
