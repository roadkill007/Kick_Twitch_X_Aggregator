import { describe, expect, it } from 'vitest';
import { createLogEvent, redactLogMetadata, serializeLogEvent } from './index.js';

describe('structured logging', () => {
  it('creates JSON-serializable structured log events', () => {
    const event = createLogEvent({ level: 'info', message: 'hello', requestId: 'req-1', metadata: { route: '/health/live' }, timestamp: '2026-01-01T00:00:00.000Z' });

    expect(JSON.parse(serializeLogEvent(event))).toMatchObject({
      level: 'info',
      message: 'hello',
      requestId: 'req-1',
      metadata: { route: '/health/live' },
      timestamp: '2026-01-01T00:00:00.000Z',
    });
  });

  it('redacts sensitive metadata keys before logging', () => {
    expect(redactLogMetadata({ token: 'abc', passwordHash: 'hash', safe: 'value' })).toEqual({
      token: '[REDACTED]',
      passwordHash: '[REDACTED]',
      safe: 'value',
    });
  });
});
