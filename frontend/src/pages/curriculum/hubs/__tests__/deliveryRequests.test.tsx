import { StrictMode, type ReactNode } from 'react';
import { cleanup, renderHook, waitFor, act } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { clearCurriculumGetCache } from '@/lib/curriculumApi';
import { useDeliveryRead } from '../useDeliveryData';

const fetcher = vi.fn<typeof fetch>();
beforeEach(() => {
  clearCurriculumGetCache();
  fetcher.mockReset().mockImplementation(async () => new Response(JSON.stringify({ marker: 'saved data' }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  vi.stubGlobal('fetch', fetcher);
});
afterEach(() => { cleanup(); clearCurriculumGetCache(); vi.unstubAllGlobals(); });

it('coalesces StrictMode reads, keeps summary and live dates independent, and never forces a server rebuild', async () => {
  const hook = renderHook(() => ({
    overview: useDeliveryRead('/curriculum/delivery-dashboard/', 'staff-1'),
    sessions: useDeliveryRead('/curriculum/delivery-dashboard/sessions/', 'staff-1'),
  }), { wrapper: ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode> });
  await waitFor(() => expect(hook.result.current.overview.loading || hook.result.current.sessions.loading).toBe(false));
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fetcher.mock.calls.map(call => String(call[0]))).toEqual(expect.arrayContaining([
    expect.stringContaining('/curriculum/delivery-dashboard/'), expect.stringContaining('/curriculum/delivery-dashboard/sessions/'),
  ]));
  hook.rerender();
  expect(fetcher).toHaveBeenCalledTimes(2);
  act(() => hook.result.current.sessions.reload());
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
  for (const [, options] of fetcher.mock.calls) {
    expect(options?.method ?? 'GET').toBe('GET');
    expect(new Headers(options?.headers).get('Cache-Control')).not.toBe('no-cache');
  }
});
