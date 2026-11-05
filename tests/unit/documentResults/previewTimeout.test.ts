import { afterEach, describe, expect, it, vi } from 'vitest';
import { withPreviewTimeout } from '@/renderer/utils/previewError';

describe('preview startup deadline', () => {
  afterEach(() => vi.useRealTimers());
  it('rejects a stalled startup instead of leaving an endless spinner', async () => {
    vi.useFakeTimers();
    const pending = withPreviewTimeout(new Promise<never>(() => {}), 100);
    const check = expect(pending).rejects.toThrow('OFFICECLI_PORT_TIMEOUT');
    await vi.advanceTimersByTimeAsync(100);
    await check;
    expect(vi.getTimerCount()).toBe(0);
  });
  it('cleans up its deadline on success and failure', async () => {
    vi.useFakeTimers();
    expect(await withPreviewTimeout(Promise.resolve('ready'), 100)).toBe('ready');
    await expect(withPreviewTimeout(Promise.reject(new Error('failed')), 100)).rejects.toThrow('failed');
    expect(vi.getTimerCount()).toBe(0);
  });
});
