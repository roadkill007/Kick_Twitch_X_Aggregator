import type { RawProviderMessage, UnifiedMessage } from './types.js';

export function normalizeMessage(raw: RawProviderMessage): UnifiedMessage {
  return {
    id: `${raw.platform}:${raw.sourceMessageId}`,
    sessionId: raw.sessionId,
    ownerId: raw.ownerId,
    ownerName: raw.ownerName,
    platform: raw.platform,
    username: raw.username,
    message: raw.text,
    timestamp: raw.emittedAt.toISOString(),
  };
}
