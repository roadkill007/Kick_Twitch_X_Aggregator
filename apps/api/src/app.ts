import * as crypto from 'node:crypto';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { createClient } from 'redis';
import { z } from 'zod';
import { migrate } from '../../../packages/db/src/index.js';
import { buildTwitchAuthorizationUrl, exchangeTwitchCode, extractXBroadcastId, getTwitchUser, resolveKickChannel } from '../../../packages/providers/src/index.js';
import { writeAuditLog } from './audit.js';
import { requireSessionAccess, requireSessionManager } from './permissions.js';
import { LiveProviderRuntimeController } from './provider-runtime.js';
import { createOpaqueToken, hashPassword, hashToken, signJwt, verifyJwt, verifyPassword } from './security.js';
import type { AppContext, AuthenticatedUser } from './types.js';

function slugify(value: string): string {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function bearerToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length);
}

async function authenticate(context: AppContext, request: FastifyRequest): Promise<AuthenticatedUser> {
  const token = bearerToken(request);
  if (!token) throw new Error('Unauthorized');
  const user = verifyJwt(token, context.jwtSecret);
  const session = await context.pool.query('SELECT revoked_at FROM sessions WHERE token_jti = $1', [user.jti]);
  if (!session.rowCount || session.rows[0].revoked_at) throw new Error('Unauthorized');
  return user;
}

async function authGuard(context: AppContext, request: FastifyRequest, reply: FastifyReply) {
  try {
    (request as FastifyRequest & { user: AuthenticatedUser }).user = await authenticate(context, request);
  } catch {
    await reply.code(401).send({ error: 'Unauthorized' });
  }
}

function currentUser(request: FastifyRequest): AuthenticatedUser {
  return (request as FastifyRequest & { user: AuthenticatedUser }).user;
}

