import type { UnifiedMessage } from './types.js';

export class FeedManager {
  private readonly feeds = new Map<string, UnifiedMessage[]>();

  constructor(private readonly messageLimit = 200) {}

  append(message: UnifiedMessage): void {
    const feed = this.feeds.get(message.sessionId) ?? [];
    feed.push(message);
    if (feed.length > this.messageLimit) feed.splice(0, feed.length - this.messageLimit);
    this.feeds.set(message.sessionId, feed);
  }

  getFeed(sessionId: string): UnifiedMessage[] {
    return [...(this.feeds.get(sessionId) ?? [])];
  }
}
