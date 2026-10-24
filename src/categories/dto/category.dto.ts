import { IsString, IsOptional, IsIn, IsInt } from 'class-validator';

export class CreateCategoryDto {
  @IsString()
  name!: string;

  @IsIn(['MARKETPLACE', 'PHARMACY', 'SERVICES'])
  vertical!: 'MARKETPLACE' | 'PHARMACY' | 'SERVICES';

  @IsOptional()
  @IsString()
  parentId?: string;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}

export class UpdateCategoryDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  parentId?: string;

  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @IsOptional()
  isActive?: boolean;
}
