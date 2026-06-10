import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { DatabasePool } from '../../../packages/db/src/index.js';
import { createTestApp, registerUser } from './test-utils.js';

let app: FastifyInstance;
let pool: DatabasePool;

beforeEach(async () => {
  ({ app, pool } = await createTestApp());
});

afterEach(async () => {
  await app.close();
});

describe('authentication', () => {
  it('registers a user, creates a profile, returns a JWT, and hides password hashes', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: 'creator@example.com', password: 'passphrase123', displayName: 'Creator', handle: 'creator' },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.token).toEqual(expect.any(String));
    expect(body.user.email).toBe('creator@example.com');
    expect(JSON.stringify(body)).not.toContain('password_hash');

    const audit = await pool.query("SELECT action FROM audit_logs WHERE action = 'auth.register'");
    expect(audit.rowCount).toBe(1);
  });

  it('logs in and accesses /auth/me with a valid bearer token', async () => {
    await registerUser(app, 'login');

    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'user-login@example.com', password: 'passphrase123' } });
    expect(login.statusCode).toBe(200);
    const token = login.json().token;

    const me = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { authorization: `Bearer ${token}` } });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.email).toBe('user-login@example.com');
  });

  it('rejects protected routes without a token', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/auth/me' });
    expect(response.statusCode).toBe(401);
  });

  it('revokes sessions on logout', async () => {
    const user = await registerUser(app, 'logout');
    const logout = await app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: { authorization: `Bearer ${user.token}` } });
    expect(logout.statusCode).toBe(200);

    const me = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { authorization: `Bearer ${user.token}` } });
    expect(me.statusCode).toBe(401);
  });
});
