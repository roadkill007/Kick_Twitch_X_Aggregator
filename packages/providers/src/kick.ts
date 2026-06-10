import WebSocket from 'ws';
import { z } from 'zod';
import type { RawProviderMessage } from '../../pipeline/src/types.js';
import { DuplicateSuppressor } from './duplicates.js';
import { ExponentialBackoff } from './backoff.js';

const KICK_CHANNEL_URL = 'https://kick.com/api/v2/channels';
const KICK_PUSHER_KEY = '32cbd69e4b950bf97679';
const KICK_PUSHER_WS = `wss://ws-us2.pusher.com/app/${KICK_PUSHER_KEY}?protocol=7&client=js&version=8.4.0&flash=false`;

export interface KickChannelInfo {
  username: string;
  slug: string;
  chatroomId: number;
  raw: unknown;
}

export async function resolveKickChannel(username: string): Promise<KickChannelInfo> {
  const response = await fetch(`${KICK_CHANNEL_URL}/${encodeURIComponent(username)}`, {
    headers: {
      accept: 'application/json',
      'user-agent': 'Mozilla/5.0 StreamChatAggregator/0.1',
    },
  });
  if (!response.ok) throw new Error(`Kick channel lookup failed: ${response.status}`);
  return parseKickChannel(username, await response.json());
}

export function parseKickChannel(username: string, body: unknown): KickChannelInfo {
  const parsed = z.object({
    slug: z.string().optional(),
    chatroom: z.object({ id: z.number() }).optional(),
    chatroom_id: z.number().optional(),
  }).passthrough().parse(body);
  const chatroomId = parsed.chatroom?.id ?? parsed.chatroom_id;
  if (!chatroomId) throw new Error(`Kick channel ${username} does not expose a chatroom id`);
  return { username, slug: parsed.slug ?? username, chatroomId, raw: body };
}

export interface KickPusherProviderOptions {
  chatroomId: number;
  sessionId: string;
  ownerId: string;
  ownerName: string;
  connectUrl?: string;
}

export class KickPusherChatProvider {
  public readonly name = 'kick-pusher-chat';
  public readonly platform = 'kick' as const;
  private socket: WebSocket | null = null;
  private callback: ((message: RawProviderMessage) => void) | null = null;
  private readonly duplicates = new DuplicateSuppressor();
  private readonly backoff = new ExponentialBackoff();
  private stopped = true;

  constructor(private readonly options: KickPusherProviderOptions) {}

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
    this.socket = new WebSocket(this.options.connectUrl ?? KICK_PUSHER_WS);
    this.socket.on('open', () => {
      this.backoff.reset();
      this.socket?.send(JSON.stringify({
        event: 'pusher:subscribe',
        data: { auth: '', channel: `chatrooms.${this.options.chatroomId}.v2` },
      }));
    });
    this.socket.on('message', (data) => this.handleSocketMessage(data.toString()));
    this.socket.on('close', () => {
      if (!this.stopped) {
        const delay = this.backoff.nextDelayMs();
        setTimeout(() => void this.connect(), delay);
      }
    });
  }

  handleSocketMessage(raw: string): void {
    const envelope = JSON.parse(raw) as { event?: string; data?: unknown };
    if (envelope.event !== 'App\\Events\\ChatMessageSentEvent') return;
    const data = typeof envelope.data === 'string' ? JSON.parse(envelope.data) : envelope.data;
    const parsed = z.object({
      message: z.object({ id: z.union([z.string(), z.number()]), message: z.string(), created_at: z.union([z.number(), z.string()]).optional() }).passthrough(),
      user: z.object({ username: z.string() }).passthrough(),
    }).parse(data);

    const sourceMessageId = String(parsed.message.id);
    if (!this.duplicates.shouldAccept(sourceMessageId)) return;
    const createdAt = parsed.message.created_at ? Number(parsed.message.created_at) * 1000 : Date.now();

    this.callback?.({
      sourceMessageId,
      sessionId: this.options.sessionId,
      ownerId: this.options.ownerId,
      ownerName: this.options.ownerName,
      platform: 'kick',
      username: parsed.user.username,
      text: parsed.message.message,
      emittedAt: new Date(createdAt),
    });
  }
}