export async function createApp(context: AppContext): Promise<FastifyInstance> {
  await migrate(context.pool);

  const app = Fastify({ logger: false, genReqId: () => crypto.randomUUID() });
  const providerRuntime = context.providerRuntime ?? new LiveProviderRuntimeController();
  await app.register(cors, { origin: true });
  await app.register(websocket);

  app.get('/health/live', async () => ({ status: 'ok' }));
  app.get('/health/ready', async (_request, reply) => {
    try {
      await context.pool.query('SELECT 1');
      const redis = createClient({ url: context.redisUrl });
      await redis.connect();
      await redis.ping();
      await redis.quit();
      return { status: 'ready', dependencies: { postgres: 'ok', redis: 'ok' } };
    } catch (error) {
      return reply.code(503).send({ status: 'not_ready', error: error instanceof Error ? error.message : 'unknown' });
    }
  });
  app.get('/metrics', async (_request, reply) => {
    const users = await context.pool.query('SELECT count(*)::int AS count FROM users');
    const sharedSessions = await context.pool.query('SELECT count(*)::int AS count FROM shared_sessions');
    reply.type('text/plain');
    return `sca_users_total ${users.rows[0].count}\nsca_shared_sessions_total ${sharedSessions.rows[0].count}\n`;
  });

  const registerSchema = z.object({
    email: z.string().email(),
    password: z.string().min(8),
    displayName: z.string().min(1),
    handle: z.string().min(3).regex(/^[a-zA-Z0-9_-]+$/),
  });

  app.post('/api/v1/auth/register', async (request, reply) => {
    const body = registerSchema.parse(request.body);
    const passwordHash = await hashPassword(body.password);
    const client = await context.pool.connect();
    try {
      await client.query('BEGIN');
      const user = await client.query<{ id: string; email: string }>(
        'INSERT INTO users(email, password_hash) VALUES ($1, $2) RETURNING id, email',
        [body.email.toLowerCase(), passwordHash],
      );
      const createdUser = user.rows[0];
      if (!createdUser) throw new Error('User creation failed');
      const profile = await client.query(
        'INSERT INTO profiles(user_id, display_name, handle) VALUES ($1, $2, $3) RETURNING id, display_name, handle',
        [createdUser.id, body.displayName, body.handle.toLowerCase()],
      );
      const createdProfile = profile.rows[0];
      if (!createdProfile) throw new Error('Profile creation failed');
      const { token, jti } = signJwt({ userId: createdUser.id, email: createdUser.email, jwtSecret: context.jwtSecret });
      await client.query(
        `INSERT INTO sessions(user_id, token_jti, expires_at) VALUES ($1, $2, now() + interval '7 days')`,
        [createdUser.id, jti],
      );
      await client.query('COMMIT');
      await writeAuditLog({ pool: context.pool, actorUserId: createdUser.id, action: 'auth.register', entityType: 'user', entityId: createdUser.id, requestId: request.id });
      return reply.code(201).send({ token, user: { id: createdUser.id, email: createdUser.email }, profile: createdProfile });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });

  app.post('/api/v1/auth/login', async (request, reply) => {
    const body = z.object({ email: z.string().email(), password: z.string().min(1) }).parse(request.body);
    const result = await context.pool.query<{ id: string; email: string; password_hash: string }>('SELECT id, email, password_hash FROM users WHERE email = $1', [body.email.toLowerCase()]);
    const user = result.rows[0];
    if (!user || !(await verifyPassword(body.password, user.password_hash))) return reply.code(401).send({ error: 'Invalid credentials' });
    const { token, jti } = signJwt({ userId: user.id, email: user.email, jwtSecret: context.jwtSecret });
    await context.pool.query(`INSERT INTO sessions(user_id, token_jti, expires_at) VALUES ($1, $2, now() + interval '7 days')`, [user.id, jti]);
    await writeAuditLog({ pool: context.pool, actorUserId: user.id, action: 'auth.login', entityType: 'session', requestId: request.id });
    return { token, user: { id: user.id, email: user.email } };
  });

  app.post('/api/v1/auth/logout', { preHandler: (req, rep) => authGuard(context, req, rep) }, async (request) => {
    const user = currentUser(request);
    await context.pool.query('UPDATE sessions SET revoked_at = now() WHERE token_jti = $1', [user.jti]);
    await writeAuditLog({ pool: context.pool, actorUserId: user.id, action: 'auth.logout', entityType: 'session', requestId: request.id });
    return { ok: true };
  });

  app.get('/api/v1/auth/me', { preHandler: (req, rep) => authGuard(context, req, rep) }, async (request) => {
    const user = currentUser(request);
    const result = await context.pool.query(
      `SELECT u.id, u.email, p.id AS profile_id, p.display_name, p.handle
       FROM users u LEFT JOIN profiles p ON p.user_id = u.id WHERE u.id = $1`,
      [user.id],
    );
    return { user: result.rows[0] };
  });

  app.get('/api/v1/profiles/me', { preHandler: (req, rep) => authGuard(context, req, rep) }, async (request) => {
    const user = currentUser(request);
    const result = await context.pool.query('SELECT id, display_name, handle FROM profiles WHERE user_id = $1', [user.id]);
    return { profile: result.rows[0] };
  });

  app.patch('/api/v1/profiles/:profileId', { preHandler: (req, rep) => authGuard(context, req, rep) }, async (request, reply) => {
    const user = currentUser(request);
    const params = z.object({ profileId: z.string().uuid() }).parse(request.params);
    const body = z.object({ displayName: z.string().min(1).optional(), handle: z.string().min(3).optional() }).parse(request.body);
    const result = await context.pool.query(
      `UPDATE profiles SET display_name = COALESCE($1, display_name), handle = COALESCE($2, handle), updated_at = now()
       WHERE id = $3 AND user_id = $4 RETURNING id, display_name, handle`,
      [body.displayName ?? null, body.handle?.toLowerCase() ?? null, params.profileId, user.id],
    );
    if (!result.rowCount) return reply.code(404).send({ error: 'Profile not found' });
    await writeAuditLog({ pool: context.pool, actorUserId: user.id, action: 'profile.update', entityType: 'profile', entityId: params.profileId, requestId: request.id });
    return { profile: result.rows[0] };
  });

  app.post('/api/v1/shared-sessions', { preHandler: (req, rep) => authGuard(context, req, rep) }, async (request, reply) => {
    const user = currentUser(request);
    const body = z.object({ name: z.string().min(1), description: z.string().optional(), creatorLabel: z.string().min(1).optional() }).parse(request.body);
    const slug = `${slugify(body.name)}-${crypto.randomUUID().slice(0, 8)}`;
    const client = await context.pool.connect();
    try {
      await client.query('BEGIN');
      const session = await client.query<{ id: string; name: string; slug: string }>(
        `INSERT INTO shared_sessions(owner_user_id, name, slug, description) VALUES ($1, $2, $3, $4) RETURNING id, name, slug`,
        [user.id, body.name, slug, body.description ?? null],
      );
      const createdSession = session.rows[0];
      if (!createdSession) throw new Error('Shared session creation failed');
      await client.query(
        `INSERT INTO collaborators(shared_session_id, user_id, display_label, role, status)
         VALUES ($1, $2, $3, 'owner', 'active')`,
        [createdSession.id, user.id, body.creatorLabel ?? body.name],
      );
      await client.query('COMMIT');
      await writeAuditLog({ pool: context.pool, actorUserId: user.id, action: 'shared_session.create', entityType: 'shared_session', entityId: createdSession.id, requestId: request.id });
      return reply.code(201).send({ sharedSession: createdSession });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });

  app.get('/api/v1/shared-sessions', { preHandler: (req, rep) => authGuard(context, req, rep) }, async (request) => {
    const user = currentUser(request);
    const result = await context.pool.query(
      `SELECT ss.id, ss.name, ss.slug, ss.description, c.role
       FROM shared_sessions ss JOIN collaborators c ON c.shared_session_id = ss.id
       WHERE c.user_id = $1 AND c.status = 'active' ORDER BY ss.created_at DESC`,
      [user.id],
    );
    return { sharedSessions: result.rows };
  });

  app.get('/api/v1/shared-sessions/:sessionId', { preHandler: (req, rep) => authGuard(context, req, rep) }, async (request, reply) => {
    const user = currentUser(request);
    const params = z.object({ sessionId: z.string().uuid() }).parse(request.params);
    try { await requireSessionAccess(context.pool, params.sessionId, user.id); } catch { return reply.code(403).send({ error: 'Forbidden' }); }
    const result = await context.pool.query('SELECT id, name, slug, description, is_active FROM shared_sessions WHERE id = $1', [params.sessionId]);
    if (!result.rowCount) return reply.code(404).send({ error: 'Shared session not found' });
    return { sharedSession: result.rows[0] };
  });

  app.patch('/api/v1/shared-sessions/:sessionId', { preHandler: (req, rep) => authGuard(context, req, rep) }, async (request, reply) => {
    const user = currentUser(request);
    const params = z.object({ sessionId: z.string().uuid() }).parse(request.params);
    const body = z.object({ name: z.string().min(1).optional(), description: z.string().nullable().optional(), isActive: z.boolean().optional() }).parse(request.body);
    try { await requireSessionManager(context.pool, params.sessionId, user.id); } catch { return reply.code(403).send({ error: 'Forbidden' }); }
    const result = await context.pool.query(
      `UPDATE shared_sessions SET name = COALESCE($1, name), description = COALESCE($2, description), is_active = COALESCE($3, is_active), updated_at = now()
       WHERE id = $4 RETURNING id, name, slug, description, is_active`,
      [body.name ?? null, body.description ?? null, body.isActive ?? null, params.sessionId],
    );
    await writeAuditLog({ pool: context.pool, actorUserId: user.id, action: 'shared_session.update', entityType: 'shared_session', entityId: params.sessionId, requestId: request.id });
    return { sharedSession: result.rows[0] };
  });

  app.delete('/api/v1/shared-sessions/:sessionId', { preHandler: (req, rep) => authGuard(context, req, rep) }, async (request, reply) => {
    const user = currentUser(request);
    const params = z.object({ sessionId: z.string().uuid() }).parse(request.params);
    try { await requireSessionManager(context.pool, params.sessionId, user.id); } catch { return reply.code(403).send({ error: 'Forbidden' }); }
    await context.pool.query('UPDATE shared_sessions SET is_active = false, updated_at = now() WHERE id = $1', [params.sessionId]);
    await writeAuditLog({ pool: context.pool, actorUserId: user.id, action: 'shared_session.delete', entityType: 'shared_session', entityId: params.sessionId, requestId: request.id });
    return reply.code(204).send();
  });

  app.post('/api/v1/shared-sessions/:sessionId/invitations', { preHandler: (req, rep) => authGuard(context, req, rep) }, async (request, reply) => {
    const user = currentUser(request);
    const params = z.object({ sessionId: z.string().uuid() }).parse(request.params);
    const body = z.object({ email: z.string().email(), displayLabel: z.string().min(1), role: z.enum(['admin', 'member']).default('member') }).parse(request.body);
    try { await requireSessionManager(context.pool, params.sessionId, user.id); } catch { return reply.code(403).send({ error: 'Forbidden' }); }
    const token = createOpaqueToken();
    const result = await context.pool.query(
      `INSERT INTO collaborators(shared_session_id, invited_email, display_label, role, status, invite_token_hash, invite_expires_at, invited_by_user_id)
       VALUES ($1, $2, $3, $4, 'invited', $5, now() + interval '7 days', $6)
       RETURNING id, invited_email, display_label, role, status, invite_expires_at`,
      [params.sessionId, body.email.toLowerCase(), body.displayLabel, body.role, hashToken(token), user.id],
    );
    await writeAuditLog({ pool: context.pool, actorUserId: user.id, action: 'collaborator.invite', entityType: 'collaborator', entityId: result.rows[0].id, requestId: request.id });
    return reply.code(201).send({ invitation: result.rows[0], token });
  });

  app.post('/api/v1/invitations/:token/accept', { preHandler: (req, rep) => authGuard(context, req, rep) }, async (request, reply) => {
    const user = currentUser(request);
    const params = z.object({ token: z.string().min(1) }).parse(request.params);
    const result = await context.pool.query(
      `UPDATE collaborators SET user_id = $1, status = 'active', accepted_at = now(), updated_at = now(), invite_token_hash = NULL
       WHERE invite_token_hash = $2 AND status = 'invited' AND invite_expires_at > now()
       RETURNING id, shared_session_id, display_label, role, status`,
      [user.id, hashToken(params.token)],
    );
    if (!result.rowCount) return reply.code(404).send({ error: 'Invitation not found' });
    await writeAuditLog({ pool: context.pool, actorUserId: user.id, action: 'collaborator.accept_invite', entityType: 'collaborator', entityId: result.rows[0].id, requestId: request.id });
    return { collaborator: result.rows[0] };
  });

  app.post('/api/v1/invitations/:token/decline', async (request, reply) => {
    const params = z.object({ token: z.string().min(1) }).parse(request.params);
    const result = await context.pool.query(
      `UPDATE collaborators SET status = 'declined', updated_at = now(), invite_token_hash = NULL
       WHERE invite_token_hash = $1 AND status = 'invited' AND invite_expires_at > now()
       RETURNING id`,
      [hashToken(params.token)],
    );
    if (!result.rowCount) return reply.code(404).send({ error: 'Invitation not found' });
    return { ok: true };
  });

  app.get('/api/v1/shared-sessions/:sessionId/collaborators', { preHandler: (req, rep) => authGuard(context, req, rep) }, async (request, reply) => {
    const user = currentUser(request);
    const params = z.object({ sessionId: z.string().uuid() }).parse(request.params);
    try { await requireSessionAccess(context.pool, params.sessionId, user.id); } catch { return reply.code(403).send({ error: 'Forbidden' }); }
    const result = await context.pool.query(
      `SELECT id, user_id, invited_email, display_label, role, status FROM collaborators WHERE shared_session_id = $1 ORDER BY created_at`,
      [params.sessionId],
    );
    return { collaborators: result.rows };
  });

  app.get('/api/v1/connections/twitch/start', { preHandler: (req, rep) => authGuard(context, req, rep) }, async (request, reply) => {
    if (!context.twitch) return reply.code(503).send({ error: 'Twitch is not configured' });
    const user = currentUser(request);
    const state = createOpaqueToken();
    await context.pool.query(
      `INSERT INTO settings(user_id, key, value, version) VALUES ($1, $2, $3::jsonb, 1)
       ON CONFLICT (user_id, key) WHERE user_id IS NOT NULL
       DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [user.id, `oauth:twitch:${state}`, JSON.stringify({ state, userId: user.id, createdAt: new Date().toISOString() })],
    );
    const authorizationUrl = buildTwitchAuthorizationUrl(context.twitch, state);
    return { authorizationUrl, redirectUri: context.twitch.redirectUri };
  });

  app.get('/api/v1/connections/twitch/callback', async (request, reply) => {
    if (!context.twitch) return reply.code(503).send({ error: 'Twitch is not configured' });
    const query = z.object({ code: z.string().min(1), state: z.string().min(1) }).parse(request.query);
    const stateResult = await context.pool.query<{ user_id: string }>(
      `SELECT user_id FROM settings WHERE key = $1 AND user_id IS NOT NULL`,
      [`oauth:twitch:${query.state}`],
    );
    const stateRow = stateResult.rows[0];
    if (!stateRow) return reply.code(400).send({ error: 'Invalid OAuth state' });

    const token = await exchangeTwitchCode(context.twitch, query.code);
    const twitchUser = await getTwitchUser(context.twitch.clientId, token.accessToken);
    await context.pool.query(
      `INSERT INTO connections(user_id, platform, external_account_id, external_username, status, metadata)
       VALUES ($1, 'twitch', $2, $3, 'connected', $4::jsonb)
       ON CONFLICT (user_id, platform)
       DO UPDATE SET external_account_id = EXCLUDED.external_account_id,
                     external_username = EXCLUDED.external_username,
                     status = 'connected',
                     metadata = EXCLUDED.metadata,
                     updated_at = now()`,
      [
        stateRow.user_id,
        twitchUser.id,
        twitchUser.login,
        JSON.stringify({
          displayName: twitchUser.displayName,
          accessToken: token.accessToken,
          refreshToken: token.refreshToken,
          expiresAt: new Date(Date.now() + token.expiresIn * 1000).toISOString(),
          scope: token.scope,
          tokenType: token.tokenType,
        }),
      ],
    );
    await context.pool.query('DELETE FROM settings WHERE key = $1', [`oauth:twitch:${query.state}`]);
    await writeAuditLog({ pool: context.pool, actorUserId: stateRow.user_id, action: 'connection.twitch.connected', entityType: 'connection', requestId: request.id, metadata: { twitchUserId: twitchUser.id, twitchLogin: twitchUser.login } });
    reply.type('text/html');
    return '<!doctype html><title>Twitch connected</title><h1>Twitch connected</h1><p>You can close this tab and return to the app.</p>';
  });

  app.get('/api/v1/connections', { preHandler: (req, rep) => authGuard(context, req, rep) }, async (request) => {
    const user = currentUser(request);
    const result = await context.pool.query(
      `SELECT platform, external_account_id, external_username, status, created_at, updated_at
       FROM connections WHERE user_id = $1 ORDER BY platform`,
      [user.id],
    );
    return { connections: result.rows };
  });

  app.post('/api/v1/connections/kick/resolve', { preHandler: (req, rep) => authGuard(context, req, rep) }, async (request, reply) => {
    const user = currentUser(request);
    const body = z.object({ username: z.string().min(1) }).parse(request.body);
    try {
      const channel = await resolveKickChannel(body.username);
      await context.pool.query(
        `INSERT INTO connections(user_id, platform, external_account_id, external_username, status, metadata)
         VALUES ($1, 'kick', $2, $3, 'connected', $4::jsonb)
         ON CONFLICT (user_id, platform)
         DO UPDATE SET external_account_id = EXCLUDED.external_account_id,
                       external_username = EXCLUDED.external_username,
                       status = 'connected',
                       metadata = EXCLUDED.metadata,
                       updated_at = now()`,
        [user.id, String(channel.chatroomId), channel.slug, JSON.stringify({ chatroomId: channel.chatroomId, slug: channel.slug })],
      );
      await writeAuditLog({ pool: context.pool, actorUserId: user.id, action: 'connection.kick.resolved', entityType: 'connection', requestId: request.id, metadata: { username: body.username, chatroomId: channel.chatroomId } });
      return { connection: { platform: 'kick', externalAccountId: String(channel.chatroomId), externalUsername: channel.slug, status: 'connected' } };
    } catch (error) {
      return reply.code(502).send({ error: error instanceof Error ? error.message : 'Kick resolve failed' });
    }
  });

  app.post('/api/v1/connections/x/resolve', { preHandler: (req, rep) => authGuard(context, req, rep) }, async (request, reply) => {
    const user = currentUser(request);
    const body = z.object({ broadcastUrl: z.string().min(1) }).parse(request.body);
    let broadcastId: string;
    try {
      broadcastId = extractXBroadcastId(body.broadcastUrl);
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : 'Invalid X broadcast URL' });
    }
    const canonicalUrl = `https://x.com/i/broadcasts/${broadcastId}`;
    await context.pool.query(
      `INSERT INTO connections(user_id, platform, external_account_id, external_username, status, metadata)
       VALUES ($1, 'x', $2, $2, 'connected', $3::jsonb)
       ON CONFLICT (user_id, platform)
       DO UPDATE SET external_account_id = EXCLUDED.external_account_id,
                     external_username = EXCLUDED.external_username,
                     status = 'connected',
                     metadata = EXCLUDED.metadata,
                     updated_at = now()`,
      [user.id, broadcastId, JSON.stringify({ broadcastId, broadcastUrl: canonicalUrl })],
    );
    await writeAuditLog({ pool: context.pool, actorUserId: user.id, action: 'connection.x.resolved', entityType: 'connection', requestId: request.id, metadata: { broadcastId } });
    return { connection: { platform: 'x', externalAccountId: broadcastId, externalUsername: broadcastId, status: 'connected' } };
  });

  const providerSessionParams = z.object({ sessionId: z.string().uuid() });

  async function creatorLabelFor(sessionId: string, userId: string): Promise<string> {
    const result = await context.pool.query<{ display_label: string }>(
      `SELECT display_label FROM collaborators
       WHERE shared_session_id = $1 AND user_id = $2 AND status = 'active'
       ORDER BY created_at ASC LIMIT 1`,
      [sessionId, userId],
    );
    return result.rows[0]?.display_label ?? 'Creator';
  }

  async function validateOverlayToken(sessionId: string, token: string | null): Promise<boolean> {
    if (!token) return false;
    const result = await context.pool.query(
      `SELECT id FROM settings
       WHERE shared_session_id = $1 AND key = 'overlay:token' AND value->>'tokenHash' = $2`,
      [sessionId, hashToken(token)],
    );
    return Boolean(result.rowCount);
  }

  app.post('/api/v1/shared-sessions/:sessionId/overlay-token', { preHandler: (req, rep) => authGuard(context, req, rep) }, async (request, reply) => {
    const user = currentUser(request);
    const params = providerSessionParams.parse(request.params);
    try { await requireSessionManager(context.pool, params.sessionId, user.id); } catch { return reply.code(403).send({ error: 'Forbidden' }); }
    const token = createOpaqueToken();
    await context.pool.query(
      `INSERT INTO settings(shared_session_id, key, value, version) VALUES ($1, 'overlay:token', $2::jsonb, 1)
       ON CONFLICT (shared_session_id, key) WHERE shared_session_id IS NOT NULL
       DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [params.sessionId, JSON.stringify({ tokenHash: hashToken(token), createdAt: new Date().toISOString(), createdByUserId: user.id })],
    );
    const overlayUrl = `${context.appPublicUrl.replace(/\/$/, '')}/overlay/${params.sessionId}?token=${encodeURIComponent(token)}`;
    await writeAuditLog({ pool: context.pool, actorUserId: user.id, action: 'overlay.token.created', entityType: 'shared_session', entityId: params.sessionId, requestId: request.id });
    return { token, overlayUrl };
  });

  app.get('/api/v1/shared-sessions/:sessionId/providers', { preHandler: (req, rep) => authGuard(context, req, rep) }, async (request, reply) => {
    const user = currentUser(request);
    const params = providerSessionParams.parse(request.params);
    try { await requireSessionAccess(context.pool, params.sessionId, user.id); } catch { return reply.code(403).send({ error: 'Forbidden' }); }
    return { providers: providerRuntime.status(params.sessionId) };
  });

  app.post('/api/v1/shared-sessions/:sessionId/providers/kick/start', { preHandler: (req, rep) => authGuard(context, req, rep) }, async (request, reply) => {
    const user = currentUser(request);
    const params = providerSessionParams.parse(request.params);
    try { await requireSessionManager(context.pool, params.sessionId, user.id); } catch { return reply.code(403).send({ error: 'Forbidden' }); }

    const connection = await context.pool.query<{ external_account_id: string | null; external_username: string | null; metadata: Record<string, unknown> }>(
      `SELECT external_account_id, external_username, metadata FROM connections
       WHERE user_id = $1 AND platform = 'kick' AND status = 'connected'`,
      [user.id],
    );
    const row = connection.rows[0];
    if (!row) return reply.code(409).send({ error: 'Kick is not connected for this user' });
    const chatroomId = Number(row.metadata?.chatroomId ?? row.external_account_id);
    if (!Number.isFinite(chatroomId)) return reply.code(409).send({ error: 'Kick connection is missing a chatroom id' });

    const provider = await providerRuntime.startKick({
      sessionId: params.sessionId,
      ownerId: user.id,
      ownerName: await creatorLabelFor(params.sessionId, user.id),
      chatroomId,
      externalUsername: row.external_username ?? String(chatroomId),
    });
    await writeAuditLog({ pool: context.pool, actorUserId: user.id, action: 'provider.kick.started', entityType: 'shared_session', entityId: params.sessionId, requestId: request.id, metadata: { status: provider.status } });
    return { provider };
  });

  app.post('/api/v1/shared-sessions/:sessionId/providers/twitch/start', { preHandler: (req, rep) => authGuard(context, req, rep) }, async (request, reply) => {
    if (!context.twitch) return reply.code(503).send({ error: 'Twitch is not configured' });
    const user = currentUser(request);
    const params = providerSessionParams.parse(request.params);
    try { await requireSessionManager(context.pool, params.sessionId, user.id); } catch { return reply.code(403).send({ error: 'Forbidden' }); }

    const connection = await context.pool.query<{ external_account_id: string | null; external_username: string | null; metadata: Record<string, unknown> }>(
      `SELECT external_account_id, external_username, metadata FROM connections
       WHERE user_id = $1 AND platform = 'twitch' AND status = 'connected'`,
      [user.id],
    );
    const row = connection.rows[0];
    const accessToken = typeof row?.metadata?.accessToken === 'string' ? row.metadata.accessToken : null;
    if (!row || !row.external_account_id || !accessToken) return reply.code(409).send({ error: 'Twitch is not connected for this user' });

    const provider = await providerRuntime.startTwitch({
      sessionId: params.sessionId,
      ownerId: user.id,
      ownerName: await creatorLabelFor(params.sessionId, user.id),
      clientId: context.twitch.clientId,
      accessToken,
      broadcasterUserId: row.external_account_id,
      chattingUserId: row.external_account_id,
      externalUsername: row.external_username ?? row.external_account_id,
    });
    await writeAuditLog({ pool: context.pool, actorUserId: user.id, action: 'provider.twitch.started', entityType: 'shared_session', entityId: params.sessionId, requestId: request.id, metadata: { status: provider.status } });
    return { provider };
  });

  app.post('/api/v1/shared-sessions/:sessionId/providers/x/start', { preHandler: (req, rep) => authGuard(context, req, rep) }, async (request, reply) => {
    const user = currentUser(request);
    const params = providerSessionParams.parse(request.params);
    try { await requireSessionManager(context.pool, params.sessionId, user.id); } catch { return reply.code(403).send({ error: 'Forbidden' }); }

    const connection = await context.pool.query<{ external_account_id: string | null; metadata: Record<string, unknown> }>(
      `SELECT external_account_id, metadata FROM connections
       WHERE user_id = $1 AND platform = 'x' AND status = 'connected'`,
      [user.id],
    );
    const row = connection.rows[0];
    const broadcastUrl = typeof row?.metadata?.broadcastUrl === 'string' ? row.metadata.broadcastUrl : null;
    const broadcastId = typeof row?.metadata?.broadcastId === 'string' ? row.metadata.broadcastId : row?.external_account_id;
    if (!row || !broadcastId || !broadcastUrl) return reply.code(409).send({ error: 'X broadcast link is not configured for this user' });

    const provider = await providerRuntime.startX({
      sessionId: params.sessionId,
      ownerId: user.id,
      ownerName: await creatorLabelFor(params.sessionId, user.id),
      broadcastId,
      broadcastUrl,
    });
    await writeAuditLog({ pool: context.pool, actorUserId: user.id, action: 'provider.x.started', entityType: 'shared_session', entityId: params.sessionId, requestId: request.id, metadata: { status: provider.status, broadcastId } });
    return { provider };
  });

  app.post('/api/v1/shared-sessions/:sessionId/providers/:platform/stop', { preHandler: (req, rep) => authGuard(context, req, rep) }, async (request, reply) => {
    const user = currentUser(request);
    const params = z.object({ sessionId: z.string().uuid(), platform: z.enum(['twitch', 'kick', 'x']) }).parse(request.params);
    try { await requireSessionManager(context.pool, params.sessionId, user.id); } catch { return reply.code(403).send({ error: 'Forbidden' }); }
    const provider = await providerRuntime.stop({ sessionId: params.sessionId, platform: params.platform });
    await writeAuditLog({ pool: context.pool, actorUserId: user.id, action: `provider.${params.platform}.stopped`, entityType: 'shared_session', entityId: params.sessionId, requestId: request.id, metadata: { status: provider.status } });
    return { provider };
  });

  app.get('/api/v1/overlay/ws', { websocket: true }, async (socket, request) => {
    const url = new URL(request.url, 'http://localhost');
    const sessionId = url.searchParams.get('sessionId');
    const token = url.searchParams.get('token');
    if (!sessionId || !z.string().uuid().safeParse(sessionId).success || !(await validateOverlayToken(sessionId, token))) {
      socket.close(1008, 'Unauthorized');
      return;
    }
    socket.send(JSON.stringify({ type: 'subscribed', sessionId }));
    const unsubscribe = providerRuntime.subscribeToSession(sessionId, (message) => {
      socket.send(JSON.stringify({ type: 'chat_message', message }));
    });
    socket.on('close', unsubscribe);
  });

  app.get('/api/v1/ws', { websocket: true }, (socket, request) => {
    const url = new URL(request.url, 'http://localhost');
    const token = url.searchParams.get('token');
    if (!token) {
      socket.close(1008, 'Unauthorized');
      return;
    }
    let user: AuthenticatedUser;
    try { user = verifyJwt(token, context.jwtSecret); } catch { socket.close(1008, 'Unauthorized'); return; }
    socket.on('message', async (raw) => {
      try {
        const message = z.object({ type: z.literal('subscribe'), sessionId: z.string().uuid() }).parse(JSON.parse(raw.toString()));
        await requireSessionAccess(context.pool, message.sessionId, user.id);
        socket.send(JSON.stringify({ type: 'subscribed', sessionId: message.sessionId }));
      } catch {
        socket.send(JSON.stringify({ type: 'error', error: 'Forbidden or invalid message' }));
      }
    });
  });

  app.addHook('onClose', async () => {
    await providerRuntime.shutdown?.();
    await context.pool.end();
  });

  return app;
}
