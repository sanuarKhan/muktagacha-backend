import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  Req,
  UseGuards,
} from '@nestjs/common';
import { IsString, MinLength } from 'class-validator';
import { CloudinaryService } from './cloudinary.service.js';
import { OrganizationsService } from '../organizations/organizations.service.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';

class ConnectCloudinaryDto {
  @IsString()
  @MinLength(1)
  cloudName!: string;

  @IsString()
  @MinLength(1)
  apiKey!: string;

  @IsString()
  @MinLength(1)
  apiSecret!: string;
}

@Controller('organizations/:organizationId/cloudinary')
@UseGuards(JwtAuthGuard)
export class CloudinaryController {
  constructor(
    private cloudinary: CloudinaryService,
    private orgsService: OrganizationsService,
  ) {}

  // Vendor (or admin) connects their own Cloudinary account. The secret
  // is encrypted before it ever touches the database - see
  // SecretCryptoService. Once connected, this org's uploads go to the
  // vendor's own Cloudinary storage/bandwidth, not the shared fallback.
  @Post()
  async connect(
    @Req() req: any,
    @Param('organizationId') organizationId: string,
    @Body() dto: ConnectCloudinaryDto,
  ) {
    await this.orgsService.assertOwnerOrAdmin(
      organizationId,
      req.user.userId,
      req.user.role,
    );
    await this.cloudinary.saveCredentials(
      organizationId,
      dto.cloudName,
      dto.apiKey,
      dto.apiSecret,
    );
    return { connected: true, cloudName: dto.cloudName };
  }

  @Delete()
  async disconnect(
    @Req() req: any,
    @Param('organizationId') organizationId: string,
  ) {
    await this.orgsService.assertOwnerOrAdmin(
      organizationId,
      req.user.userId,
      req.user.role,
    );
    await this.cloudinary.removeCredentials(organizationId);
    return { connected: false };
  }

  // Returns a short-lived signature the browser uses to upload directly
  // to Cloudinary. The API secret itself never leaves the backend.
  @Get('upload-signature')
  async getUploadSignature(
    @Req() req: any,
    @Param('organizationId') organizationId: string,
  ) {
    await this.orgsService.assertOwnerOrAdmin(
      organizationId,
      req.user.userId,
      req.user.role,
    );
    return this.cloudinary.createSignedUpload(organizationId);
  }
}
