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

describe('profile management', () => {
  it('returns and updates the authenticated user profile', async () => {
    const user = await registerUser(app, 'profile');

    const mine = await app.inject({ method: 'GET', url: '/api/v1/profiles/me', headers: { authorization: `Bearer ${user.token}` } });
    expect(mine.statusCode).toBe(200);

    const updated = await app.inject({
      method: 'PATCH',
      url: `/api/v1/profiles/${mine.json().profile.id}`,
      headers: { authorization: `Bearer ${user.token}` },
      payload: { displayName: 'Updated Creator' },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().profile.display_name).toBe('Updated Creator');
  });

  it('prevents users from updating another user profile', async () => {
    const owner = await registerUser(app, 'owner-profile');
    const outsider = await registerUser(app, 'outsider-profile');
    const ownerProfile = await app.inject({ method: 'GET', url: '/api/v1/profiles/me', headers: { authorization: `Bearer ${owner.token}` } });

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/v1/profiles/${ownerProfile.json().profile.id}`,
      headers: { authorization: `Bearer ${outsider.token}` },
      payload: { displayName: 'Bad Update' },
    });

    expect(response.statusCode).toBe(404);
  });
});
