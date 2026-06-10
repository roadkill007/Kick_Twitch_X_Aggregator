import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import type { FastifyInstance } from 'fastify';
import { createTestApp, registerUser } from './test-utils.js';

let app: FastifyInstance;
const runtime = {
  startKick: vi.fn(),
  startTwitch: vi.fn(),
  startX: vi.fn(),
  stop: vi.fn(),
  status: vi.fn(),
  subscribeToSession: vi.fn(),
};

beforeEach(async () => {
  vi.resetAllMocks();
  ({ app } = await createTestApp({ providerRuntime: runtime as any }));
});

afterEach(async () => {
  await app.close();
});

describe('OBS browser-source overlay access', () => {
  it('creates an overlay token for session managers and rejects non-collaborators', async () => {
    const owner = await registerUser(app, 'overlay-owner');
    const outsider = await registerUser(app, 'overlay-outsider');
    const created = await app.inject({ method: 'POST', url: '/api/v1/shared-sessions', headers: { authorization: `Bearer ${owner.token}` }, payload: { name: 'Overlay Session' } });
    const sessionId = created.json().sharedSession.id;

    const tokenResponse = await app.inject({ method: 'POST', url: `/api/v1/shared-sessions/${sessionId}/overlay-token`, headers: { authorization: `Bearer ${owner.token}` } });
    expect(tokenResponse.statusCode).toBe(200);
    expect(tokenResponse.json().token).toEqual(expect.any(String));
    expect(tokenResponse.json().overlayUrl).toContain(`/overlay/${sessionId}?token=`);

    const forbidden = await app.inject({ method: 'POST', url: `/api/v1/shared-sessions/${sessionId}/overlay-token`, headers: { authorization: `Bearer ${outsider.token}` } });
    expect(forbidden.statusCode).toBe(403);
  });

  it('allows overlay WebSocket subscriptions only with a valid overlay token and forwards session messages', async () => {
    let overlayCallback: ((message: unknown) => void) | null = null;
    runtime.subscribeToSession.mockImplementation((_sessionId: string, callback: (message: unknown) => void) => {
      overlayCallback = callback;
      return () => { overlayCallback = null; };
    });
    const owner = await registerUser(app, 'overlay-ws-owner');
    const created = await app.inject({ method: 'POST', url: '/api/v1/shared-sessions', headers: { authorization: `Bearer ${owner.token}` }, payload: { name: 'Overlay WS Session' } });
    const sessionId = created.json().sharedSession.id;
    const tokenResponse = await app.inject({ method: 'POST', url: `/api/v1/shared-sessions/${sessionId}/overlay-token`, headers: { authorization: `Bearer ${owner.token}` } });
    const token = tokenResponse.json().token;

    await app.listen({ port: 0, host: '127.0.0.1' });
    const address = app.server.address();
    if (!address || typeof address === 'string') throw new Error('missing server address');

    const message = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${address.port}/api/v1/overlay/ws?sessionId=${sessionId}&token=${token}`);
      ws.on('message', (data) => {
        const parsed = JSON.parse(data.toString()) as Record<string, unknown>;
        if (parsed.type === 'subscribed') {
          overlayCallback?.({ id: 'm1', sessionId, platform: 'kick', ownerName: 'Host', username: 'viewer', message: 'hello overlay', timestamp: new Date().toISOString() });
        }
        if (parsed.type === 'chat_message') {
          ws.close();
          resolve(parsed);
        }
      });
      ws.on('error', reject);
      setTimeout(() => reject(new Error('overlay websocket timeout')), 3000);
    });

    expect(message).toMatchObject({ type: 'chat_message', message: { platform: 'kick', message: 'hello overlay' } });
  });
});
