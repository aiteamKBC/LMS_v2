import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  installPerformanceDiagnostics,
  recordPerformanceNavigation,
  resetPerformanceDiagnostics,
} from '../performanceDiagnostics';


describe('performance diagnostics', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let uninstall: () => void;

  beforeEach(() => {
    vi.useFakeTimers();
    resetPerformanceDiagnostics();
    sessionStorage.clear();
    fetchMock = vi.fn().mockResolvedValue(new Response('{}', {
      status: 200,
      headers: {
        'X-LMS-Performance-Diagnostic': '1',
        'X-Request-ID': 'request-1',
        'X-DB-Query-Count': '4',
        'X-LMS-Cache': 'HIT',
        'Server-Timing': 'db;dur=12.5, app;dur=20, total;dur=32.5',
      },
    }));
    vi.stubGlobal('fetch', fetchMock);
    uninstall = installPerformanceDiagnostics();
  });

  afterEach(() => {
    uninstall();
    resetPerformanceDiagnostics();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('records same-origin GET timings after the server opts the account in', async () => {
    recordPerformanceNavigation('/workspace/coach?ignored=yes');
    await fetch('/coach_api/coach/dashboard?owner=private');
    await vi.advanceTimersByTimeAsync(800);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe('/curriculum_api/performance/record/');
    const recordInit = fetchMock.mock.calls[1][1] as RequestInit;
    expect(recordInit.credentials).toBe('include');
    const payload = JSON.parse(recordInit.body as string);
    expect(payload.path).toBe('/workspace/coach');
    expect(payload.requests).toEqual([expect.objectContaining({
      method: 'GET',
      path: '/coach_api/coach/dashboard',
      status: 200,
      requestId: 'request-1',
      queryCount: 4,
      dbMs: 12.5,
      serverMs: 32.5,
      cacheStatus: 'HIT',
    })]);
    expect(JSON.stringify(payload)).not.toContain('owner=private');
  });

  it('does not send samples unless the authenticated server enables diagnostics', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
    recordPerformanceNavigation('/workspace/coach');
    await fetch('/coach_api/coach/dashboard');
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('waits for DOM and API quiet before declaring the page stable', async () => {
    uninstall();
    let notifyDomMutation: MutationCallback = () => undefined;
    class TestMutationObserver {
      constructor(callback: MutationCallback) { notifyDomMutation = callback; }
      observe() {}
      disconnect() {}
      takeRecords(): MutationRecord[] { return []; }
    }
    vi.stubGlobal('MutationObserver', TestMutationObserver);
    uninstall = installPerformanceDiagnostics();

    recordPerformanceNavigation('/workspace/coach');
    await fetch('/coach_api/coach/dashboard');
    await vi.advanceTimersByTimeAsync(600);
    notifyDomMutation([], {} as MutationObserver);
    await vi.advanceTimersByTimeAsync(300);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(250);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('ignores writes and marks a route warm on its second navigation', async () => {
    recordPerformanceNavigation('/workspace/coach');
    await fetch('/coach_api/coach/dashboard');
    await vi.advanceTimersByTimeAsync(800);
    recordPerformanceNavigation('/coach/caseload');
    await fetch('/coach_api/coach/caseload');
    await vi.advanceTimersByTimeAsync(800);
    recordPerformanceNavigation('/workspace/coach');
    await fetch('/coach_api/coach/save', { method: 'POST' });
    await fetch('/coach_api/coach/dashboard');
    await vi.advanceTimersByTimeAsync(800);

    const samples = fetchMock.mock.calls
      .filter(call => call[0] === '/curriculum_api/performance/record/')
      .map(call => JSON.parse((call[1] as RequestInit).body as string));
    expect(samples.at(-1).cold).toBe(false);
    expect(samples.at(-1).requests.map((item: { path: string }) => item.path)).toEqual([
      '/coach_api/coach/dashboard',
    ]);
  });
});
