import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { FastifyInstance } from 'fastify';
import { createTestApp, registerUser } from './test-utils.js';

let app: FastifyInstance;

beforeEach(async () => {
  ({ app } = await createTestApp());
});

afterEach(async () => {
  await app.close();
});

describe('infrastructure endpoints', () => {
  it('serves liveness, readiness, metrics, and security headers', async () => {
    const live = await app.inject({ method: 'GET', url: '/health/live' });
    expect(live.statusCode).toBe(200);
    expect(live.json().status).toBe('ok');
    expect(live.headers['x-content-type-options']).toBe('nosniff');
    expect(live.headers['x-frame-options']).toBe('SAMEORIGIN');

    const ready = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(ready.statusCode).toBe(200);
    expect(ready.json().dependencies).toMatchObject({ postgres: 'ok', redis: 'ok' });

    const metrics = await app.inject({ method: 'GET', url: '/metrics' });
    expect(metrics.statusCode).toBe(200);
    expect(metrics.body).toContain('sca_users_total');
  });

  it('accepts authenticated WebSocket subscriptions for collaborators only', async () => {
    const owner = await registerUser(app, 'ws-owner');
    const created = await app.inject({ method: 'POST', url: '/api/v1/shared-sessions', headers: { authorization: `Bearer ${owner.token}` }, payload: { name: 'WS Session' } });
    const sessionId = created.json().sharedSession.id;

    await app.listen({ port: 0, host: '127.0.0.1' });
    const address = app.server.address();
    if (!address || typeof address === 'string') throw new Error('missing server address');

    const message = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${address.port}/api/v1/ws?token=${owner.token}`);
      ws.on('open', () => ws.send(JSON.stringify({ type: 'subscribe', sessionId })));
      ws.on('message', (data) => {
        ws.close();
        resolve(JSON.parse(data.toString()) as Record<string, unknown>);
      });
      ws.on('error', reject);
      setTimeout(() => reject(new Error('websocket timeout')), 3000);
    });

    expect(message).toMatchObject({ type: 'subscribed', sessionId });
  });
});
