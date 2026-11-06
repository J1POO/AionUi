/**
 * Remote-Core credentials for the desktop client.
 *
 * A remote Core authenticates with an explicit bearer token, never with the
 * browser session cookie: the renderer runs from `file://`, so a cross-site
 * cookie would be dropped by SameSite and could not be read for CSRF anyway.
 * The token is an access token (about 30 days) returned by `POST /login`.
 */

export const REMOTE_TOKEN_KEY = 'aionui.remote.token';
export const REMOTE_AUTH_EXPIRED_EVENT = 'aionui:remote-auth-expired';

export function getRemoteToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(REMOTE_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setRemoteToken(token: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(REMOTE_TOKEN_KEY, token);
  } catch {
    /* Storage can be unavailable; callers keep working with the in-memory token. */
  }
  sendTokenToMain(token);
}

export function clearRemoteToken(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(REMOTE_TOKEN_KEY);
  } catch {
    /* ignore */
  }
  sendTokenToMain(null);
}

/** Push the persisted token to the main process (for header injection). */
export function syncRemoteTokenToMain(): void {
  if (typeof window === 'undefined') return;
  sendTokenToMain(getRemoteToken());
}

function sendTokenToMain(token: string | null): void {
  const api = (window as Window & { electronAPI?: { remoteAuthSetToken?: (value: string | null) => Promise<void> } })
    .electronAPI;
  if (!api?.remoteAuthSetToken) return;
  void api.remoteAuthSetToken(token).catch(() => {
    /* main process may not be ready yet; a later sync retries */
  });
}

/** Notify the auth layer that the remote session is gone (401 or WS 1008). */
export function notifyRemoteAuthExpired(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(REMOTE_AUTH_EXPIRED_EVENT));
}
