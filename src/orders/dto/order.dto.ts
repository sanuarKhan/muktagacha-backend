import {
  IsString,
  IsIn,
  IsArray,
  ValidateNested,
  IsNumber,
  IsInt,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

class OrderItemDto {
  @IsString()
  listingId: string;

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
