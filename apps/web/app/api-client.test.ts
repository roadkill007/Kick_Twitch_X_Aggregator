import { describe, expect, it } from 'vitest';
import { buildApiRequestInit, buildAuthHeaders, createOverlayWebSocketUrl, normalizeApiBaseUrl, resolveApiBaseUrl } from './api-client';

describe('Level 4 web API client helpers', () => {
  it('normalizes API base URLs without trailing slashes', () => {
    expect(normalizeApiBaseUrl('https://example.com///')).toBe('https://example.com');
    expect(normalizeApiBaseUrl(undefined)).toBe('http://localhost:3001');
  });

  it('resolves local web origins to the local API port when no configured URL exists', () => {
    expect(resolveApiBaseUrl(undefined, 'http://localhost:3000')).toBe('http://localhost:3001');
    expect(resolveApiBaseUrl('https://api.example.com/', 'http://localhost:3000')).toBe('https://api.example.com');
  });

  it('builds bearer headers only when a token exists', () => {
    expect(buildAuthHeaders('abc')).toEqual({ authorization: 'Bearer abc' });
    expect(buildAuthHeaders('')).toEqual({});
  });

  it('creates OBS overlay WebSocket URLs from API base URLs', () => {
    expect(createOverlayWebSocketUrl('https://api.example.com', 'session-id', 'token value')).toBe(
      'wss://api.example.com/api/v1/overlay/ws?sessionId=session-id&token=token+value',
    );
    expect(createOverlayWebSocketUrl('http://localhost:3001', 'session-id', 'token')).toBe(
      'ws://localhost:3001/api/v1/overlay/ws?sessionId=session-id&token=token',
    );
  });


  it('builds JSON request headers only when a body is present', () => {
    const postWithoutBody = buildApiRequestInit({ token: 'abc', method: 'POST' });
    expect(postWithoutBody.method).toBe('POST');
    expect(postWithoutBody.headers).toEqual({ authorization: 'Bearer abc' });
    expect(postWithoutBody.body).toBeUndefined();

    const postWithBody = buildApiRequestInit({ token: 'abc', body: { ok: true } });
    expect(postWithBody.method).toBe('POST');
    expect(postWithBody.headers).toEqual({ 'content-type': 'application/json', authorization: 'Bearer abc' });
    expect(postWithBody.body).toBe('{"ok":true}');
  });

});
