import { IsString, IsNotEmpty, MaxLength } from 'class-validator';

export class SendMessageDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  body!: string;
}

export class StartConversationDto {
  @IsString()
  @IsNotEmpty()
  organizationId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  body!: string;
}

export class AskQuestionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  body!: string;
}

export class ReplyQuestionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  body!: string;
}

export class SendDirectMessageDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  body!: string;
}

export class StartDirectConversationDto {
  @IsString()
  @IsNotEmpty()
  recipientId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  body!: string;
}
