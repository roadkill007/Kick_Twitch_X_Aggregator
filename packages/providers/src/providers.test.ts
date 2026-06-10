import { describe, expect, it, vi } from 'vitest';
import { ExponentialBackoff } from './backoff.js';
import { DuplicateSuppressor } from './duplicates.js';
import { buildTwitchAuthorizationUrl, refreshTwitchToken, TWITCH_CHAT_SCOPES } from './twitch.js';
import { KickPusherChatProvider, parseKickChannel } from './kick.js';
import { assertXLivestreamConfigured } from './x.js';

describe('Twitch real integration helpers', () => {
  it('builds the production Twitch OAuth URL with required chat scopes', () => {
    const url = new URL(buildTwitchAuthorizationUrl({ clientId: 'client-id', clientSecret: 'secret', redirectUri: 'https://example.com/callback' }, 'state-123'));

    expect(url.origin + url.pathname).toBe('https://id.twitch.tv/oauth2/authorize');
    expect(url.searchParams.get('client_id')).toBe('client-id');
    expect(url.searchParams.get('redirect_uri')).toBe('https://example.com/callback');
    expect(url.searchParams.get('scope')).toBe(TWITCH_CHAT_SCOPES.join(' '));
    expect(url.searchParams.get('state')).toBe('state-123');
  });

  it('refreshes Twitch tokens through the real token endpoint contract', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({
      access_token: 'new-access',
      refresh_token: 'new-refresh',
      expires_in: 3600,
      scope: ['user:read:chat'],
      token_type: 'bearer',
    }), { status: 200, headers: { 'content-type': 'application/json' } }));

    const token = await refreshTwitchToken({ clientId: 'client', clientSecret: 'secret', redirectUri: 'https://example.com/cb' }, 'old-refresh');

    expect(token.accessToken).toBe('new-access');
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://id.twitch.tv/oauth2/token');
    fetchMock.mockRestore();
  });
});

describe('Kick real integration helpers', () => {
  it('parses Kick channel metadata and extracts chatroom id', () => {
    expect(parseKickChannel('penpalofficially', { slug: 'penpalofficially', chatroom: { id: 12345 } })).toMatchObject({
      username: 'penpalofficially',
      slug: 'penpalofficially',
      chatroomId: 12345,
    });
  });

  it('normalizes real Kick Pusher chat event payloads', () => {
    const provider = new KickPusherChatProvider({ chatroomId: 123, sessionId: 'session', ownerId: 'owner', ownerName: 'Creator' });
    const received: unknown[] = [];
    provider.onMessage((message) => received.push(message));

    provider.handleSocketMessage(JSON.stringify({
      event: 'App\\Events\\ChatMessageSentEvent',
      data: JSON.stringify({
        message: { id: 'msg-1', message: 'hello kick', created_at: 1700000000 },
        user: { username: 'viewer' },
      }),
    }));
    provider.handleSocketMessage(JSON.stringify({
      event: 'App\\Events\\ChatMessageSentEvent',
      data: JSON.stringify({
        message: { id: 'msg-1', message: 'duplicate', created_at: 1700000001 },
        user: { username: 'viewer' },
      }),
    }));

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ platform: 'kick', username: 'viewer', text: 'hello kick' });
  });
});

describe('provider resilience primitives', () => {
  it('deduplicates provider messages within a TTL window', () => {
    const suppressor = new DuplicateSuppressor(1000);
    expect(suppressor.shouldAccept('id-1', 0)).toBe(true);
    expect(suppressor.shouldAccept('id-1', 10)).toBe(false);
    expect(suppressor.shouldAccept('id-1', 1001)).toBe(true);
  });

  it('uses capped exponential reconnect backoff', () => {
    const backoff = new ExponentialBackoff({ baseMs: 100, maxMs: 250, factor: 2 });
    expect([backoff.nextDelayMs(), backoff.nextDelayMs(), backoff.nextDelayMs(), backoff.nextDelayMs()]).toEqual([100, 200, 250, 250]);
    backoff.reset();
    expect(backoff.nextDelayMs()).toBe(100);
  });
});

describe('X provider gate', () => {
  it('refuses to enable X without a livestream URL', () => {
    expect(() => assertXLivestreamConfigured({ livestreamUrl: 'none' })).toThrow(/X livestream URL/);
  });
});
