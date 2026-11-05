/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { httpGet, httpPost, resolveCoreCsrfToken } from '@/common/adapter/httpBridge';

const clearCsrfCookie = (): void => {
  document.cookie = 'aionui-csrf-token=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
};

const jsonResponse = (payload: unknown): Response =>
  new Response(JSON.stringify({ data: payload }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

describe('Core CSRF double-submit', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    clearCsrfCookie();
  });

  it('reads the readable aionui-csrf-token cookie', () => {
    document.cookie = 'aionui-csrf-token=abc123; path=/';
    expect(resolveCoreCsrfToken()).toBe('abc123');
  });

  it('returns an empty string when the cookie is absent', () => {
    expect(resolveCoreCsrfToken()).toBe('');
  });

  it('attaches x-csrf-token to state-changing requests', async () => {
    document.cookie = 'aionui-csrf-token=tok-1; path=/';
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchSpy);
    vi.spyOn(console, 'debug').mockImplementation(() => {});

    await httpPost('/api/x').invoke({ k: 'v' });

    expect(fetchSpy.mock.calls[0][1]?.headers).toMatchObject({ 'x-csrf-token': 'tok-1' });
  });

  it('does not attach the header to safe (GET) requests', async () => {
    document.cookie = 'aionui-csrf-token=tok-1; path=/';
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchSpy);
    vi.spyOn(console, 'debug').mockImplementation(() => {});

    await httpGet('/api/x').invoke();

    const headers = (fetchSpy.mock.calls[0][1]?.headers ?? {}) as Record<string, string>;
    expect(headers).not.toHaveProperty('x-csrf-token');
  });
});
