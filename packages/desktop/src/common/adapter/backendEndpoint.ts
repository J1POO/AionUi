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

export function getConfiguredRemoteCoreUrl(): string | undefined {
  if (typeof window !== 'undefined' && window.__remoteCoreUrl) return window.__remoteCoreUrl;
  return (globalThis as typeof globalThis & { __remoteCoreUrl?: string }).__remoteCoreUrl;
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
