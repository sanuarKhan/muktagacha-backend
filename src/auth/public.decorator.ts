import { SetMetadata } from '@nestjs/common';

/**
 * Marks a route as publicly accessible even when its controller is covered
 * by JwtAuthGuard.
 *
 * Needed because guards in Nest apply to the whole controller: without an
 * opt-out, making one route public would mean dropping the guard from every
 * sibling route too.
 */
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
