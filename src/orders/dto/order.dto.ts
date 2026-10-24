import {
  IsString,
  IsIn,
  IsArray,
  ValidateNested,
  IsNumber,
  IsInt,
  Min,
  IsOptional,
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

  @IsNumber()
  price: number;
}

export class CreateOrderDto {
  @IsString()
  organizationId: string;

  @IsIn(['CASH_ON_DELIVERY', 'BKASH', 'NAGAD'])
  paymentMethod: 'CASH_ON_DELIVERY' | 'BKASH' | 'NAGAD';

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
