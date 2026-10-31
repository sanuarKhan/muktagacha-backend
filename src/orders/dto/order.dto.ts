import {
  IsString,
  IsIn,
  IsArray,
  ValidateNested,
  IsNumber,
  IsInt,
  Min,
  IsOptional,
  IsBoolean,
} from 'class-validator';
import { Type } from 'class-transformer';

class OrderItemDto {
  @IsString()
  productId: string;

  @IsOptional()
  @IsString()
  variantId?: string;

  @IsInt()
  @Min(1)
  quantity: number;
}

export class CreateOrderDto {
  @IsString()
  organizationId: string;

  @IsIn(['CASH_ON_DELIVERY', 'BKASH', 'NAGAD', 'SKODEPAY'])
  paymentMethod: 'CASH_ON_DELIVERY' | 'BKASH' | 'NAGAD' | 'SKODEPAY';

  @IsOptional()
  @IsNumber()
  deliveryLatitude?: number;

  @IsOptional()
  @IsNumber()
  deliveryLongitude?: number;

  @IsOptional()
  @IsString()
  deliveryAddressText?: string;

  // Gift order fields - all optional, a normal self-purchase sets none of
  // these. When isGift is true, recipientId is required (checked in the
  // service, not here, since it needs a DB lookup to validate the user
  // exists and isn't the buyer themselves).
  @IsOptional()
  @IsBoolean()
  isGift?: boolean;

  @IsOptional()
  @IsString()
  recipientId?: string;

  @IsOptional()
  @IsString()
  giftMessage?: string;

  @IsOptional()
  @IsBoolean()
  giftSenderAnonymous?: boolean;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  items: OrderItemDto[];
}

export class UpdateOrderStatusDto {
  @IsIn(['PENDING', 'CONFIRMED', 'OUT_FOR_DELIVERY', 'COMPLETED', 'CANCELLED'])
  status: 'PENDING' | 'CONFIRMED' | 'OUT_FOR_DELIVERY' | 'COMPLETED' | 'CANCELLED';
}

// Buyer submits this after paying the vendor's bKash/Nagad number
// directly (outside the platform) - see v3 plan Section 6, Path A.
export class SubmitPaymentProofDto {
  @IsString()
  trxId: string;
}

// Vendor/admin confirms or rejects the buyer's submitted TrxID after
// checking it against their own bKash/Nagad account statement.
export class VerifyPaymentDto {
  @IsIn(['VERIFIED', 'REJECTED'])
  verification: 'VERIFIED' | 'REJECTED';
}
