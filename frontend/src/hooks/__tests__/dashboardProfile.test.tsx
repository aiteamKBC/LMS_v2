import { StrictMode, type PropsWithChildren } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { clearAllCachedResources } from '@/api/cachedRequest';
import { fetchLearnerSummary, invalidateLearnerDetailCache } from '@/api/learnerDetail';
import { useLearnerSummaryParam } from '../useLearnerSummaryParam';

const profile = { id: '265', name: 'Synthetic Learner', programme: 'Example', programmeStatus: 'Active',
  learnerType: 'commercial', cohort: '', group: '', employer: '', organization: '', email: '',
  onboardingStatus: '', firstSessionUnlocked: false, learnerStartDate: '', learnerEndDate: '',
  programmeStartDate: null, programmeEndDate: null, studentActivityAvailable: false,
  accessGate: { blocked: false, reasons: [], startDate: '', outstandingDocuments: [] },
  learningAccess: { blocked: false, startDate: '2026-01-01' } };
beforeEach(() => { clearAllCachedResources(); vi.stubGlobal('fetch', vi.fn()); });
afterEach(() => { clearAllCachedResources(); vi.unstubAllGlobals(); });

it('shares one profile request across StrictMode mounts, sidebar reads and rerenders', async () => {
  let finish!: (response: Response) => void;
  vi.mocked(fetch).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const wrapper = ({ children }: PropsWithChildren) => <StrictMode>{children}</StrictMode>;
  const first = renderHook(() => useLearnerSummaryParam('commercial', '265'), { wrapper });
  const second = renderHook(() => useLearnerSummaryParam('commercial', '265'), { wrapper });
  const sidebar = fetchLearnerSummary('commercial', '265');
  first.rerender(); second.rerender();
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(String(vi.mocked(fetch).mock.calls[0][0])).toBe('/learner_api/dashboard/commercial/265/profile/');
  await act(async () => { finish(new Response(JSON.stringify(profile))); await sidebar; });
  await waitFor(() => expect(first.result.current.real?.name).toBe('Synthetic Learner'));
  expect(second.result.current.real?.learningAccess?.blocked).toBe(false);
  await fetchLearnerSummary('commercial', '265');
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('keeps missing optional values and refreshes gates after invalidation', async () => {
  vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(profile)));
  const read = renderHook(() => useLearnerSummaryParam('commercial', '265'));
  await waitFor(() => expect(read.result.current.loading).toBe(false));
  expect(read.result.current.real?.programmeEndDate).toBeNull();
  expect(read.result.current.real).not.toHaveProperty('phone');
  vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ ...profile,
    learningAccess: { blocked: true, startDate: '' } })));
  await act(async () => invalidateLearnerDetailCache('commercial', '265'));
  await waitFor(() => expect(read.result.current.real?.learningAccess?.blocked).toBe(true));
  expect(fetch).toHaveBeenCalledTimes(2);
});

it('preserves the separate personal-course summary adapter', async () => {
  vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(profile)));
  await fetchLearnerSummary('commercial', 'pl.9.study.module');
  const url = String(vi.mocked(fetch).mock.calls[0][0]);
  expect(url).toContain('/learner_api/personal-learning/');
  expect(decodeURIComponent(url)).toContain('/learner_api/learner-summary/commercial/pl.9.study.module/');
  expect(url).not.toContain('/profile/');
});
