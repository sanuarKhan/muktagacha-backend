import { IsNumber, Min, IsIn, IsOptional, IsString } from 'class-validator';

export class RequestTopupDto {
  @IsNumber()
  @Min(10)
  amount!: number;

  @IsIn(['BKASH', 'NAGAD'])
  method!: 'BKASH' | 'NAGAD';

  @IsOptional()
  @IsString()
  trxId?: string;
}
