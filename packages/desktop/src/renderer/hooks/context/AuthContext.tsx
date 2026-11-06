import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { PREVIEW_SCOPE_KEY_PREFIX } from '@/renderer/pages/conversation/Preview/context/previewScope';
import { refreshSession } from '@/common/adapter/sessionRefresh';
import { getBaseUrl, reconnectRealtime, resolveCoreCsrfToken } from '@/common/adapter/httpBridge';
import { getConfiguredRemoteCoreUrl } from '@/common/adapter/backendEndpoint';
import {
  REMOTE_AUTH_EXPIRED_EVENT,
  clearRemoteToken,
  getRemoteToken,
  setRemoteToken,
  syncRemoteTokenToMain,
} from '@/common/adapter/remoteAuth';

/**
 * Double-submit CSRF: the Core accepts a state-changing request only when this
 * header equals the readable `aionui-csrf-token` cookie. Login is exempt, but
 * logout and other account calls are not, so every browser-side write attaches
 * the header when the cookie is present.
 */
const csrfHeader = (): Record<string, string> => {
  const token = resolveCoreCsrfToken();
  return token ? { 'x-csrf-token': token } : {};
};
const withCsrfToken = <T extends Record<string, unknown>>(data: T): T => data;
const hasValidCsrfToken = (): boolean => Boolean(resolveCoreCsrfToken());
const clearCookie = (_name: string, _path?: string): void => {};
const CSRF_COOKIE_NAME = 'aionui-csrf-token';

type AuthStatus = 'checking' | 'authenticated' | 'unauthenticated';

export interface AuthUser {
  id: string;
  username: string;
}

interface LoginParams {
  username: string;
  password: string;
  remember?: boolean;
}

type LoginErrorCode =
  | 'invalidCredentials'
  | 'tooManyAttempts'
  | 'serverError'
  | 'networkError'
  | 'csrfError'
  | 'unknown';

interface LoginResult {
  success: boolean;
  message?: string;
  code?: LoginErrorCode;
  shouldClearCache?: boolean;
}

interface AuthContextValue {
  ready: boolean;
  user: AuthUser | null;
  status: AuthStatus;
  login: (params: LoginParams) => Promise<LoginResult>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  clearAuthCache: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const AUTH_USER_ENDPOINT = '/api/auth/user';

const isDesktopRuntime = typeof window !== 'undefined' && Boolean(window.electronAPI);

/**
 * A desktop client pointed at a remote Core must authenticate like a browser
 * client, but with an explicit bearer token instead of a cross-site cookie.
 */
const isRemoteCoreMode = Boolean(getConfiguredRemoteCoreUrl());

/** Auth request shape for the current runtime mode. */
function buildAuthRequest(): { url: string; credentials: RequestCredentials; headers: Record<string, string> } {
  if (isRemoteCoreMode) {
    const token = getRemoteToken();
    return {
      url: `${getBaseUrl()}${AUTH_USER_ENDPOINT}`,
      credentials: 'omit',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    };
  }
  return { url: AUTH_USER_ENDPOINT, credentials: 'include', headers: {} };
}

// Clear expired auth cache including cookies and localStorage
// 清除过期的认证缓存，包括 Cookie 和 localStorage
function clearAuthCache(): void {
  if (typeof window === 'undefined') return;

  try {
    // Clear CSRF cookie
    clearCookie(CSRF_COOKIE_NAME);
    clearCookie(CSRF_COOKIE_NAME, '/');

    // Clear localStorage auth-related items, plus per-user UI state that must not
    // leak across accounts. Preview scopes are keyed by project id and hold file
    // content, so leaving them behind would show the next user the previous one's
    // open tabs — and nothing else ever cleaned them up.
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (
        key &&
        (key.includes('auth') ||
          key.includes('csrf') ||
          key.includes('token') ||
          key.startsWith(PREVIEW_SCOPE_KEY_PREFIX))
      ) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((key) => localStorage.removeItem(key));
  } catch (error) {
    console.error('Failed to clear auth cache:', error);
  }
}

async function fetchCurrentUser(signal?: AbortSignal): Promise<AuthUser | null> {
  try {
    const auth = buildAuthRequest();
    let response = await fetch(auth.url, {
      method: 'GET',
      credentials: auth.credentials,
      headers: auth.headers,
      signal,
    });

    // The access cookie may have expired — attempt one silent session refresh
    // and re-check before concluding the user is unauthenticated. Without this
    // the status poll would kick a refreshable session to /login (#4124).
    // refreshSession() single-flights with the httpBridge refresh path.
    // Remote bearer sessions have no cookie-based refresh; a 401 is final.
    if (response.status === 401 && !isRemoteCoreMode) {
      const refreshed = await refreshSession();
      if (refreshed) {
        response = await fetch(auth.url, {
          method: 'GET',
          credentials: auth.credentials,
          headers: auth.headers,
          signal,
        });
      }
    }

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as {
      success: boolean;
      user?: AuthUser;
    };
    if (data.success && data.user) {
      return data.user;
    }
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      return null;
    }
    console.error('Failed to fetch current user:', error);
  }

  return null;
}

