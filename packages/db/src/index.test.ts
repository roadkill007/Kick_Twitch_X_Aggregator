import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabasePool, LEVEL_ONE_TABLES, listExistingTables, migrate, resetLevelOneTables } from './index.js';

const databaseUrl = process.env.DATABASE_URL ?? 'postgresql://sca:sca_dev_password@localhost:5432/stream_chat_aggregator';
const pool = createDatabasePool(databaseUrl);

describe('database migrations', () => {
  beforeAll(async () => {
    await migrate(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('creates every Level 1 foundation table', async () => {
    const existingTables = await listExistingTables(pool);

    for (const table of LEVEL_ONE_TABLES) {
      expect(existingTables).toContain(table);
    }
  });

  it('supports resetting Level 1 domain tables for isolated tests', async () => {
    await resetLevelOneTables(pool);
    const result = await pool.query('SELECT count(*)::int AS count FROM users');

    expect(result.rows[0].count).toBe(0);
  });
});
