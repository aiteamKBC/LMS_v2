import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  installSessionExpiryHandler,
  resetSessionExpiryNotice,
} from '../sessionExpiry';

/**
 * The behaviour worth pinning is not "does it see a 401" but the three ways it
 * could go wrong in the app: signing people out on a 401 that means something
 * else, signing them out twelve times at once, and eating a response body on
 * the way past.
 */
describe('installSessionExpiryHandler', () => {
  let uninstall: (() => void) | null = null;
  let respondWith: (url: string) => Response;

  beforeEach(() => {
    resetSessionExpiryNotice();
    respondWith = () => new Response('{}', { status: 200 });
    window.fetch = vi.fn((input: RequestInfo | URL) =>
      Promise.resolve(respondWith(String(input))),
    ) as unknown as typeof window.fetch;
  });

  afterEach(() => {
    uninstall?.();
    uninstall = null;
  });

  function install() {
    const onExpired = vi.fn();
    uninstall = installSessionExpiryHandler(onExpired);
    return onExpired;
  }

  it('reports a 401 from a gated API', async () => {
    respondWith = () => new Response('{}', { status: 401 });
    const onExpired = install();

    await window.fetch('/curriculum_api/curriculum/overview/');

    expect(onExpired).toHaveBeenCalledTimes(1);
  });

  it('ignores a 401 from the sign-in API', async () => {
    // apiMe 401s on every page load for a signed-out visitor, and a wrong
    // password 401s too. Neither means a live session has ended.
    respondWith = () => new Response('{}', { status: 401 });
    const onExpired = install();

    await window.fetch('/login_api/me/');
    await window.fetch('/login_api/login/');

    expect(onExpired).not.toHaveBeenCalled();
  });

  it('ignores a 403, which means the role is wrong, not the session', async () => {
    respondWith = () => new Response('{}', { status: 403 });
    const onExpired = install();

    await window.fetch('/curriculum_api/curriculum/overview/');

    expect(onExpired).not.toHaveBeenCalled();
  });

  it('reports once when a page fires many requests at once', async () => {
    respondWith = () => new Response('{}', { status: 401 });
    const onExpired = install();

    await Promise.all(
      Array.from({ length: 12 }, () => window.fetch('/coach_api/coach/caseload/')),
    );

    expect(onExpired).toHaveBeenCalledTimes(1);
  });

  it('re-arms after a fresh sign-in', async () => {
    respondWith = () => new Response('{}', { status: 401 });
    const onExpired = install();

    await window.fetch('/coach_api/coach/caseload/');
    resetSessionExpiryNotice();
    await window.fetch('/coach_api/coach/caseload/');

    expect(onExpired).toHaveBeenCalledTimes(2);
  });

  it('hands the response back untouched', async () => {
    respondWith = () => new Response('{"cohorts":[]}', { status: 200 });
    install();

    const response = await window.fetch('/curriculum_api/curriculum/overview/');

    // The wrapper reads only `status`; a `clone()` slip here would leave the
    // caller with an already-consumed body.
    expect(await response.json()).toEqual({ cohorts: [] });
  });

  it('restores the original fetch on uninstall', async () => {
    const before = window.fetch;
    const off = installSessionExpiryHandler(vi.fn());
    expect(window.fetch).not.toBe(before);
    off();
    expect(window.fetch).toBe(before);
  });
});
