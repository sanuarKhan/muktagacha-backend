import { IsString, IsIn, IsOptional, IsNumber, IsBoolean } from 'class-validator';

export class CreateListingDto {
  @IsString()
  organizationId: string;

  @IsIn(['PRODUCT', 'SERVICE', 'MEDICINE'])
  type: 'PRODUCT' | 'SERVICE' | 'MEDICINE';

  @IsString()
  name: string;

  @IsOptional()
  @IsNumber()
  price?: number;

  @IsOptional()
  @IsString()
  category?: string;
}

export class UpdateListingDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsNumber()
  price?: number;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
