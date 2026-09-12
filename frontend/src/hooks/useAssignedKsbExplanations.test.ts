import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { emptyMonthlyAssignment } from '@/api/monthlyAssignment';
import { useAssignedKsbExplanations } from './useAssignedKsbExplanations';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const context = { learnerId: '1', learnerKind: 'commercial', activityId: 'a', question: 'What happened?', answer: 'My own answer', mappings: [{ code: 'K1', description: 'Planning' }] };
it('drafts only assigned empty claims, keeps learner edits made during generation and ignores extra KSBs', async () => {
  let resolve!: (value: unknown) => void;
  const fetch = vi.fn((_url: string, _options: RequestInit) => new Promise(r => { resolve = r; }));
  vi.stubGlobal('fetch', fetch);
  let data = emptyMonthlyAssignment(['K1', 'S2'], '2026-09');
  const apply = vi.fn(update => { data = update(data); });
  renderHook(() => useAssignedKsbExplanations(true, context, data, apply));
  expect(JSON.parse(fetch.mock.calls[0][1].body as string).mappings.map((m: {code: string}) => m.code)).toEqual(['K1']);
  data.claims[0].explanation = 'My manual explanation';
  await act(async () => resolve({ ok: true, json: async () => ({ claims: [{ code: 'K1', explanation: 'AI draft', evidenceIds: [] }, { code: 'S2', explanation: 'Unwanted', evidenceIds: [] }] }) }));
  expect(data.claims.map(c => c.explanation)).toEqual(['My manual explanation', '']);
});
it('fills the draft and available supporting evidence without repeating the request on save', async () => {
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ claims: [{ code: 'K1', explanation: 'Generated explanation', evidenceIds: ['file1', 'unknown'] }], notices: [] }) });
  vi.stubGlobal('fetch', fetch);
  let data = emptyMonthlyAssignment(['K1', 'S2'], '2026-09');
  data.evidence = [{ id: 'file1', name: 'Report', points: '' }];
  const apply = vi.fn(update => { data = update(data); });
  const { rerender } = renderHook(() => useAssignedKsbExplanations(true, context, data, apply));
  await waitFor(() => expect(apply).toHaveBeenCalled());
  expect(data.claims[0]).toEqual({ code: 'K1', explanation: 'Generated explanation', evidenceIds: ['file1'] });
  expect(data.claims[1].explanation).toBe('');
  rerender();
  expect(fetch).toHaveBeenCalledTimes(1);
});
it('does not request drafts for locked submissions or overwrite existing explanations', () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  const data = emptyMonthlyAssignment(['K1'], '2026-09');
  renderHook(() => useAssignedKsbExplanations(false, context, data, vi.fn()));
  data.claims[0].explanation = 'Already written';
  renderHook(() => useAssignedKsbExplanations(true, context, data, vi.fn()));
  expect(fetch).not.toHaveBeenCalled();
});
it('discards an in-flight response when the learner leaves the step', async () => {
  let resolve!: (value: unknown) => void;
  vi.stubGlobal('fetch', vi.fn(() => new Promise(r => { resolve = r; })));
  const data = emptyMonthlyAssignment(['K1'], '2026-09');
  const apply = vi.fn();
  const { rerender } = renderHook(({ enabled }) => useAssignedKsbExplanations(enabled, context, data, apply), { initialProps: { enabled: true } });
  rerender({ enabled: false });
  await act(async () => resolve({ ok: true, json: async () => ({ claims: [{ code: 'K1', explanation: 'Stale draft', evidenceIds: [] }] }) }));
  expect(apply).not.toHaveBeenCalled();
});
