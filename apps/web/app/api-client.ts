export function normalizeApiBaseUrl(value: string | undefined): string {
  const raw = value?.trim() || 'http://localhost:3001';
  return raw.replace(/\/+$/, '');
}

export function resolveApiBaseUrl(configured: string | undefined, locationOrigin?: string): string {
  if (configured?.trim()) return normalizeApiBaseUrl(configured);
  if (locationOrigin) {
    const url = new URL(locationOrigin);
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
      url.port = '3001';
      return normalizeApiBaseUrl(url.toString());
    }
  }
  return normalizeApiBaseUrl(undefined);
}

export function getApiBaseUrl(): string {
  return resolveApiBaseUrl(
    process.env.NEXT_PUBLIC_API_BASE_URL,
    typeof window === 'undefined' ? undefined : window.location.origin,
  );
}

export const API_BASE_URL = normalizeApiBaseUrl(process.env.NEXT_PUBLIC_API_BASE_URL);

export function createOverlayWebSocketUrl(apiBaseUrl: string, sessionId: string, token: string): string {
  const url = new URL('/api/v1/overlay/ws', normalizeApiBaseUrl(apiBaseUrl));
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('sessionId', sessionId);
  url.searchParams.set('token', token);
  return url.toString();
}

export function buildAuthHeaders(token: string): Record<string, string> {
  const trimmed = token.trim();
  return trimmed ? { authorization: `Bearer ${trimmed}` } : {};
}

export async function apiRequest<T>(path: string, options: { token?: string; method?: string; body?: unknown } = {}): Promise<T> {
  const init: RequestInit = {
    method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
    headers: {
      'content-type': 'application/json',
      ...(options.token ? buildAuthHeaders(options.token) : {}),
    },
  };
  if (options.body !== undefined) init.body = JSON.stringify(options.body);

  const response = await fetch(`${getApiBaseUrl()}${path}`, init);

  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(data.error ?? data.message ?? `Request failed: ${response.status}`);
  }
  return data as T;
}
