import type { Platform, UnifiedMessage } from '../../shared/src/index.js';

export type { Platform, UnifiedMessage };

export interface RawProviderMessage {
  sourceMessageId: string;
  sessionId: string;
  ownerId: string;
  ownerName: string;
  platform: Platform;
  username: string;
  text: string;
  emittedAt: Date;
}

export interface ProviderRuntime {
  name: string;
  platform: Platform;
  start(): Promise<void>;
  stop(): Promise<void>;
  onMessage(callback: (message: RawProviderMessage) => void): void;
}

export interface QueueItem {
  raw: RawProviderMessage;
  attempts: number;
}
