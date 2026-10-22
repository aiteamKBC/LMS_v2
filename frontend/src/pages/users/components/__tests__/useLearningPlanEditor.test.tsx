import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LearningPlanModule, LearningPlanResponse } from '@/api/learningPlan';
import { useLearningPlanEditor } from '../useLearningPlanEditor';

const mocks = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn(), success: vi.fn(), error: vi.fn() }));
vi.mock('@/api/learningPlan', async importOriginal => ({
  ...await importOriginal<typeof import('@/api/learningPlan')>(), fetchLearningPlan: mocks.read, saveLearningPlan: mocks.save,
}));
vi.mock('@/lib/curriculumApi', () => ({ fetchFreeProgrammeModules: vi.fn().mockResolvedValue([]) }));
vi.mock('@/hooks/useToast', () => ({ useToast: () => ({ success: mocks.success, error: mocks.error }) }));

const moduleRow = (id: string): LearningPlanModule => ({ moduleId: id, moduleTitle: id, groupName: 'Group', programmeId: 'P', programmeName: 'Programme', hours: 1 });
const response = (ids: string[]): LearningPlanResponse => ({
  learner: { id: '91', name: 'Synthetic learner', programme: 'Programme', programmeId: 'P', cohort: 'Cohort', group: 'Group', programmeStatus: 'Delivery' },
  plan: ids.map(moduleRow), freeCourses: [], preset: [], available: [], programmes: [], saved: true,
  totals: { moduleCount: ids.length, moduleHours: ids.length, meetingCount: 0, meetingHours: 0, totalHours: ids.length },
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.read.mockReset().mockResolvedValue(response(['A', 'B']));
  mocks.save.mockReset();
});
async function editor() {
  const onClose = vi.fn();
  const onSaved = vi.fn();
  const hook = renderHook(() => useLearningPlanEditor({ learnerId: '91', learnerName: 'Synthetic learner', onClose, onSaved }));
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return { ...hook, onClose, onSaved };
}
describe('editable plan lifecycle', () => {
  it('retains a local removal and addition while adopting new inherited modules on focus', async () => {
    const { result } = await editor();
    act(() => { result.current.remove('A'); result.current.add(moduleRow('C')); });
    mocks.read.mockResolvedValue(response(['A', 'B', 'D']));
    await act(async () => window.dispatchEvent(new Event('focus')));
    expect(result.current.plan.map(row => row.moduleId)).toEqual(['B', 'C', 'D']);
  });

  it('does not replace a saved response with a refresh started before the save', async () => {
    const { result } = await editor();
    const refresh = deferred<LearningPlanResponse>();
    mocks.read.mockReturnValueOnce(refresh.promise);
    act(() => window.dispatchEvent(new Event('focus')));
    act(() => result.current.remove('A'));
    mocks.save.mockResolvedValue(response(['B']));
    await act(async () => result.current.save());
    await act(async () => refresh.resolve(response(['A', 'B'])));
    expect(result.current.plan.map(row => row.moduleId)).toEqual(['B']);
  });

  it('preserves edits and never reports success on a rejected save', async () => {
    const { result, onClose, onSaved } = await editor();
    act(() => result.current.remove('A'));
    mocks.save.mockRejectedValue(new Error('Plan could not be saved'));
    await act(async () => result.current.save());
    expect(result.current.plan.map(row => row.moduleId)).toEqual(['B']);
    expect(result.current.error).toBe('Plan could not be saved');
    expect(mocks.success).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('sends only one write for repeated save clicks', async () => {
    const { result } = await editor();
    const save = deferred<LearningPlanResponse>();
    mocks.save.mockReturnValue(save.promise);
    let pending!: Promise<void>;
    act(() => { pending = result.current.save(); void result.current.save(); });
    expect(mocks.save).toHaveBeenCalledTimes(1);
    await act(async () => { save.resolve(response(['A', 'B'])); await pending; });
  });
});
