import { createDatabasePool, migrate, resetLevelOneTables, type DatabasePool } from '../../../packages/db/src/index.js';
import type { FastifyInstance } from 'fastify';
import { createApp } from './app.js';

export const testConfig = {
  databaseUrl: process.env.DATABASE_URL ?? '',
  redisUrl: process.env.REDIS_URL ?? 'redis://127.0.0.1:6379',
  jwtSecret: 'x'.repeat(64),
};

export async function createTestApp(): Promise<{ app: FastifyInstance; pool: DatabasePool }> {
  if (!testConfig.databaseUrl) {
    throw new Error('DATABASE_URL is required for API tests');
  }

  const pool = createDatabasePool(testConfig.databaseUrl);
  await migrate(pool);
  await resetLevelOneTables(pool);
  const app = await createApp({ pool, redisUrl: testConfig.redisUrl, jwtSecret: testConfig.jwtSecret });
  return { app, pool };
}

export async function registerUser(app: FastifyInstance, suffix: string) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: {
      email: `user-${suffix}@example.com`,
      password: 'passphrase123',
      displayName: `User ${suffix}`,
      handle: `user_${suffix}`,
    },
  });

  if (response.statusCode !== 201) {
    throw new Error(`register failed: ${response.statusCode} ${response.body}`);
  }

  return response.json() as {
    token: string;
    user: { id: string; email: string };
    profile: { id: string };
  };
}
