import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp, registerUser } from './test-utils.js';

let app: FastifyInstance;

beforeEach(async () => {
  ({ app } = await createTestApp());
});

afterEach(async () => {
  await app.close();
});

describe('Shared Chat Sessions and invitations', () => {
  it('creates a Shared Chat Session and makes the creator the owner collaborator', async () => {
    const owner = await registerUser(app, 'session-owner');

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/shared-sessions',
      headers: { authorization: `Bearer ${owner.token}` },
      payload: { name: 'Podcast Night', creatorLabel: 'Host A' },
    });

    expect(created.statusCode).toBe(201);
    const sessionId = created.json().sharedSession.id;

    const collaborators = await app.inject({
      method: 'GET',
      url: `/api/v1/shared-sessions/${sessionId}/collaborators`,
      headers: { authorization: `Bearer ${owner.token}` },
    });

    expect(collaborators.statusCode).toBe(200);
    expect(collaborators.json().collaborators).toMatchObject([
      { user_id: owner.user.id, display_label: 'Host A', role: 'owner', status: 'active' },
    ]);
  });

  it('isolates sessions from non-collaborators', async () => {
    const owner = await registerUser(app, 'session-isolated-owner');
    const outsider = await registerUser(app, 'session-isolated-outsider');
    const created = await app.inject({ method: 'POST', url: '/api/v1/shared-sessions', headers: { authorization: `Bearer ${owner.token}` }, payload: { name: 'Private Session' } });

    const forbidden = await app.inject({ method: 'GET', url: `/api/v1/shared-sessions/${created.json().sharedSession.id}`, headers: { authorization: `Bearer ${outsider.token}` } });

    expect(forbidden.statusCode).toBe(403);
  });

  it('lets an owner invite a collaborator and the invited user accept', async () => {
    const owner = await registerUser(app, 'invite-owner');
    const invited = await registerUser(app, 'invite-member');
    const created = await app.inject({ method: 'POST', url: '/api/v1/shared-sessions', headers: { authorization: `Bearer ${owner.token}` }, payload: { name: 'Co Stream' } });
    const sessionId = created.json().sharedSession.id;

    const invite = await app.inject({
      method: 'POST',
      url: `/api/v1/shared-sessions/${sessionId}/invitations`,
      headers: { authorization: `Bearer ${owner.token}` },
      payload: { email: invited.user.email, displayLabel: 'Guest B', role: 'member' },
    });

    expect(invite.statusCode).toBe(201);
    expect(invite.json().token).toEqual(expect.any(String));

    const accepted = await app.inject({
      method: 'POST',
      url: `/api/v1/invitations/${invite.json().token}/accept`,
      headers: { authorization: `Bearer ${invited.token}` },
    });

    expect(accepted.statusCode).toBe(200);
    expect(accepted.json().collaborator.status).toBe('active');

    const accessible = await app.inject({ method: 'GET', url: `/api/v1/shared-sessions/${sessionId}`, headers: { authorization: `Bearer ${invited.token}` } });
    expect(accessible.statusCode).toBe(200);
  });

  it('prevents members from inviting additional collaborators', async () => {
    const owner = await registerUser(app, 'perm-owner');
    const member = await registerUser(app, 'perm-member');
    const third = await registerUser(app, 'perm-third');
    const created = await app.inject({ method: 'POST', url: '/api/v1/shared-sessions', headers: { authorization: `Bearer ${owner.token}` }, payload: { name: 'Permission Test' } });
    const sessionId = created.json().sharedSession.id;
    const invite = await app.inject({ method: 'POST', url: `/api/v1/shared-sessions/${sessionId}/invitations`, headers: { authorization: `Bearer ${owner.token}` }, payload: { email: member.user.email, displayLabel: 'Member' } });
    await app.inject({ method: 'POST', url: `/api/v1/invitations/${invite.json().token}/accept`, headers: { authorization: `Bearer ${member.token}` } });

    const forbidden = await app.inject({
      method: 'POST',
      url: `/api/v1/shared-sessions/${sessionId}/invitations`,
      headers: { authorization: `Bearer ${member.token}` },
      payload: { email: third.user.email, displayLabel: 'Third' },
    });

    expect(forbidden.statusCode).toBe(403);
  });
});
