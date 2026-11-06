import { IsString, Matches, MinLength, Length } from 'class-validator';

// Deliberately permissive.
//
// A strict /^01[3-9]\d{8}$/ was the first instinct, but checking the live
// database showed a real existing account stored as a 10-digit number
// ("0199466666") — a strict rule would permanently lock that user out of
// password reset, which is the exact opposite of this feature's purpose.
// Registration itself does not validate phone format at all, so reset must
// not be stricter than registration. We accept any plausible local mobile
// string and let the lookup decide whether the account exists.
const BD_PHONE_LOOSE = /^0\d{9,10}$/;

export class ForgotPasswordDto {
  @IsString()
  @Matches(BD_PHONE_LOOSE, {
    message: 'Enter the mobile number you registered with (e.g. 01712345678)',
  })
  phone!: string;
}

export class ResetPasswordDto {
  @IsString()
  @Matches(BD_PHONE_LOOSE, {
    message: 'Enter the mobile number you registered with (e.g. 01712345678)',
  })
  phone!: string;

  // Exactly 6 digits — matches the generated code format.
  @IsString()
  @Length(6, 6, { message: 'Reset code must be 6 digits' })
  @Matches(/^\d{6}$/, { message: 'Reset code must be 6 digits' })
  code!: string;

  // Same minimum as registration (MinLength(6)) — no stricter, or users
  // could be unable to re-set the password they already use.
  @IsString()
  @MinLength(6, { message: 'Password must be at least 6 characters' })
  newPassword!: string;
}
