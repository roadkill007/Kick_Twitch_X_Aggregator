import WebSocket from 'ws';
import { z } from 'zod';
import type { RawProviderMessage } from '../../pipeline/src/types.js';
import { DuplicateSuppressor } from './duplicates.js';
import { ExponentialBackoff } from './backoff.js';

const TWITCH_AUTH_URL = 'https://id.twitch.tv/oauth2/authorize';
const TWITCH_TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
const TWITCH_HELIX_URL = 'https://api.twitch.tv/helix';
const TWITCH_EVENTSUB_WS = 'wss://eventsub.wss.twitch.tv/ws';

export const TWITCH_CHAT_SCOPES = ['user:read:chat', 'user:bot'] as const;

export interface TwitchOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface TwitchTokenResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  scope: string[];
  tokenType: string;
}

export interface TwitchUser {
  id: string;
  login: string;
  displayName: string;
}

function parseTokenResponse(body: unknown): TwitchTokenResponse {
  const parsed = z.object({
    access_token: z.string(),
    refresh_token: z.string(),
    expires_in: z.number(),
    scope: z.array(z.string()).default([]),
    token_type: z.string(),
  }).parse(body);
  return {
    accessToken: parsed.access_token,
    refreshToken: parsed.refresh_token,
    expiresIn: parsed.expires_in,
    scope: parsed.scope,
    tokenType: parsed.token_type,
  };
}

export function buildTwitchAuthorizationUrl(config: TwitchOAuthConfig, state: string): string {
  const url = new URL(TWITCH_AUTH_URL);
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', TWITCH_CHAT_SCOPES.join(' '));
  url.searchParams.set('state', state);
  return url.toString();
}

export async function exchangeTwitchCode(config: TwitchOAuthConfig, code: string): Promise<TwitchTokenResponse> {
  const response = await fetch(TWITCH_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: config.redirectUri,
    }),
  });
  if (!response.ok) throw new Error(`Twitch token exchange failed: ${response.status}`);
  return parseTokenResponse(await response.json());
}

export async function refreshTwitchToken(config: TwitchOAuthConfig, refreshToken: string): Promise<TwitchTokenResponse> {
  const response = await fetch(TWITCH_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });
  if (!response.ok) throw new Error(`Twitch token refresh failed: ${response.status}`);
  return parseTokenResponse(await response.json());
}

export async function getTwitchUser(clientId: string, accessToken: string): Promise<TwitchUser> {
  const response = await fetch(`${TWITCH_HELIX_URL}/users`, {
    headers: { 'Client-Id': clientId, Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new Error(`Twitch user lookup failed: ${response.status}`);
  const body = z.object({ data: z.array(z.object({ id: z.string(), login: z.string(), display_name: z.string() })).min(1) }).parse(await response.json());
  const user = body.data[0];
  if (!user) throw new Error('Twitch user lookup returned no users');
  return { id: user.id, login: user.login, displayName: user.display_name };
}

export interface TwitchEventSubProviderOptions {
  clientId: string;
  accessToken: string;
  broadcasterUserId: string;
  chattingUserId: string;
  sessionId: string;
  ownerId: string;
  ownerName: string;
  connectUrl?: string;
}

export class TwitchEventSubChatProvider {
  public readonly name = 'twitch-eventsub-chat';
  public readonly platform = 'twitch' as const;
  private socket: WebSocket | null = null;
  private callback: ((message: RawProviderMessage) => void) | null = null;
  private readonly duplicates = new DuplicateSuppressor();
  private readonly backoff = new ExponentialBackoff();
  private stopped = true;

  constructor(private readonly options: TwitchEventSubProviderOptions) {}

  onMessage(callback: (message: RawProviderMessage) => void): void {
    this.callback = callback;
  }

  async start(): Promise<void> {
    this.stopped = false;
    await this.connect();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.socket?.close();
    this.socket = null;
  }

  private async connect(): Promise<void> {
    this.socket = new WebSocket(this.options.connectUrl ?? TWITCH_EVENTSUB_WS);
    this.socket.on('message', (data) => void this.handleSocketMessage(data.toString()));
    this.socket.on('close', () => {
      if (!this.stopped) {
        const delay = this.backoff.nextDelayMs();
        setTimeout(() => void this.connect(), delay);
      }
    });
  }

  private async subscribeToChat(sessionId: string): Promise<void> {
    const response = await fetch(`${TWITCH_HELIX_URL}/eventsub/subscriptions`, {
      method: 'POST',
      headers: {
        'Client-Id': this.options.clientId,
        Authorization: `Bearer ${this.options.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: 'channel.chat.message',
        version: '1',
        condition: {
          broadcaster_user_id: this.options.broadcasterUserId,
          user_id: this.options.chattingUserId,
        },
        transport: { method: 'websocket', session_id: sessionId },
      }),
    });
    if (!response.ok) throw new Error(`Twitch EventSub subscribe failed: ${response.status}`);
  }

  private async handleSocketMessage(raw: string): Promise<void> {
    const payload = JSON.parse(raw) as any;
    const type = payload.metadata?.message_type;
    if (type === 'session_welcome') {
      this.backoff.reset();
      await this.subscribeToChat(payload.payload.session.id);
      return;
    }
    if (type !== 'notification') return;
    if (payload.payload?.subscription?.type !== 'channel.chat.message') return;

    const event = payload.payload.event;
    const messageId = String(event.message_id);
    if (!this.duplicates.shouldAccept(messageId)) return;

    const text = Array.isArray(event.message?.fragments)
      ? event.message.fragments.map((fragment: any) => fragment.text ?? '').join('')
      : String(event.message?.text ?? '');

    this.callback?.({
      sourceMessageId: messageId,
      sessionId: this.options.sessionId,
      ownerId: this.options.ownerId,
      ownerName: this.options.ownerName,
      platform: 'twitch',
      username: String(event.chatter_user_login ?? event.chatter_user_name ?? 'unknown'),
      text,
      emittedAt: new Date(payload.metadata?.message_timestamp ?? Date.now()),
    });
  }
}
