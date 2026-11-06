export interface BackendEndpoints {
  baseUrl: string;
  wsUrl: string;
  remote: boolean;
}

declare global {
  interface Window {
    __remoteCoreUrl?: string;
  }
}

export const REMOTE_SERVER_STORAGE_KEY = 'aionui.remote.server';

export function getConfiguredRemoteCoreUrl(): string | undefined {
  // A per-user server override saved from the login screen wins over the
  // build-time/env default, so one zip can point at different Cores.
  if (typeof window !== 'undefined') {
    try {
      const saved = window.localStorage.getItem(REMOTE_SERVER_STORAGE_KEY);
      if (saved) return normalizeRemoteCoreUrl(saved);
    } catch {
      /* ignore malformed or unavailable storage */
    }
    if (window.__remoteCoreUrl) return window.__remoteCoreUrl;
  }
  return (globalThis as typeof globalThis & { __remoteCoreUrl?: string }).__remoteCoreUrl;
}

/** Persist the user-selected Core origin; `null` restores the built-in default. */
export function setConfiguredRemoteCoreUrl(value: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (value) window.localStorage.setItem(REMOTE_SERVER_STORAGE_KEY, normalizeRemoteCoreUrl(value));
    else window.localStorage.removeItem(REMOTE_SERVER_STORAGE_KEY);
  } catch {
    /* ignore storage failures; login will surface a connection error */
  }
}

export function shouldStartLocalBackend(remoteUrl?: string): boolean {
  return !remoteUrl?.trim();
}

export function normalizeRemoteCoreUrl(value: string): string {
  const input = value.trim();
  if (!input) throw new Error('Remote Core URL is required');

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error('Remote Core URL must be a valid absolute URL');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Remote Core URL must use HTTP or HTTPS');
  }
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Remote Core URL must contain only scheme, host, and optional port');
  }
  return url.origin;
}

export function resolveBackendEndpoints(options: {
  remoteUrl?: string;
  port?: number;
  webUiBrowser?: boolean;
} = {}): BackendEndpoints {
  if (options.remoteUrl?.trim()) {
    const baseUrl = normalizeRemoteCoreUrl(options.remoteUrl);
    const url = new URL(baseUrl);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.pathname = '/ws';
    return { baseUrl, wsUrl: url.toString(), remote: true };
  }

  if (options.webUiBrowser) {
    return { baseUrl: '', wsUrl: '', remote: false };
  }

  const port = options.port || 13400;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    wsUrl: `ws://127.0.0.1:${port}/ws`,
    remote: false,
  };
}
