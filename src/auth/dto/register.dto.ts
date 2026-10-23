import { IsString, MinLength, IsOptional, IsIn } from 'class-validator';

export class RegisterDto {
  @IsString()
  phone: string;

  @IsString()
  @MinLength(6)
  password: string;

  @IsString()
  fullName: string;

  @IsOptional()
  @IsIn(['BUYER', 'VENDOR', 'PROVIDER'])
  role?: 'BUYER' | 'VENDOR' | 'PROVIDER';

  @IsOptional()
  @IsString()
  area?: string;

  @IsOptional()
  @IsString()
  ward?: string;
}
