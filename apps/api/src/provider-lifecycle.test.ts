import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { DatabasePool } from '../../../packages/db/src/index.js';
import { createTestApp, registerUser } from './test-utils.js';

let app: FastifyInstance;
let pool: DatabasePool;
const runtime = {
  startKick: vi.fn(),
  startTwitch: vi.fn(),
  startX: vi.fn(),
  stop: vi.fn(),
  status: vi.fn(),
};

beforeEach(async () => {
  vi.resetAllMocks();
  ({ app, pool } = await createTestApp({ providerRuntime: runtime as any }));
});

afterEach(async () => {
  await app.close();
});

describe('shared session provider lifecycle routes', () => {
  it('starts a connected Kick provider using the dynamic creator label', async () => {
    runtime.startKick.mockResolvedValueOnce({ sessionId: 'session-id', platform: 'kick', status: 'running' });
    const owner = await registerUser(app, 'kick-provider-owner');
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/shared-sessions',
      headers: { authorization: `Bearer ${owner.token}` },
      payload: { name: 'Kick Session', creatorLabel: 'Real Creator Label' },
    });
    const sessionId = created.json().sharedSession.id;
    await pool.query(
      `INSERT INTO connections(user_id, platform, external_account_id, external_username, status, metadata)
       VALUES ($1, 'kick', '12345', 'penpalofficially', 'connected', $2::jsonb)`,
      [owner.user.id, JSON.stringify({ chatroomId: 12345, slug: 'penpalofficially' })],
    );

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/shared-sessions/${sessionId}/providers/kick/start`,
      headers: { authorization: `Bearer ${owner.token}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().provider).toMatchObject({ platform: 'kick', status: 'running' });
    expect(runtime.startKick).toHaveBeenCalledWith(expect.objectContaining({
      sessionId,
      ownerId: owner.user.id,
      ownerName: 'Real Creator Label',
      chatroomId: 12345,
      externalUsername: 'penpalofficially',
    }));
  });

  it('lets an active collaborator start their own connected provider for the same shared session', async () => {
    runtime.startKick.mockResolvedValueOnce({ sessionId: 'session-id', platform: 'kick', status: 'running' });
    const owner = await registerUser(app, 'provider-perm-owner');
    const member = await registerUser(app, 'provider-perm-member');
    const created = await app.inject({ method: 'POST', url: '/api/v1/shared-sessions', headers: { authorization: `Bearer ${owner.token}` }, payload: { name: 'Provider Permissions' } });
    const sessionId = created.json().sharedSession.id;
    const invite = await app.inject({ method: 'POST', url: `/api/v1/shared-sessions/${sessionId}/invitations`, headers: { authorization: `Bearer ${owner.token}` }, payload: { email: member.user.email, displayLabel: 'Member', role: 'member' } });
    await app.inject({ method: 'POST', url: `/api/v1/invitations/${invite.json().token}/accept`, headers: { authorization: `Bearer ${member.token}` } });
    await pool.query(
      `INSERT INTO connections(user_id, platform, external_account_id, external_username, status, metadata)
       VALUES ($1, 'kick', '67890', 'memberkick', 'connected', $2::jsonb)`,
      [member.user.id, JSON.stringify({ chatroomId: 67890, slug: 'memberkick' })],
    );

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/shared-sessions/${sessionId}/providers/kick/start`,
      headers: { authorization: `Bearer ${member.token}` },
    });

    expect(response.statusCode).toBe(200);
    expect(runtime.startKick).toHaveBeenCalledWith(expect.objectContaining({
      sessionId,
      ownerId: member.user.id,
      ownerName: 'Member',
      chatroomId: 67890,
    }));
  });

  it('starts an X provider from the user supplied broadcast link', async () => {
    runtime.startX.mockResolvedValueOnce({ sessionId: 'session-id', platform: 'x', status: 'running' });
    const owner = await registerUser(app, 'x-provider-owner');
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/shared-sessions',
      headers: { authorization: `Bearer ${owner.token}` },
      payload: { name: 'X Session', creatorLabel: 'X Creator Label' },
    });
    const sessionId = created.json().sharedSession.id;
    await pool.query(
      `INSERT INTO connections(user_id, platform, external_account_id, external_username, status, metadata)
       VALUES ($1, 'x', '1MJgNNyRmEYGL', '1MJgNNyRmEYGL', 'connected', $2::jsonb)`,
      [owner.user.id, JSON.stringify({ broadcastId: '1MJgNNyRmEYGL', broadcastUrl: 'https://x.com/i/broadcasts/1MJgNNyRmEYGL' })],
    );

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/shared-sessions/${sessionId}/providers/x/start`,
      headers: { authorization: `Bearer ${owner.token}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().provider).toMatchObject({ platform: 'x', status: 'running' });
    expect(runtime.startX).toHaveBeenCalledWith(expect.objectContaining({
      sessionId,
      ownerId: owner.user.id,
      ownerName: 'X Creator Label',
      broadcastId: '1MJgNNyRmEYGL',
      broadcastUrl: 'https://x.com/i/broadcasts/1MJgNNyRmEYGL',
    }));
  });

  it('reports provider status for collaborators without exposing connection secrets', async () => {
    runtime.status.mockReturnValueOnce([{ sessionId: 'known', platform: 'kick', status: 'running', ownerId: 'creator-id', ownerName: 'Creator' }]);
    const owner = await registerUser(app, 'provider-status-owner');
    const created = await app.inject({ method: 'POST', url: '/api/v1/shared-sessions', headers: { authorization: `Bearer ${owner.token}` }, payload: { name: 'Provider Status' } });
    const sessionId = created.json().sharedSession.id;

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/shared-sessions/${sessionId}/providers`,
      headers: { authorization: `Bearer ${owner.token}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ providers: [{ sessionId: 'known', platform: 'kick', status: 'running', ownerId: 'creator-id', ownerName: 'Creator' }] });
  });
});
