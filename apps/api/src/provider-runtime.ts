import { MessageEventBus, FeedManager, MessageQueue, MessageRouter, type Platform, type ProviderRuntime } from '../../../packages/pipeline/src/index.js';
import { KickPusherChatProvider, TwitchEventSubChatProvider, XBroadcastChatProvider, type TwitchOAuthConfig } from '../../../packages/providers/src/index.js';

export interface ProviderStatus {
  sessionId: string;
  platform: Platform;
  status: 'running' | 'stopped' | 'failed';
  ownerName?: string;
  error?: string;
}

export interface StartKickProviderInput {
  sessionId: string;
  ownerId: string;
  ownerName: string;
  chatroomId: number;
  externalUsername: string;
}

export interface StartTwitchProviderInput {
  sessionId: string;
  ownerId: string;
  ownerName: string;
  clientId: string;
  accessToken: string;
  broadcasterUserId: string;
  chattingUserId: string;
  externalUsername: string;
}

export interface StartXProviderInput {
  sessionId: string;
  ownerId: string;
  ownerName: string;
  broadcastId: string;
  broadcastUrl: string;
}

export interface ProviderRuntimeController {
  startKick(input: StartKickProviderInput): Promise<ProviderStatus>;
  startTwitch(input: StartTwitchProviderInput): Promise<ProviderStatus>;
  startX(input: StartXProviderInput): Promise<ProviderStatus>;
  stop(input: { sessionId: string; platform: Platform }): Promise<ProviderStatus>;
  status(sessionId: string): ProviderStatus[];
  shutdown?(): Promise<void>;
}

interface ActiveProvider {
  provider: ProviderRuntime;
  status: ProviderStatus;
}

export class LiveProviderRuntimeController implements ProviderRuntimeController {
  private readonly bus = new MessageEventBus();
  private readonly feeds = new FeedManager();
  private readonly queue = new MessageQueue();
  private readonly router = new MessageRouter(this.queue, this.bus, this.feeds);
  private readonly active = new Map<string, ActiveProvider>();
  private readonly flushTimer: NodeJS.Timeout;

  constructor() {
    this.flushTimer = setInterval(() => {
      void this.router.flush();
    }, 250);
    this.flushTimer.unref?.();
  }

  async startKick(input: StartKickProviderInput): Promise<ProviderStatus> {
    const provider = new KickPusherChatProvider({
      chatroomId: input.chatroomId,
      sessionId: input.sessionId,
      ownerId: input.ownerId,
      ownerName: input.ownerName,
    });
    return this.start(input.sessionId, 'kick', input.ownerName, provider);
  }

  async startTwitch(input: StartTwitchProviderInput): Promise<ProviderStatus> {
    const provider = new TwitchEventSubChatProvider({
      clientId: input.clientId,
      accessToken: input.accessToken,
      broadcasterUserId: input.broadcasterUserId,
      chattingUserId: input.chattingUserId,
      sessionId: input.sessionId,
      ownerId: input.ownerId,
      ownerName: input.ownerName,
    });
    return this.start(input.sessionId, 'twitch', input.ownerName, provider);
  }

  async startX(input: StartXProviderInput): Promise<ProviderStatus> {
    const provider = new XBroadcastChatProvider({
      broadcastUrl: input.broadcastUrl,
      sessionId: input.sessionId,
      ownerId: input.ownerId,
      ownerName: input.ownerName,
    });
    return this.start(input.sessionId, 'x', input.ownerName, provider);
  }

  async stop(input: { sessionId: string; platform: Platform }): Promise<ProviderStatus> {
    const key = this.key(input.sessionId, input.platform);
    const active = this.active.get(key);
    if (!active) return { sessionId: input.sessionId, platform: input.platform, status: 'stopped' };
    await active.provider.stop();
    const status = { ...active.status, status: 'stopped' as const };
    this.active.delete(key);
    return status;
  }

  status(sessionId: string): ProviderStatus[] {
    return Array.from(this.active.values())
      .map((entry) => entry.status)
      .filter((status) => status.sessionId === sessionId)
      .map((status) => ({ ...status }));
  }

  async shutdown(): Promise<void> {
    clearInterval(this.flushTimer);
    await Promise.all(Array.from(this.active.values()).map((entry) => entry.provider.stop()));
    this.active.clear();
  }

  private async start(sessionId: string, platform: Platform, ownerName: string, provider: ProviderRuntime): Promise<ProviderStatus> {
    const key = this.key(sessionId, platform);
    await this.active.get(key)?.provider.stop();
    provider.onMessage((message) => this.router.accept(message));
    const status: ProviderStatus = { sessionId, platform, status: 'running', ownerName };
    this.active.set(key, { provider, status });
    try {
      await provider.start();
      return { ...status };
    } catch (error) {
      const failed: ProviderStatus = {
        sessionId,
        platform,
        status: 'failed',
        ownerName,
        error: error instanceof Error ? error.message : String(error),
      };
      this.active.set(key, { provider, status: failed });
      return { ...failed };
    }
  }

  private key(sessionId: string, platform: Platform): string {
    return `${sessionId}:${platform}`;
  }
}

export function createTwitchConfigInput(config: TwitchOAuthConfig): Pick<StartTwitchProviderInput, 'clientId'> {
  return { clientId: config.clientId };
}
