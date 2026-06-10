import { describe, expect, it } from 'vitest';
import { parseEnv } from './index.js';

describe('parseEnv', () => {
  const validEnv = {
    NODE_ENV: 'test',
    API_HOST: '127.0.0.1',
    API_PORT: '3001',
    DATABASE_URL: 'postgresql://sca:sca_dev_password@localhost:5432/stream_chat_aggregator',
    REDIS_URL: 'redis://localhost:6379',
    JWT_SECRET: 'a'.repeat(32),
    LOG_LEVEL: 'info',
    CORS_ORIGIN: 'http://localhost:3000',
  };

  it('returns typed configuration for valid environment variables', () => {
    const config = parseEnv(validEnv);

    expect(config.nodeEnv).toBe('test');
    expect(config.apiHost).toBe('127.0.0.1');
    expect(config.apiPort).toBe(3001);
    expect(config.databaseUrl).toContain('postgresql://');
    expect(config.redisUrl).toBe('redis://localhost:6379');
    expect(config.logLevel).toBe('info');
  });

  it('rejects a missing database URL', () => {
    const { DATABASE_URL, ...envWithoutDatabase } = validEnv;

    expect(() => parseEnv(envWithoutDatabase)).toThrow(/DATABASE_URL/);
  });

  it('rejects short JWT secrets', () => {
    expect(() => parseEnv({ ...validEnv, JWT_SECRET: 'too-short' })).toThrow(/JWT_SECRET/);
  });

  it('defaults API host, API port, log level, and CORS origin', () => {
    const { API_HOST, API_PORT, LOG_LEVEL, CORS_ORIGIN, ...minimalEnv } = validEnv;

    const config = parseEnv(minimalEnv);

    expect(config.apiHost).toBe('0.0.0.0');
    expect(config.apiPort).toBe(3001);
    expect(config.logLevel).toBe('info');
    expect(config.corsOrigin).toBe('http://localhost:3000');
  });
});
