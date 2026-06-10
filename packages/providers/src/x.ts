import WebSocket from 'ws';
import { z } from 'zod';
import type { RawProviderMessage } from '../../pipeline/src/types.js';
import { DuplicateSuppressor } from './duplicates.js';
import { ExponentialBackoff } from './backoff.js';

const X_WEB_BEARER = 'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs=1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';
const X_GUEST_ACTIVATE_URL = 'https://api.x.com/1.1/guest/activate.json';
const X_BROADCAST_SHOW_URL = 'https://x.com/i/api/1.1/broadcasts/show.json';
const X_LIVE_STATUS_URL = 'https://x.com/i/api/1.1/live_video_stream/status';
const X_ACCESS_CHAT_URL = 'https://proxsee-cf.pscp.tv/api/v2/accessChatPublic';

export interface XLivestreamConfig {
  livestreamUrl: string;
}

export interface XBroadcastBootstrap {
  broadcastId: string;
  url: string;
  mediaKey: string;
  chatToken: string;
  endpoint: string;
  accessToken: string;
  readOnly: boolean;
  title?: string;
}

export interface XChatMessage {
  broadcastId: string;
  uuid: string;
  username: string;
  displayName: string;
  text: string;
  timestampMs: number;
  url: string;
}

export class XHttpError extends Error {
  constructor(message: string, readonly status: number, readonly body: string) {
    super(message);
  }
}

export function assertXLivestreamConfigured(config: XLivestreamConfig): void {
  if (!config.livestreamUrl || config.livestreamUrl.toLowerCase() === 'none') {
    throw new Error('X livestream URL is required before enabling the X provider');
  }
  extractXBroadcastId(config.livestreamUrl);
}

