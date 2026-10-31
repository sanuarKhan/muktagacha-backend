import { IsString, IsNotEmpty, IsOptional, IsNumber, MaxLength, IsIn } from 'class-validator';

export class CreateServiceRequestDto {
  @IsString()
  @IsNotEmpty()
  organizationId!: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  description!: string;

  @IsOptional()
  @IsString()
  photoUrl?: string;

  @IsOptional()
  @IsString()
  addressText?: string;

  @IsOptional()
  @IsNumber()
  latitude?: number;

  @IsOptional()
  @IsNumber()
  longitude?: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  preferredTime?: string;
}

export class QuoteServiceRequestDto {
  @IsNumber()
  quotedPrice!: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  quoteNote?: string;
}

export class UpdateServiceRequestStatusDto {
  @IsIn(['ACCEPTED', 'DECLINED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'])
  status!: 'ACCEPTED' | 'DECLINED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
}

export class SubmitServicePaymentProofDto {
  @IsIn(['CASH_ON_DELIVERY', 'BKASH', 'NAGAD'])
  paymentMethod!: 'CASH_ON_DELIVERY' | 'BKASH' | 'NAGAD';

  @IsOptional()
  @IsString()
  trxId?: string;
}
