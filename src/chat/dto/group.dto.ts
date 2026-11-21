import { IsString, IsNotEmpty, IsOptional, IsBoolean, MaxLength, IsIn, ValidateIf } from 'class-validator';

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

  @IsOptional()
  @IsBoolean()
  isPrivate?: boolean;
}

export class UpdateGroupDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsBoolean()
  isPrivate?: boolean;
}

export class JoinGroupDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  invite?: string;
}

export class CreateTopicDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  name!: string;

  @IsOptional()
  @IsBoolean()
  ownerPostsOnly?: boolean;
}

export class UpdateTopicDto {
  @IsOptional()
  @IsBoolean()
  ownerPostsOnly?: boolean;
}

export class CreatePostDto {
  @IsString()
  @MaxLength(4000)
  body!: string;

  @IsOptional()
  @IsBoolean()
  isAnonymous?: boolean;

  @IsOptional()
  @IsIn(['IMAGE', 'PDF'])
  attachmentKind?: 'IMAGE' | 'PDF';

  @ValidateIf((o) => !!o.attachmentKind)
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  attachmentRef?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  attachmentName?: string;
}
