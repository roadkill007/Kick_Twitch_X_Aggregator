import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_HOST: z.string().min(1).default('0.0.0.0'),
  API_PORT: z.coerce.number().int().positive().max(65535).default(3001),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  CORS_ORIGIN: z.string().min(1).default('http://localhost:3000'),
});

export type Environment = z.infer<typeof envSchema>;

export interface AppConfig {
  nodeEnv: Environment['NODE_ENV'];
  apiHost: string;
  apiPort: number;
  databaseUrl: string;
  redisUrl: string;
  jwtSecret: string;
  logLevel: Environment['LOG_LEVEL'];
  corsOrigin: string;
}

export function parseEnv(env: Record<string, string | undefined>): AppConfig {
  const parsed = envSchema.safeParse(env);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment: ${details}`);
  }

  return {
    nodeEnv: parsed.data.NODE_ENV,
    apiHost: parsed.data.API_HOST,
    apiPort: parsed.data.API_PORT,
    databaseUrl: parsed.data.DATABASE_URL,
    redisUrl: parsed.data.REDIS_URL,
    jwtSecret: parsed.data.JWT_SECRET,
    logLevel: parsed.data.LOG_LEVEL,
    corsOrigin: parsed.data.CORS_ORIGIN,
  };
}

export function getDefaultConfig(): AppConfig {
  return parseEnv(process.env);
}
