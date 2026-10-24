import { Global, Module } from '@nestjs/common';
import { SecretCryptoService } from './secret-crypto.service.js';

@Global()
@Module({
  providers: [SecretCryptoService],
  exports: [SecretCryptoService],
})
export class CryptoModule {}
