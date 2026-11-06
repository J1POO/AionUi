import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  REMOTE_AUTH_EXPIRED_EVENT,
  clearRemoteToken,
  getRemoteToken,
  notifyRemoteAuthExpired,
  setRemoteToken,
} from '@/common/adapter/remoteAuth';

describe('remoteAuth token store', () => {
  afterEach(() => {
    clearRemoteToken();
    vi.restoreAllMocks();
  });

  it('round-trips a token through localStorage', () => {
    expect(getRemoteToken()).toBeNull();
    setRemoteToken('tok-1');
    expect(getRemoteToken()).toBe('tok-1');
    clearRemoteToken();
    expect(getRemoteToken()).toBeNull();
  });

  it('dispatches the auth-expired event', () => {
    const listener = vi.fn();
    window.addEventListener(REMOTE_AUTH_EXPIRED_EVENT, listener);
    notifyRemoteAuthExpired();
    window.removeEventListener(REMOTE_AUTH_EXPIRED_EVENT, listener);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
