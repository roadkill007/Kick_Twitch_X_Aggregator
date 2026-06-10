export const LEVEL_ONE_SCOPE = 'foundation' as const;

export const PLATFORMS = ['twitch', 'kick', 'x'] as const;
export type Platform = (typeof PLATFORMS)[number];

export interface UnifiedMessage {
  id: string;
  sessionId: string;
  ownerId: string;
  ownerName: string;
  platform: Platform;
  username: string;
  message: string;
  timestamp: string;
}

export interface ApiEnvelope<T> {
  data: T;
  requestId: string;
}
