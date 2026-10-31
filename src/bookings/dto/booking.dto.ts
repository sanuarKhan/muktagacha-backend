import { IsString, IsNotEmpty, IsOptional, IsNumber, Min, IsBoolean, IsISO8601, IsIn } from 'class-validator';

export class CreateBookingSlotDto {
  @IsString()
  @IsNotEmpty()
  organizationId!: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsString()
  @IsNotEmpty()
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsISO8601()
  startAt!: string;

  @IsISO8601()
  endAt!: string;

  @IsNumber()
  @Min(0)
  price!: number;

  @IsOptional()
  @IsBoolean()
  isOnline?: boolean;

  @IsOptional()
  @IsString()
  location?: string;
}

export class BookSlotDto {
  @IsOptional()
  @IsString()
  note?: string;
}

export class SubmitSlotPaymentProofDto {
  @IsIn(['CASH_ON_DELIVERY', 'BKASH', 'NAGAD', 'WALLET'])
  paymentMethod!: 'CASH_ON_DELIVERY' | 'BKASH' | 'NAGAD' | 'WALLET';

  @IsOptional()
  @IsString()
  trxId?: string;
}
