import { IsString, IsOptional, IsArray, ValidateNested, MinLength, ArrayMinSize } from 'class-validator';
import { Type } from 'class-transformer';

export class ContactDto {
  @IsString()
  phone!: string;

  @IsOptional()
  @IsString()
  name?: string;
}

export class AddContactsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ContactDto)
  contacts!: ContactDto[];
}

export class CreateCampaignDto {
  @IsString()
  @MinLength(1)
  message!: string;
}
