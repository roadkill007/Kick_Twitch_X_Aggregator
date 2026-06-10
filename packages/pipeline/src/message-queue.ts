import type { QueueItem, RawProviderMessage } from './types.js';

export class MessageQueue {
  private readonly items: QueueItem[] = [];
  private draining = false;

  enqueue(raw: RawProviderMessage): void {
    this.items.push({ raw, attempts: 0 });
  }

  size(): number {
    return this.items.length;
  }

  async drain(handler: (raw: RawProviderMessage) => Promise<void>, maxAttempts = 3): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.items.length > 0) {
        const item = this.items.shift();
        if (!item) continue;
        try {
          item.attempts += 1;
          await handler(item.raw);
        } catch (error) {
          if (item.attempts < maxAttempts) this.items.push(item);
          else throw error;
        }
      }
    } finally {
      this.draining = false;
    }
  }
}
