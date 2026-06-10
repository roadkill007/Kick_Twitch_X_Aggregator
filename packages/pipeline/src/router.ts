import { MessageEventBus } from './event-bus.js';
import { FeedManager } from './feed-manager.js';
import { MessageQueue } from './message-queue.js';
import { normalizeMessage } from './normalization.js';
import type { RawProviderMessage } from './types.js';

export class MessageRouter {
  constructor(
    private readonly queue: MessageQueue,
    private readonly bus: MessageEventBus,
    private readonly feeds: FeedManager,
  ) {}

  accept(raw: RawProviderMessage): void {
    this.queue.enqueue(raw);
  }

  async flush(): Promise<void> {
    await this.queue.drain(async (raw) => {
      const normalized = normalizeMessage(raw);
      this.feeds.append(normalized);
      this.bus.publish(normalized);
    });
  }
}
