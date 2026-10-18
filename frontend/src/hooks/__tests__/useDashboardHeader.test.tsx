import { StrictMode, type ReactNode } from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDashboardHeader } from '../useDashboardHeader';
import { clearAllCachedResources } from '@/api/cachedRequest';

const remote = vi.hoisted(() => ({ listeners: new Set<(path: string) => void>() }));
vi.mock('@/lib/curriculumApi', () => ({ UNKNOWN_WRITE_PATH: '*',
  subscribeCurriculumRemoteWrites: (listener: (path: string) => void) => {
    remote.listeners.add(listener); return () => remote.listeners.delete(listener);
  } }));
const wrapper = ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>;
beforeEach(() => {
  clearAllCachedResources();
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ learner: { id: '7', name: 'Learner' }, modules: [], moduleLabel: 'Module', initialWeeklyModuleId: null, nextAssignment: null, nextLiveSession: null, nextReview: null }))));
});
afterEach(() => { cleanup(); clearAllCachedResources(); remote.listeners.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('Dashboard Header freshness', () => {
  it('does not let a pre-change request replace the refreshed schedule', async () => {
    let finish!: (response: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const { result } = renderHook(() => useDashboardHeader('commercial', '7'));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    act(() => remote.listeners.forEach(listener => listener('/curriculum/modules/M1/')));
    await waitFor(() => expect(result.current.real?.name).toBe('Learner'));
    await act(async () => finish(new Response(JSON.stringify({ learner: { id: '7', name: 'Stale learner' }, modules: [], moduleLabel: 'Module', initialWeeklyModuleId: null, nextAssignment: null, nextLiveSession: null, nextReview: null }))));
    expect(result.current.real?.name).toBe('Learner');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('deduplicates StrictMode and refreshes after a remote schedule change', async () => {
    const { result } = renderHook(() => useDashboardHeader('commercial', '7'), { wrapper });
    await waitFor(() => expect(result.current.real?.name).toBe('Learner'));
    expect(fetch).toHaveBeenCalledTimes(1);
    act(() => remote.listeners.forEach(listener => listener('/curriculum/modules/M1/')));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  });

  it('ignores unrelated curriculum changes and refreshes unknown epoch changes', async () => {
    const { result } = renderHook(() => useDashboardHeader('commercial', '7'));
    await waitFor(() => expect(result.current.real?.name).toBe('Learner'));
    act(() => remote.listeners.forEach(listener => listener('/curriculum/ksb-sets/K1/')));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 350)); });
    expect(fetch).toHaveBeenCalledTimes(1);
    act(() => remote.listeners.forEach(listener => listener('*')));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  });
});
