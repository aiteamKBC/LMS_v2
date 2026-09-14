import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { emptyMonthlyAssignment } from '@/api/monthlyAssignment';
import { useImpactStatements } from './useImpactStatements';
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const draft = 'supported '.repeat(20).trim();
it('fills impact drafts without changing existing text or the employer declaration and does not repeat on save', async () => {
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ careerImpact: draft, jobImpact: draft, employerImpact: draft, businessImpact: draft }) });
  vi.stubGlobal('fetch', fetch);
  let data = emptyMonthlyAssignment([], '2026-09'), business = '';
  data.jobImpact = 'My job explanation';
  const apply = vi.fn(update => { data = update(data); });
  const setBusiness = vi.fn(value => { business = value; });
  const { rerender, result } = renderHook(() => useImpactStatements(true, '1', 'a', 'Question', 'My answer', '', data, business, apply, setBusiness));
  expect(result.current.phase).toBe('loading');
  await waitFor(() => expect(apply).toHaveBeenCalled());
  expect(result.current.phase).toBe('success');
  expect(data.careerImpact).toBe(draft);
  expect(data.jobImpact).toBe('My job explanation');
  expect(data.employerImpact).toBe(draft);
  expect(data.employerBenefit).toBe(false);
  expect(business).toBe(draft);
  rerender(); expect(fetch).toHaveBeenCalledTimes(1);
});
it('preserves edits during generation, including the separately stored business outcome', async () => {
  let resolve!: (value: unknown) => void;
  vi.stubGlobal('fetch', vi.fn(() => new Promise(r => { resolve = r; })));
  let data = emptyMonthlyAssignment([], '2026-09'), business = '';
  const apply = vi.fn(update => { data = update(data); }), setBusiness = vi.fn();
  const { rerender } = renderHook(() => useImpactStatements(true, '1', 'a', '', 'My answer', '', data, business, apply, setBusiness));
  data.careerImpact = 'Manual career text'; business = 'Manual outcome'; rerender();
  await act(async () => resolve({ ok: true, json: async () => ({ careerImpact: draft, jobImpact: '', employerImpact: '', businessImpact: draft }) }));
  expect(data.careerImpact).toBe('Manual career text');
  expect(data.jobImpact).toBe('');
  expect(setBusiness).not.toHaveBeenCalled();
});
it('does not generate for locked submissions', () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  renderHook(() => useImpactStatements(false, '1', 'a', '', 'My answer', '', emptyMonthlyAssignment([], '2026-09'), '', vi.fn(), vi.fn()));
  expect(fetch).not.toHaveBeenCalled();
});

it('drafts action and EPA fields only and preserves an existing action plan', async () => {
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ actionPlan: draft, epaPreparedness: draft, businessImpact: draft }) });
  vi.stubGlobal('fetch', fetch);
  let data = emptyMonthlyAssignment([], '2026-09'); data.actionPlan = 'My own plan';
  const apply = vi.fn(update => { data = update(data); }), setBusiness = vi.fn();
  const { result, rerender } = renderHook(() => useImpactStatements(true, '1', 'a', '', 'My answer', '', data, '', apply, setBusiness, 'action'));
  expect(result.current.phase).toBe('loading');
  await waitFor(() => expect(result.current.phase).toBe('success'));
  expect(data.actionPlan).toBe('My own plan'); expect(data.epaPreparedness).toBe(draft);
  expect(setBusiness).not.toHaveBeenCalled();
  expect(JSON.parse(fetch.mock.calls[0][1].body).mode).toBe('action');
  rerender(); expect(fetch).toHaveBeenCalledTimes(1);
});
