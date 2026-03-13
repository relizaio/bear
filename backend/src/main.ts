import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { testConnection } from './utils/pgUtils'

async function bootstrap() {
  require('console-stamp')(console, 'yyyy-mm-dd HH:MM:ss.l')
  
  // Collect all API key hashes from env vars starting with or equal to BEAR_API_KEY_HASH
  const apiKeyHashes = Object.keys(process.env)
    .filter(key => key === 'BEAR_API_KEY_HASH' || key.startsWith('BEAR_API_KEY_HASH_'))
    .map(key => process.env[key])
    .filter(value => value)
  
  if (apiKeyHashes.length === 0) {
    throw Error('At least one BEAR_API_KEY_HASH* environment variable is required')
  }
  
  console.log(`Loaded ${apiKeyHashes.length} API key hash(es)`)
  
  const pgCon = await testConnection()
  if (pgCon) {
    const app = await NestFactory.create(AppModule);
    await app.listen(4002);
  } else {
    throw Error('Failed to start due to missing pg connection')
  }
}
bootstrap();
