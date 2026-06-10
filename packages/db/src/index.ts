import { access, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Pool } = pg;

export const LEVEL_ONE_TABLES = [
  'users',
  'profiles',
  'shared_sessions',
  'collaborators',
  'connections',
  'settings',
  'sessions',
  'logs',
  'audit_logs',
] as const;

export type LevelOneTable = (typeof LEVEL_ONE_TABLES)[number];
export type DatabasePool = pg.Pool;

export function createDatabasePool(connectionString: string): DatabasePool {
  return new Pool({ connectionString, max: 10 });
}

async function resolveMigrationPath(migration: string): Promise<string> {
  const candidates = [
    join(dirname(fileURLToPath(import.meta.url)), 'migrations', migration),
    join(process.cwd(), 'packages/db/src/migrations', migration),
    join(process.cwd(), '../../packages/db/src/migrations', migration),
  ];

  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next candidate. Build output does not copy SQL files by default.
    }
  }

  throw new Error(`Migration file not found: ${migration}`);
}

export async function migrate(pool: DatabasePool): Promise<void> {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);

  const migrations = ['001_level_1_foundation.sql'];

  for (const migration of migrations) {
    const alreadyApplied = await pool.query('SELECT id FROM schema_migrations WHERE id = $1', [migration]);
    if (alreadyApplied.rowCount) continue;

    const sql = await readFile(await resolveMigrationPath(migration), 'utf8');
    await pool.query('BEGIN');
    try {
      await pool.query(sql);
      await pool.query('INSERT INTO schema_migrations(id) VALUES ($1)', [migration]);
      await pool.query('COMMIT');
    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }
  }
}

export async function listExistingTables(pool: DatabasePool): Promise<string[]> {
  const result = await pool.query<{ table_name: string }>(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = 'public'
     ORDER BY table_name`,
  );
  return result.rows.map((row) => row.table_name);
}

export async function resetLevelOneTables(pool: DatabasePool): Promise<void> {
  await pool.query(
    `TRUNCATE TABLE
      audit_logs,
      logs,
      sessions,
      settings,
      connections,
      collaborators,
      shared_sessions,
      profiles,
      users
    RESTART IDENTITY CASCADE`,
  );
}
