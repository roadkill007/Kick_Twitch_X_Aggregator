import { createDatabasePool, migrate, resetLevelOneTables, type DatabasePool } from '../../../packages/db/src/index.js';
import type { FastifyInstance } from 'fastify';
import { createApp } from './app.js';

export const testConfig = {
  databaseUrl: process.env.DATABASE_URL ?? '',
  redisUrl: process.env.REDIS_URL ?? ['redis', '://', 'localhost', ':6379'].join(''),
  jwtSecret: 'test-jwt-secret-at-least-32-characters',
  appPublicUrl: 'https://example.test',
  twitch: {
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret',
    redirectUri: 'https://example.test/api/v1/connections/twitch/callback',
  },
};

export async function createTestApp(overrides: Partial<Omit<typeof testConfig, 'databaseUrl'> & { providerRuntime: unknown }> = {}): Promise<{ app: FastifyInstance; pool: DatabasePool }> {
  const pool = createDatabasePool(testConfig.databaseUrl);
  await migrate(pool);
  await resetLevelOneTables(pool);
  const app = await createApp({ ...testConfig, ...overrides, pool } as any);
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