export function extractXBroadcastId(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw new Error('X broadcast URL is required');

  try {
    const url = new URL(trimmed);
    const match = url.pathname.match(/^\/i\/broadcasts\/([^/?#]+)/);
    if (!match?.[1]) throw new Error('not a broadcast URL');
    return match[1];
  } catch {
    if (/^[A-Za-z0-9]+$/.test(trimmed)) return trimmed;
    throw new Error(`Could not extract broadcast id from: ${trimmed}`);
  }
}

export async function bootstrapXBroadcast(inputUrl: string): Promise<XBroadcastBootstrap> {
  const broadcastId = extractXBroadcastId(inputUrl);
  const url = `https://x.com/i/broadcasts/${broadcastId}`;
  const guestToken = await activateXGuestToken();
  const show = await requestJson<unknown>(`${X_BROADCAST_SHOW_URL}?ids=${encodeURIComponent(broadcastId)}`, {
    headers: xApiHeaders(guestToken),
  });

  const parsedShow = z.object({
    broadcasts: z.record(z.object({ media_key: z.string().optional(), status: z.string().optional() }).passthrough()).optional(),
  }).parse(show);
  const broadcast = parsedShow.broadcasts?.[broadcastId];
  const mediaKey = broadcast?.media_key;
  if (!mediaKey) throw new Error(`No media_key found for X broadcast ${broadcastId}`);

  const status = await requestJson<unknown>(
    `${X_LIVE_STATUS_URL}/${encodeURIComponent(mediaKey)}?client=web&use_syndication_guest_id=false&cookie_set_host=x.com`,
    { headers: xApiHeaders(guestToken) },
  );
  const parsedStatus = z.object({ chatToken: z.string().optional() }).passthrough().parse(status);
  if (!parsedStatus.chatToken) throw new Error(`No chatToken found for X broadcast ${broadcastId}`);

  const access = await requestJson<unknown>(X_ACCESS_CHAT_URL, {
    method: 'POST',
    headers: periscopeHeaders(),
    body: JSON.stringify({ chat_token: parsedStatus.chatToken }),
  });
  const parsedAccess = z.object({
    access_token: z.string().optional(),
    replay_access_token: z.string().optional(),
    endpoint: z.string().optional(),
    replay_endpoint: z.string().optional(),
    read_only: z.boolean().optional(),
  }).passthrough().parse(access);

  const endpoint = parsedAccess.endpoint ?? parsedAccess.replay_endpoint;
  const accessToken = parsedAccess.access_token ?? parsedAccess.replay_access_token;
  if (!endpoint || !accessToken) throw new Error(`Could not resolve X chat endpoint for broadcast ${broadcastId}`);

  return {
    broadcastId,
    url,
    mediaKey,
    chatToken: parsedStatus.chatToken,
    endpoint,
    accessToken,
    readOnly: parsedAccess.read_only ?? true,
    ...(broadcast?.status ? { title: broadcast.status } : {}),
  };
}

export async function fetchXInitialHistory(bootstrap: XBroadcastBootstrap): Promise<XChatMessage[]> {
  const response = await requestJson<unknown>(`${bootstrap.endpoint.replace(/\/$/, '')}/chatapi/v1/history`, {
    method: 'POST',
    headers: periscopeHeaders(),
    body: JSON.stringify({
      access_token: bootstrap.accessToken,
      cursor: '',
      limit: 1000,
      since: null,
      quick_get: true,
    }),
  });
  const parsed = z.object({ messages: z.array(z.object({ kind: z.number().optional(), payload: z.string().optional() }).passthrough()).default([]) }).passthrough().parse(response);
  const messages = parsed.messages
    .map((message) => parseXChatMessage(message, bootstrap.broadcastId, bootstrap.url))
    .filter((message): message is XChatMessage => Boolean(message));
  return dedupeAndSort(messages);
}

export function parseXChatMessage(message: { kind?: number | undefined; payload?: string | undefined }, broadcastId: string, url: string): XChatMessage | null {
  if (message.kind !== 1 || !message.payload) return null;

  let outer: any;
  try {
    outer = JSON.parse(message.payload);
  } catch {
    return null;
  }

  let inner: any = outer?.body;
  if (typeof inner === 'string') {
    try {
      inner = JSON.parse(inner);
    } catch {
      return null;
    }
  }

  const text = typeof inner?.body === 'string' ? inner.body.trim() : '';
  if (!text) return null;

  const timestampMs = typeof inner?.timestamp === 'number'
    ? inner.timestamp
    : typeof inner?.programDateTime === 'string'
      ? Date.parse(inner.programDateTime)
      : Date.now();
  const username = typeof inner?.username === 'string'
    ? inner.username
    : typeof outer?.sender?.username === 'string'
      ? outer.sender.username
      : 'unknown';
  const displayName = typeof inner?.displayName === 'string'
    ? inner.displayName
    : typeof outer?.sender?.display_name === 'string'
      ? outer.sender.display_name
      : username;
  const uuid = typeof inner?.uuid === 'string' && inner.uuid.length > 0
    ? inner.uuid
    : `${broadcastId}:${username}:${timestampMs}:${text}`;

  return { broadcastId, uuid, username, displayName, text, timestampMs, url };
}

export interface XBroadcastProviderOptions {
  broadcastUrl: string;
  sessionId: string;
  ownerId: string;
  ownerName: string;
}

export class XBroadcastChatProvider {
  public readonly name: string;
  public readonly platform = 'x' as const;
  private callback: ((message: RawProviderMessage) => void) | null = null;
  private readonly duplicates = new DuplicateSuppressor();
  private readonly backoff = new ExponentialBackoff();
  private socket: WebSocket | null = null;
  private stopped = true;
  private bootstrap: XBroadcastBootstrap | null = null;

  constructor(private readonly options: XBroadcastProviderOptions) {
    this.name = `x-broadcast-chat:${extractXBroadcastId(options.broadcastUrl)}`;
  }

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
    this.bootstrap = await bootstrapXBroadcast(this.options.broadcastUrl);
    const history = await fetchXInitialHistory(this.bootstrap);
    for (const message of history) this.emit(message);
    this.connectWebSocket(this.bootstrap);
  }

  private connectWebSocket(bootstrap: XBroadcastBootstrap): void {
    const wsUrl = `${bootstrap.endpoint.replace(/^http/, 'ws').replace(/\/$/, '')}/chatapi/v1/chatnow`;
    this.socket = new WebSocket(wsUrl);
    this.socket.on('open', () => {
      this.backoff.reset();
      this.socket?.send(JSON.stringify({ payload: JSON.stringify({ access_token: bootstrap.accessToken }), kind: 3 }));
      this.socket?.send(JSON.stringify({
        payload: JSON.stringify({ body: JSON.stringify({ room: bootstrap.broadcastId }), kind: 1 }),
        kind: 2,
      }));
    });
    this.socket.on('message', (data) => {
      const parsed = parseXChatMessage(JSON.parse(data.toString()), bootstrap.broadcastId, bootstrap.url);
      if (parsed) this.emit(parsed);
    });
    this.socket.on('close', () => {
      if (!this.stopped) {
        const delay = this.backoff.nextDelayMs();
        setTimeout(() => void this.connect(), delay);
      }
    });
  }

  private emit(message: XChatMessage): void {
    if (!this.duplicates.shouldAccept(message.uuid)) return;
    this.callback?.({
      sourceMessageId: message.uuid,
      sessionId: this.options.sessionId,
      ownerId: this.options.ownerId,
      ownerName: this.options.ownerName,
      platform: 'x',
      username: message.username,
      text: message.text,
      emittedAt: new Date(message.timestampMs),
    });
  }
}

async function activateXGuestToken(): Promise<string> {
  const response = await requestJson<unknown>(X_GUEST_ACTIVATE_URL, {
    method: 'POST',
    headers: xApiHeaders(),
  });
  const parsed = z.object({ guest_token: z.string() }).parse(response);
  return parsed.guest_token;
}

function xApiHeaders(guestToken?: string): Record<string, string> {
  return {
    authorization: `Bearer ${X_WEB_BEARER}`,
    accept: 'application/json, text/plain, */*',
    'x-twitter-active-user': 'yes',
    'x-twitter-client-language': 'en',
    ...(guestToken ? { 'x-guest-token': guestToken } : {}),
  };
}

function periscopeHeaders(): Record<string, string> {
  return {
    accept: '*/*',
    origin: 'https://x.com',
    referer: 'https://x.com/',
    'content-type': 'application/json',
    'x-periscope-user-agent': 'Twitter/m5',
    'x-attempt': '1',
    'x-idempotence': `${Date.now()}`,
  };
}

async function requestJson<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      'user-agent': 'Mozilla/5.0 StreamChatAggregator/0.1',
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  if (!response.ok) throw new XHttpError(`HTTP ${response.status} for ${url}`, response.status, text);
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    throw new Error(`Invalid JSON from ${url}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function dedupeAndSort(messages: XChatMessage[]): XChatMessage[] {
  const byId = new Map<string, XChatMessage>();
  for (const message of messages) byId.set(message.uuid, message);
  return Array.from(byId.values()).sort((a, b) => a.timestampMs - b.timestampMs || a.uuid.localeCompare(b.uuid));
}
