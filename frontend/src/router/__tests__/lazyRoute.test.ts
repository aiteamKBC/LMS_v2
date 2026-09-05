import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearStaleChunkMarker, isStaleChunkError, lazyRoute, recoverFromStaleChunk } from '../lazyRoute';

// ---------------------------------------------------------------------------
// A deploy renames every chunk. A tab that was already open still asks for the
// old names, so the first navigation after a deploy fails on a file that no
// longer exists — the page itself is fine, and a reload picks up the current
// names. That is worth doing silently, but only once: a chunk missing for any
// other reason must not put the reader in a reload loop.
// ---------------------------------------------------------------------------

const PAGE = '/learner/materials';

describe('isStaleChunkError', () => {
  it.each([
    'Failed to fetch dynamically imported module: https://x/assets/page-CJhiZm5j.js',
    'error loading dynamically imported module',
    'Importing a module script failed.',
    'ChunkLoadError: Loading chunk 42 failed',
    'Unable to preload CSS for /assets/page.css',
  ])('recognises %s', (message) => {
    expect(isStaleChunkError(new Error(message))).toBe(true);
  });

  it('does not claim an ordinary render error', () => {
    expect(isStaleChunkError(new Error('Cannot read properties of undefined'))).toBe(false);
    expect(isStaleChunkError(null)).toBe(false);
  });
});

describe('recoverFromStaleChunk', () => {
  const reload = vi.fn();

  beforeEach(() => {
    reload.mockClear();
    window.sessionStorage.clear();
    vi.stubGlobal('location', { pathname: PAGE, href: `https://lms.kentbusinesscollege.org${PAGE}`, reload });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reloads the page so the current chunk names are fetched', () => {
    expect(recoverFromStaleChunk(PAGE)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('refuses a second reload for the same page', () => {
    // Otherwise a chunk that is genuinely gone — a broken deploy — flickers for
    // ever with nothing the reader can read.
    recoverFromStaleChunk(PAGE);
    reload.mockClear();

    expect(recoverFromStaleChunk(PAGE)).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it('still recovers a different page whose chunk is also stale', () => {
    recoverFromStaleChunk(PAGE);
    reload.mockClear();

    expect(recoverFromStaleChunk('/learner/progress')).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('recovers again once a page has rendered, for the next deploy', () => {
    recoverFromStaleChunk(PAGE);
    reload.mockClear();
    // What the router does after a successful render.
    clearStaleChunkMarker();

    expect(recoverFromStaleChunk(PAGE)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('reloads even where sessionStorage is refused', () => {
    // Private windows and blocked site data throw on access; a tab that cannot
    // remember is still better off reloading than showing an error for a page
    // that exists.
    const throwing = () => { throw new Error('blocked'); };
    vi.spyOn(window.sessionStorage, 'getItem').mockImplementation(throwing);
    vi.spyOn(window.sessionStorage, 'setItem').mockImplementation(throwing);

    expect(recoverFromStaleChunk(PAGE)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});


describe('lazyRoute, as the router actually wires it', () => {
  const reload = vi.fn();

  beforeEach(() => {
    reload.mockClear();
    window.sessionStorage.clear();
    vi.stubGlobal('location', { pathname: PAGE, href: `https://x${PAGE}`, reload });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const staleChunk = () => new Error(
    'Failed to fetch dynamically imported module: https://x/assets/page-CJhiZm5j.js',
  );

  /** What React does with the lazy component: call the loader, await it. */
  const load = (component: ReturnType<typeof lazyRoute>) => (
    (component as unknown as { _payload: { _result: () => Promise<unknown> } })._payload._result()
  );

  it('reloads exactly once when the chunk is missing every time', async () => {
    // The regression this guards: the marker used to be cleared by an effect on
    // the router, which runs while the *skeleton* is on screen — before the
    // retry could fail. A chunk missing for good then reloaded for ever.
    const loader = vi.fn().mockRejectedValue(staleChunk());
    const first = load(lazyRoute(loader));
    first.catch(() => {});
    await vi.advanceTimersByTimeAsync(0);
    // Still waiting: the page is being replaced, so the loader must not settle.
    await expect(Promise.race([first, Promise.resolve('pending')])).resolves.toBe('pending');
    expect(reload).toHaveBeenCalledTimes(1);

    // The reload happens; the tab comes back and the chunk is still gone.
    const second = load(lazyRoute(loader));

    await expect(second).rejects.toThrow(/Failed to fetch/);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('gives up on a reload that never arrives, rather than holding the skeleton', async () => {
    const loader = vi.fn().mockRejectedValue(staleChunk());
    const pending = load(lazyRoute(loader));
    const settled = expect(pending).rejects.toThrow(/Failed to fetch/);

    await vi.advanceTimersByTimeAsync(5000);

    await settled;
  });

  it('clears the marker when a chunk arrives, so the next deploy recovers too', async () => {
    const stale = vi.fn().mockRejectedValue(staleChunk());
    // The loader rejects on a microtask, so the recovery has not run yet when
    // load() returns — flush before asserting on it.
    load(lazyRoute(stale)).catch(() => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(window.sessionStorage.getItem('lms:chunk-reload')).toBe(PAGE);

    // The reloaded tab fetches the current chunk successfully.
    const good = vi.fn().mockResolvedValue({ default: () => null });
    await load(lazyRoute(good));

    expect(window.sessionStorage.getItem('lms:chunk-reload')).toBeNull();
    // So a later deploy is recovered from as silently as the first.
    reload.mockClear();
    load(lazyRoute(stale)).catch(() => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('leaves an ordinary import failure to the error boundary', async () => {
    const loader = vi.fn().mockRejectedValue(new Error('Cannot read properties of undefined'));

    await expect(load(lazyRoute(loader))).rejects.toThrow(/Cannot read properties/);
    expect(reload).not.toHaveBeenCalled();
  });
});