export const AuthProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [status, setStatus] = useState<AuthStatus>('checking');
  const [ready, setReady] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    // Local desktop mode has no login; a remote Core authenticates every client.
    if (isDesktopRuntime && !isRemoteCoreMode) {
      setStatus('authenticated');
      setUser(null);
      setReady(true);
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setStatus('checking');

    const currentUser = await fetchCurrentUser(controller.signal);
    if (currentUser) {
      setUser(currentUser);
      setStatus('authenticated');
    } else {
      setUser(null);
      setStatus('unauthenticated');
    }
    setReady(true);
  }, []);

  useEffect(() => {
    // Main-process header injection (iframe/media/downloads) needs the token
    // that was persisted by a previous session.
    if (isRemoteCoreMode) syncRemoteTokenToMain();
    void refresh();
    return () => {
      abortRef.current?.abort();
    };
  }, [refresh]);

  // httpBridge clears the bearer token on 401 / WS policy-violation and fires
  // this event; drop back to the login screen instead of spinning on a dead session.
  useEffect(() => {
    if (!isRemoteCoreMode) return;
    const onExpired = (): void => {
      setUser(null);
      setStatus('unauthenticated');
      setReady(true);
    };
    window.addEventListener(REMOTE_AUTH_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(REMOTE_AUTH_EXPIRED_EVENT, onExpired);
  }, []);

  const login = useCallback(async ({ username, password, remember }: LoginParams): Promise<LoginResult> => {
    try {
      if (isDesktopRuntime && !isRemoteCoreMode) {
        setReady(true);
        return { success: true };
      }

      // Check CSRF token availability before login
      // If token is missing, clear cache and inform user
      const csrfTokenValid = !isRemoteCoreMode && hasValidCsrfToken();
      if (!isRemoteCoreMode && !csrfTokenValid) {
        console.warn('CSRF token missing or invalid, clearing cache');
        clearAuthCache();
        // Allow login to proceed anyway - server will set new token
      }

      // P1 安全修复：登录请求需要 CSRF Token / P1 Security fix: Login needs CSRF token
      // Backend route is /login; web-host's static-server explicitly proxies it.
      // Remote mode: /login is CSRF-exempt on the Core and there is no readable
      // cookie in a file:// renderer, so post directly to the remote origin.
      const response = await fetch(isRemoteCoreMode ? `${getBaseUrl()}/login` : '/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...csrfHeader(),
        },
        credentials: isRemoteCoreMode ? 'omit' : 'include',
        body: JSON.stringify(withCsrfToken({ username, password, remember })),
      });

      const data = (await response.json()) as {
        success: boolean;
        message?: string;
        user?: AuthUser;
        token?: string;
      };

      if (!response.ok || !data.success || !data.user) {
        let code: LoginErrorCode = 'unknown';
        let message = data?.message ?? 'Login failed';
        let shouldClearCache = false;

        if (response.status === 401) {
          code = 'invalidCredentials';
        } else if (response.status === 403) {
          // CSRF validation failed - clear cache
          code = 'csrfError';
          message = 'Security token expired. Please try again.';
          shouldClearCache = true;
        } else if (response.status === 429) {
          code = 'tooManyAttempts';
        } else if (response.status >= 500) {
          code = 'serverError';
        } else if (!csrfTokenValid) {
          // If we knew CSRF was invalid and login failed, suggest cache clear
          code = 'csrfError';
          message = 'Login failed due to cached data. Please clear your browser cache and try again.';
          shouldClearCache = true;
        }

        // Clear cache on CSRF-related errors
        if (shouldClearCache) {
          clearAuthCache();
        }

        return {
          success: false,
          message,
          code,
          shouldClearCache,
        };
      }

      if (isRemoteCoreMode && data.token) {
        setRemoteToken(data.token);
      }
      setUser(data.user);
      setStatus('authenticated');
      setReady(true);

      // Re-enable WebSocket reconnection after successful login (WebUI mode only)
      if (typeof window !== 'undefined' && (window as any).__websocketReconnect) {
        (window as any).__websocketReconnect();
      }
      // Desktop remote mode: the realtime socket was held back until a token
      // existed; connect it now so events stream without a reload.
      if (isRemoteCoreMode) {
        reconnectRealtime();
      }

      return { success: true };
    } catch (error) {
      console.error('Login request failed:', error);

      // Check if error is related to CSRF token parsing
      const errorMessage = (error as Error).message;
      if (errorMessage?.includes('parse') || errorMessage?.includes('csrf') || errorMessage?.includes('cookie')) {
        // CSRF or cookie parsing error - clear cache
        clearAuthCache();
        return {
          success: false,
          message: 'Login failed due to cached data. Please clear your browser cache and try again.',
          code: 'csrfError',
          shouldClearCache: true,
        };
      }

      return {
        success: false,
        message: 'Network error. Please try again.',
        code: 'networkError',
      };
    }
  }, []);

  const logout = useCallback(async () => {
    if (isDesktopRuntime && !isRemoteCoreMode) {
      setUser(null);
      setStatus('authenticated');
      setReady(true);
      return;
    }

    try {
      const token = isRemoteCoreMode ? getRemoteToken() : null;
      await fetch(isRemoteCoreMode ? `${getBaseUrl()}/logout` : '/logout', {
        method: 'POST',
        // Logout also needs CSRF token / 登出同样需要 CSRF Token
        // Remote mode authenticates with the bearer token, which the Core
        // exempts from the CSRF double-submit check.
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...csrfHeader(),
        },
        credentials: isRemoteCoreMode ? 'omit' : 'include',
        body: JSON.stringify(withCsrfToken({})),
      });
    } catch (error) {
      console.error('Logout request failed:', error);
    } finally {
      clearRemoteToken();
      setUser(null);
      setStatus('unauthenticated');
      // Clear cache on logout for security
      clearAuthCache();
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      ready,
      user,
      status,
      login,
      logout,
      refresh,
      clearAuthCache,
    }),
    [login, logout, ready, refresh, status, user]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
