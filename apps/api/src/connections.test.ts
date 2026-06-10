import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { DatabasePool } from '../../../packages/db/src/index.js';
import { createTestApp, registerUser } from './test-utils.js';

let app: FastifyInstance;
let pool: DatabasePool;

beforeEach(async () => {
  ({ app, pool } = await createTestApp());
});

afterEach(async () => {
  vi.restoreAllMocks();
  await app.close();
});

describe('provider connection routes', () => {
  it('starts Twitch OAuth with a persisted state and configured redirect URI', async () => {
    const user = await registerUser(app, 'twitch-start');

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/connections/twitch/start',
      headers: { authorization: `Bearer ${user.token}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    const url = new URL(body.authorizationUrl);
    expect(url.origin + url.pathname).toBe('https://id.twitch.tv/oauth2/authorize');
    expect(url.searchParams.get('client_id')).toBe('test-client-id');
    expect(url.searchParams.get('redirect_uri')).toBe('https://example.test/api/v1/connections/twitch/callback');
    expect(url.searchParams.get('state')).toEqual(expect.any(String));

    const state = await pool.query('SELECT key FROM settings WHERE user_id = $1', [user.user.id]);
    expect(state.rows[0].key).toContain('oauth:twitch:');
  });

  it('handles Twitch OAuth callback and stores the connected Twitch account', async () => {
    const user = await registerUser(app, 'twitch-callback');
    const start = await app.inject({ method: 'GET', url: '/api/v1/connections/twitch/start', headers: { authorization: `Bearer ${user.token}` } });
    const state = new URL(start.json().authorizationUrl).searchParams.get('state');
    expect(state).toEqual(expect.any(String));

    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({
        access_token: 'access-token',
        refresh_token: 'refresh-token',
        expires_in: 3600,
        scope: ['user:read:chat', 'user:bot'],
        token_type: 'bearer',
      }), { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: [{ id: '123', login: 'penpal', display_name: 'Penpal' }],
      }), { status: 200, headers: { 'content-type': 'application/json' } }));

    const callback = await app.inject({ method: 'GET', url: `/api/v1/connections/twitch/callback?code=abc&state=${state}` });
    expect(callback.statusCode).toBe(200);
    expect(callback.body).toContain('Twitch connected');

    const list = await app.inject({ method: 'GET', url: '/api/v1/connections', headers: { authorization: `Bearer ${user.token}` } });
    expect(list.statusCode).toBe(200);
    expect(list.json().connections).toMatchObject([
      { platform: 'twitch', external_account_id: '123', external_username: 'penpal', status: 'connected' },
    ]);
  });

  it('returns a clear Kick error when Kick blocks channel resolution', async () => {
    const user = await registerUser(app, 'kick-resolve');
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('forbidden', { status: 403 }));

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/connections/kick/resolve',
      headers: { authorization: `Bearer ${user.token}` },
      payload: { username: 'penpalofficially' },
    });

    expect(response.statusCode).toBe(502);
    expect(response.json().error).toContain('Kick channel lookup failed: 403');
  });
});
