import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAllCachedResources } from '../cachedRequest';
import { myLearningCatalogue, useMyLearningModule } from '../myLearning';

const catalogue = (id = '125', kind = 'commercial') => ({
  learner: { id, kind, name: 'Synthetic learner', programme: '', cohort: '', group: '' },
  summary: { current: { subjects: 0, total: 0, completed: 0, percent: 0 },
    previous: { subjects: 0, total: 0, completed: 0, percent: 0 }, subjectCount: 0 },
  modules: [], upcoming: [], hasMoreUpcoming: false, otjh: { actual: 0, planned: null },
});
const subject = (id = '125') => ({
  subjectId: 'current:M1', detail: { id, components: [] }, activity: null,
  metadata: {}, schedule: {}, sessions: [],
});
const response = (value: unknown) => new Response(JSON.stringify(value), { status: 200 });

beforeEach(() => { clearAllCachedResources(); vi.stubGlobal('fetch', vi.fn()); });
afterEach(() => { cleanup(); clearAllCachedResources(); vi.unstubAllGlobals(); });

describe('My Learning rejects invalid transport-cache snapshots', () => {
  it.each([
    ['missing learner', {}],
    ['another learner', catalogue('126')],
    ['another learner kind', catalogue('125', 'apprenticeship')],
    ['incomplete catalogue', { ...catalogue(), summary: undefined }],
    ['null response', null],
  ])('does not expose %s after the catalogue read rejects it', async (_name, value) => {
    vi.mocked(fetch).mockResolvedValue(response(value));
    await expect(myLearningCatalogue.read('commercial', '125')).rejects.toThrow();
    expect(myLearningCatalogue.peek('commercial', '125')).toBeUndefined();
  });

  it('keeps a valid empty catalogue and recovers with a fresh read after rejection', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response({})).mockResolvedValueOnce(response(catalogue()));
    await expect(myLearningCatalogue.read('commercial', '125')).rejects.toThrow();
    expect(myLearningCatalogue.peek('commercial', '125')).toBeUndefined();
    await expect(myLearningCatalogue.read('commercial', '125', undefined, true)).resolves.toEqual(catalogue());
    expect(myLearningCatalogue.peek('commercial', '125')).toEqual(catalogue());
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['missing subject', {}],
    ['another learner', subject('126')],
    ['incomplete subject', { ...subject(), detail: { id: '125' } }],
  ])('keeps %s out of the module hook and recovers on retry', async (_name, value) => {
    vi.mocked(fetch).mockResolvedValueOnce(response(value)).mockResolvedValueOnce(response(subject()));
    const { result } = renderHook(() => useMyLearningModule('commercial', '125', 'current:M1'));
    await waitFor(() => expect(result.current.error).toBe('Could not load this subject. Please try again.'));
    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(false);
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.data).toEqual(subject()));
    expect(result.current.error).toBe('');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('does not expose a previous learner response after switching the module identity', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response(subject())).mockResolvedValueOnce(response(subject()));
    const { result, rerender } = renderHook(({ id }) => useMyLearningModule('commercial', id, 'current:M1'),
      { initialProps: { id: '125' } });
    await waitFor(() => expect(result.current.data).toEqual(subject()));
    rerender({ id: '126' });
    expect(result.current.data).toBeNull();
    await waitFor(() => expect(result.current.error).toBe('Could not load this subject. Please try again.'));
    expect(result.current.data).toBeNull();
  });

  it('retains the last valid module during a rejected refresh and shows its error', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response(subject())).mockResolvedValueOnce(response({}));
    const { result } = renderHook(() => useMyLearningModule('commercial', '125', 'current:M1'));
    await waitFor(() => expect(result.current.data).toEqual(subject()));
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.error).toBe('Could not load this subject. Please try again.'));
    expect(result.current.data).toEqual(subject());
    expect(result.current.loading).toBe(false);
  });
});
