import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { authoredWeekPoints, type AuthoredWeekPoints } from '@/api/webWeekPoints';
import { useWeekPointDrafts } from './useWeekPointDrafts';

vi.mock('@/api/webWeekPoints', () => ({ authoredWeekPoints: vi.fn() }));
const fixture = (weekId: string, moduleId = 'M1'): AuthoredWeekPoints => ({
  moduleId, weekId, editorId: 'synthetic', csrfToken: 'synthetic', revision: 0,
  points: [{ id: 'P1', title: 'Explore', componentIds: [] }], activities: [],
});
beforeEach(() => { sessionStorage.clear(); vi.mocked(authoredWeekPoints).mockReset(); });

it('preserves newer typing when an older Points save completes', async () => {
  const { result } = renderHook(() => useWeekPointDrafts('M1', ['W1']));
  act(() => result.current.install(fixture('W1')));
  act(() => result.current.update('M1', 'W1', points => points.map(point => ({ ...point, title: 'Submitted' }))));
  let finish!: (data: AuthoredWeekPoints) => void;
  vi.mocked(authoredWeekPoints).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const saving = result.current.save('M1', ['W1']);
  act(() => result.current.update('M1', 'W1', points => points.map(point => ({ ...point, title: 'Newer typing' }))));
  await act(async () => {
    finish({ ...fixture('W1'), revision: 1, points: [{ id: 'P1', title: 'Submitted', componentIds: [] }] });
    await saving;
  });
  expect(result.current.get('M1', 'W1')?.points[0].title).toBe('Newer typing');
  expect(result.current.get('M1', 'W1')?.data.revision).toBe(1);
  expect(result.current.signature).not.toBe('');
});

it('retries only unfinished weeks after partial success and does not touch another module', async () => {
  const { result } = renderHook(() => useWeekPointDrafts('M1', ['W1', 'W2']));
  act(() => {
    for (const data of [fixture('W1'), fixture('W2'), fixture('W3', 'M2')]) {
      result.current.install(data);
      result.current.update(data.moduleId, data.weekId, points => points.map(point => ({ ...point, title: 'Edited' })));
    }
  });
  let fail = true;
  vi.mocked(authoredWeekPoints).mockImplementation(async (moduleId, weekId, saved) => {
    if (weekId === 'W2' && fail) throw new Error('Unavailable');
    return { ...fixture(weekId, moduleId), revision: 1, points: saved!.points };
  });
  await act(async () => { await expect(result.current.save('M1', ['W1', 'W2'])).rejects.toThrow('remaining Points edits are retained'); });
  expect(result.current.get('M1', 'W1')?.data.revision).toBe(1);
  expect(result.current.get('M1', 'W2')?.data.revision).toBe(0);
  fail = false;
  await act(async () => { await result.current.save('M1', ['W1', 'W2']); });
  expect(vi.mocked(authoredWeekPoints).mock.calls.map(call => [call[0], call[1]])).toEqual([['M1', 'W1'], ['M1', 'W2'], ['M1', 'W2']]);
  expect(result.current.signature).toBe('');
  expect(result.current.get('M2', 'W3')?.points[0].title).toBe('Edited');
});

it('discards Points drafts only for the module the author chose to discard', () => {
  const { result } = renderHook(() => useWeekPointDrafts('M1', ['W1']));
  act(() => {
    for (const moduleId of ['M1', 'M2']) {
      result.current.install(fixture('W1', moduleId));
      result.current.update(moduleId, 'W1', () => []);
    }
    result.current.discard('M1');
  });
  expect(result.current.signature).toBe('');
  expect(sessionStorage.getItem('web-week-points:M1:W1:synthetic')).toBeNull();
  expect(result.current.get('M2', 'W1')?.points).toEqual([]);
  expect(sessionStorage.getItem('web-week-points:M2:W1:synthetic')).not.toBeNull();
});
