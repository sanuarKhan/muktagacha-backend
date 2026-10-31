import { IsString, IsNotEmpty, IsOptional, MaxLength } from 'class-validator';

export class CreateGroupDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  area?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  ward?: string;
}

export class CreateTopicDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  name!: string;
}

export class CreatePostDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  body!: string;
}
