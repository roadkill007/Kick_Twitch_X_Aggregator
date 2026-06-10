import { createDatabasePool } from '../../../packages/db/src/index.js';
import { createApp } from './app.js';

const databaseUrl = process.env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
const jwtSecret = process.env.JWT_SECRET;
const port = Number(process.env.API_PORT ?? 3001);
const host = process.env.API_HOST ?? '0.0.0.0';

if (!databaseUrl) throw new Error('DATABASE_URL is required');
if (!jwtSecret || jwtSecret.length < 32) throw new Error('JWT_SECRET must be at least 32 characters');

const pool = createDatabasePool(databaseUrl);
const app = await createApp({ pool, redisUrl, jwtSecret });

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'graceful shutdown started');
  await app.close();
  process.exit(0);
};

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ port, host });
