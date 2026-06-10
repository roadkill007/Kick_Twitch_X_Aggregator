import { describe, expect, it } from 'vitest';
import { FeedManager } from './feed-manager.js';
import { MessageEventBus } from './event-bus.js';
import { MessageQueue } from './message-queue.js';
import { MessageRouter } from './router.js';
import { FailingMockProvider, MockKickProvider, MockTwitchProvider, MockXProvider } from './mock-providers.js';
import { ProviderManager } from './provider-manager.js';
import { normalizeMessage } from './normalization.js';

function createHarness(messageLimit = 200) {
  const queue = new MessageQueue();
  const bus = new MessageEventBus();
  const feeds = new FeedManager(messageLimit);
  const router = new MessageRouter(queue, bus, feeds);
  const manager = new ProviderManager(router);
  return { queue, bus, feeds, router, manager };
}

describe('normalization engine', () => {
  it('normalizes raw provider messages into the unified message model', () => {
    const normalized = normalizeMessage({
      sourceMessageId: 'abc',
      sessionId: 'session-1',
      ownerId: 'owner-1',
      ownerName: 'Creator A',
      platform: 'twitch',
      username: 'viewer1',
      text: 'hello',
      emittedAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    expect(normalized).toEqual({
      id: 'twitch:abc',
      sessionId: 'session-1',
      ownerId: 'owner-1',
      ownerName: 'Creator A',
      platform: 'twitch',
      username: 'viewer1',
      message: 'hello',
      timestamp: '2026-01-01T00:00:00.000Z',
    });
  });
});

describe('provider manager and feed routing', () => {
  it('routes mock Twitch, Kick, and X messages into one session feed in order', async () => {
    const { feeds, router, manager } = createHarness();
    const twitch = new MockTwitchProvider();
    const kick = new MockKickProvider();
    const x = new MockXProvider();
    manager.register(twitch);
    manager.register(kick);
    manager.register(x);
    await manager.startAll();

    twitch.emitMockMessage({ sourceMessageId: '1', sessionId: 's1', ownerId: 'o1', ownerName: 'Creator', username: 't-user', text: 'from twitch' });
    kick.emitMockMessage({ sourceMessageId: '2', sessionId: 's1', ownerId: 'o1', ownerName: 'Creator', username: 'k-user', text: 'from kick' });
    x.emitMockMessage({ sourceMessageId: '3', sessionId: 's1', ownerId: 'o1', ownerName: 'Creator', username: 'x-user', text: 'from x' });
    await router.flush();

    expect(feeds.getFeed('s1').map((message) => message.platform)).toEqual(['twitch', 'kick', 'x']);
    expect(feeds.getFeed('s1').map((message) => message.message)).toEqual(['from twitch', 'from kick', 'from x']);
  });

  it('isolates concurrent session feeds', async () => {
    const { feeds, router, manager } = createHarness();
    const twitch = new MockTwitchProvider();
    manager.register(twitch);
    await manager.startAll();

    twitch.emitMockMessage({ sourceMessageId: 'a', sessionId: 'session-a', ownerId: 'owner-a', ownerName: 'A', username: 'viewer', text: 'A1' });
    twitch.emitMockMessage({ sourceMessageId: 'b', sessionId: 'session-b', ownerId: 'owner-b', ownerName: 'B', username: 'viewer', text: 'B1' });
    twitch.emitMockMessage({ sourceMessageId: 'c', sessionId: 'session-a', ownerId: 'owner-a', ownerName: 'A', username: 'viewer', text: 'A2' });
    await router.flush();

    expect(feeds.getFeed('session-a').map((message) => message.message)).toEqual(['A1', 'A2']);
    expect(feeds.getFeed('session-b').map((message) => message.message)).toEqual(['B1']);
  });

  it('keeps provider failures isolated from healthy providers', async () => {
    const { manager } = createHarness();
    manager.register(new FailingMockProvider('bad-provider', 'twitch'));
    manager.register(new MockKickProvider('healthy-kick'));

    await manager.startAll();

    expect(manager.isFailed('bad-provider')).toBe(true);
    expect(manager.activeProviderNames()).toEqual(['healthy-kick']);
  });
});

describe('queue resilience', () => {
  it('stress-routes queued messages without dropping them', async () => {
    const { feeds, router, manager } = createHarness(1500);
    const twitch = new MockTwitchProvider();
    manager.register(twitch);
    await manager.startAll();

    for (let index = 0; index < 1000; index += 1) {
      twitch.emitMockMessage({
        sourceMessageId: String(index),
        sessionId: 'stress-session',
        ownerId: 'owner',
        ownerName: 'Creator',
        username: `viewer-${index}`,
        text: `message-${index}`,
      });
    }

    await router.flush();

    const feed = feeds.getFeed('stress-session');
    expect(feed).toHaveLength(1000);
    expect(feed[0]?.message).toBe('message-0');
    expect(feed[999]?.message).toBe('message-999');
  });

  it('enforces feed message limits per session', async () => {
    const { feeds, router, manager } = createHarness(2);
    const twitch = new MockTwitchProvider();
    manager.register(twitch);
    await manager.startAll();

    for (let index = 0; index < 3; index += 1) {
      twitch.emitMockMessage({ sourceMessageId: String(index), sessionId: 'limited', ownerId: 'owner', ownerName: 'Creator', username: 'viewer', text: `m${index}` });
    }
    await router.flush();

    expect(feeds.getFeed('limited').map((message) => message.message)).toEqual(['m1', 'm2']);
  });
});
