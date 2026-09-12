/**
 * One payload, one request.
 *
 * A single wizard page load fired four requests: the board and the ILR, each
 * doubled because React StrictMode mounts every effect twice in dev. The cache
 * has to collapse the duplicates without ever serving data a write has
 * superseded — a stale board is worse than a slow one.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { createCachedResource, clearAllCachedResources } from '../cachedRequest';

beforeEach(() => {
  clearAllCachedResources();
  vi.useRealTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createCachedResource', () => {
  it('revalidates a fresh snapshot once for concurrent background readers', async () => {
    let finish!: (value: string) => void;
    const fetcher = vi.fn().mockResolvedValueOnce('old').mockImplementationOnce(() => new Promise<string>(resolve => { finish = resolve; }));
    const resource = createCachedResource('background-refresh', fetcher);
    await resource.read('125');
    const first = resource.read('125', { revalidate: true });
    const second = resource.read('125', { revalidate: true });
    expect(first).toBe(second);
    expect(resource.peek('125')).toBe('old');
    finish('changed');
    expect(await first).toBe('changed');
    expect(resource.peek('125')).toBe('changed');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it.each(['invalidate', 'prime', 'force'] as const)('keeps a pending old read from overwriting %s', async action => {
    let finish!: (value: string) => void;
    const fetcher = vi.fn().mockImplementationOnce(() => new Promise<string>(resolve => { finish = resolve; })).mockResolvedValue('new');
    const resource = createCachedResource<string>('race', fetcher);
    const stale = resource.read('1');
    if (action === 'invalidate') resource.invalidate('1');
    if (action === 'prime') resource.prime('1', 'new');
    await resource.read('1', { force: action === 'force' });
    finish('old'); await stale;
    expect(resource.peek('1')).toBe('new');
  });
  it('makes one request when the same key is asked for twice at once', async () => {
    // Exactly the StrictMode double-mount: both callers ask before either lands.
    const fetcher = vi.fn().mockResolvedValue({ value: 'board' });
    const resource = createCachedResource('test-a', fetcher);

    const [first, second] = await Promise.all([resource.read('20'), resource.read('20')]);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(first).toEqual({ value: 'board' });
    expect(second).toBe(first);
  });

  it('serves later reads from memory instead of re-requesting', async () => {
    const fetcher = vi.fn().mockResolvedValue({ value: 'ilr' });
    const resource = createCachedResource('test-b', fetcher);

    await resource.read('20');
    await resource.read('20');
    await resource.read('20');

    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('keeps separate learners apart', async () => {
    const fetcher = vi.fn().mockImplementation((key: string) => Promise.resolve({ key }));
    const resource = createCachedResource('test-c', fetcher);

    expect(await resource.read('20')).toEqual({ key: '20' });
    expect(await resource.read('21')).toEqual({ key: '21' });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('re-requests once a write has invalidated the key', async () => {
    const fetcher = vi.fn().mockResolvedValue({ value: 'before' });
    const resource = createCachedResource('test-d', fetcher);

    await resource.read('20');
    resource.invalidate('20');
    fetcher.mockResolvedValue({ value: 'after' });

    expect(await resource.read('20')).toEqual({ value: 'after' });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('serves a primed response without ever calling the network', async () => {
    const fetcher = vi.fn().mockResolvedValue({ value: 'fetched' });
    const resource = createCachedResource('test-e', fetcher);

    // What a save does with the row the server echoed back.
    resource.prime('20', { value: 'saved' });

    expect(await resource.read('20')).toEqual({ value: 'saved' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('never caches a failure', async () => {
    const fetcher = vi.fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValue({ value: 'recovered' });
    const resource = createCachedResource('test-f', fetcher);

    await expect(resource.read('20')).rejects.toThrow('network down');
    // The retry must actually go out — a cached error would strand the page.
    expect(await resource.read('20')).toEqual({ value: 'recovered' });
  });

  it('refetches once the entry has expired', async () => {
    const fetcher = vi.fn().mockResolvedValue({ value: 'v1' });
    const resource = createCachedResource('test-g', fetcher, 1_000);

    await resource.read('20');
    vi.useFakeTimers();
    vi.advanceTimersByTime(1_500);
    await resource.read('20');

    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('goes back to the network when a caller forces it', async () => {
    const fetcher = vi.fn().mockResolvedValue({ value: 'v1' });
    const resource = createCachedResource('test-h', fetcher);

    await resource.read('20');
    await resource.read('20', { force: true });

    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
