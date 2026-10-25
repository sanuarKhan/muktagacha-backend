import {
  IsString,
  IsOptional,
  IsNumber,
  IsBoolean,
  IsArray,
  ValidateNested,
  IsObject,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ProductImageDto {
  @IsString()
  url!: string;
}

export class ProductVariantDto {
  // Present only when editing an existing variant; absent when the
  // vendor is adding a brand-new variant during an edit.
  @IsOptional()
  @IsString()
  id?: string;

  @IsOptional()
  @IsString()
  sku?: string;

  // e.g. { "size": "L", "color": "Red" } - flexible per vertical
  @IsObject()
  optionValues!: Record<string, string>;

  @IsOptional()
  @IsNumber()
  priceOverride?: number;

  @IsNumber()
  stockCount!: number;
}

export class CreateProductDto {
  @IsString()
  organizationId!: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsNumber()
  basePrice!: number;

  @IsOptional()
  @IsBoolean()
  hasVariants?: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductImageDto)
  images?: ProductImageDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductVariantDto)
  variants?: ProductVariantDto[];
}

export class UpdateProductDto {
  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsNumber()
  basePrice?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsBoolean()
  hasVariants?: boolean;

  // When provided, REPLACES every existing image for this product -
  // simplest correct semantics for an edit form that shows "here are
  // your current photos, add/remove, save" rather than a diff/patch API.
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductImageDto)
  images?: ProductImageDto[];

  // Same replace-all semantics as images - the edit form shows the
  // current variant list and the vendor edits it directly.
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductVariantDto)
  variants?: ProductVariantDto[];
}
