import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchLearnerDetail, invalidateLearnerDetailCache } from '../learnerDetail';
import { saveLearningPlan, saveModuleLearners } from '../learningPlan';

const response = (value: unknown, ok = true) => ({ ok, status: ok ? 200 : 400, json: async () => value, text: async () => JSON.stringify(value) }) as Response;
const oldDetail = { id: '101', modules: ['Existing'] };
const newDetail = { id: '101', modules: ['Existing', 'New'] };

describe('module assignment propagation', () => {
  beforeEach(() => invalidateLearnerDetailCache());
  afterEach(() => { vi.unstubAllGlobals(); invalidateLearnerDetailCache(); });

  it.each(['plan', 'roster'])('refreshes both learner kinds after a successful %s save', async (surface) => {
    const fetch = vi.fn().mockResolvedValueOnce(response(oldDetail)).mockResolvedValueOnce(response(oldDetail))
      .mockResolvedValueOnce(response({})).mockResolvedValue(response(newDetail));
    vi.stubGlobal('fetch', fetch);
    await fetchLearnerDetail('commercial', '101');
    await fetchLearnerDetail('apprenticeship', '102');
    if (surface === 'plan') await saveLearningPlan('101', ['MOD-NEW']);
    else await saveModuleLearners('MOD-NEW', ['101']);
    expect(await fetchLearnerDetail('commercial', '101')).toEqual(newDetail);
    expect(await fetchLearnerDetail('apprenticeship', '102')).toEqual(newDetail);
    expect(fetch).toHaveBeenCalledTimes(5);
  });

  it('keeps cached data when the assignment save fails', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response(oldDetail)).mockResolvedValueOnce(response({ error: 'Save failed' }, false));
    vi.stubGlobal('fetch', fetch);
    await fetchLearnerDetail('commercial', '101');
    await expect(saveLearningPlan('101', ['MOD-NEW'])).rejects.toThrow('Save failed');
    expect(await fetchLearnerDetail('commercial', '101')).toEqual(oldDetail);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('does not reuse or recache a stale request that was pending during assignment', async () => {
    let finishOld!: (value: Response) => void;
    const fetch = vi.fn().mockImplementationOnce(() => new Promise<Response>((resolve) => { finishOld = resolve; }))
      .mockResolvedValueOnce(response({})).mockResolvedValueOnce(response(newDetail));
    vi.stubGlobal('fetch', fetch);
    const pending = fetchLearnerDetail('commercial', '101');
    await saveModuleLearners('MOD-NEW', ['101']);
    expect(await fetchLearnerDetail('commercial', '101')).toEqual(newDetail);
    finishOld(response(oldDetail));
    await pending;
    expect(await fetchLearnerDetail('commercial', '101')).toEqual(newDetail);
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});
