import { describe, expect, it } from 'vitest';
import { resolveBackendEndpoints, shouldStartLocalBackend } from '@/common/adapter/backendEndpoint';

describe('resolveBackendEndpoints', () => {
  it('uses the local Core port when no remote URL is configured', () => {
    expect(resolveBackendEndpoints({ port: 23456 })).toEqual({
      baseUrl: 'http://127.0.0.1:23456',
      wsUrl: 'ws://127.0.0.1:23456/ws',
      remote: false,
    });
  });

  it('normalizes remote HTTP URLs and derives the WebSocket URL', () => {
    expect(resolveBackendEndpoints({ remoteUrl: 'http://core.example:25808/' })).toEqual({
      baseUrl: 'http://core.example:25808',
      wsUrl: 'ws://core.example:25808/ws',
      remote: true,
    });
  });

  it('uses secure WebSocket for HTTPS Core endpoints', () => {
    expect(resolveBackendEndpoints({ remoteUrl: 'https://core.example' })).toMatchObject({
      baseUrl: 'https://core.example',
      wsUrl: 'wss://core.example/ws',
      remote: true,
    });
  });

  it('rejects credentials, paths, query strings, and non-HTTP schemes', () => {
    for (const remoteUrl of [
      'ftp://core.example',
      'http://user:pass@core.example',
      'http://core.example/prefix',
      'http://core.example?token=x',
    ]) {
      expect(() => resolveBackendEndpoints({ remoteUrl })).toThrow();
    }
  });
});

describe('shouldStartLocalBackend', () => {
  it('starts local Core when no remote URL is configured', () => {
    expect(shouldStartLocalBackend(undefined)).toBe(true);
    expect(shouldStartLocalBackend('  ')).toBe(true);
  });

  it('skips local Core when a remote URL is configured', () => {
    expect(shouldStartLocalBackend('https://core.example')).toBe(false);
  });
});
