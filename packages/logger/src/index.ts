export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEvent {
  level: LogLevel;
  message: string;
  requestId?: string;
  metadata?: Record<string, unknown>;
  timestamp: string;
}

export function createLogEvent(input: Omit<LogEvent, 'timestamp'> & { timestamp?: string }): LogEvent {
  return {
    ...input,
    timestamp: input.timestamp ?? new Date().toISOString(),
  };
}

export function serializeLogEvent(event: LogEvent): string {
  return JSON.stringify(event);
}

export function redactLogMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    redacted[key] = /password|token|secret/i.test(key) ? '[REDACTED]' : value;
  }
  return redacted;
}
