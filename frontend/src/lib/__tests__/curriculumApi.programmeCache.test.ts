import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearCurriculumGetCache, createCurriculumModule,
  fetchCurriculumProgrammeDetailModules,
  fetchCurriculumProgrammeKsbCoverage, fetchCurriculumProgrammeKsbCoverageSummary,
} from '@/lib/curriculumApi';

const response = (revision: string) => ({ ok: true, status: 200, json: async () => ({ revision }) });

describe('programme workspace cache freshness', () => {
  const fetchMock = vi.fn();
  beforeEach(() => { clearCurriculumGetCache(); fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); });
  afterEach(() => { clearCurriculumGetCache(); vi.unstubAllGlobals(); });

  it.each([false, true])('does not join or cache a read from before a save (revalidate=%s)', async revalidate => {
    let finishOld!: (value: unknown) => void;
    fetchMock.mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }));
    const oldRead = fetchCurriculumProgrammeDetailModules('P-1', undefined, { view: 'workspace' });
    fetchMock.mockResolvedValueOnce(response('saved'));
    await createCurriculumModule({ name: 'Synthetic module' });
    fetchMock.mockResolvedValueOnce(response('new'));
    await expect(fetchCurriculumProgrammeDetailModules('P-1', undefined, { view: 'workspace', revalidate })).resolves.toEqual({ revision: 'new' });
    finishOld(response('old'));
    await oldRead;
    await expect(fetchCurriculumProgrammeDetailModules('P-1', undefined, { view: 'workspace' })).resolves.toEqual({ revision: 'new' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('reuses a warm programme while keeping other programmes and full responses separate', async () => {
    fetchMock.mockResolvedValue(response('current'));
    await fetchCurriculumProgrammeDetailModules('P-1', undefined, { view: 'workspace' });
    await fetchCurriculumProgrammeDetailModules('P-1', undefined, { view: 'workspace' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await fetchCurriculumProgrammeDetailModules('P-2', undefined, { view: 'workspace' });
    await fetchCurriculumProgrammeDetailModules('P-1');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('caches overview coverage separately from the evidence matrix and its source', async () => {
    fetchMock.mockResolvedValue(response('current'));
    await fetchCurriculumProgrammeKsbCoverageSummary('P-1', { sourceType: 'standard', sourceId: 'S1' });
    await fetchCurriculumProgrammeKsbCoverageSummary('P-1', { sourceType: 'standard', sourceId: 'S1' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await fetchCurriculumProgrammeKsbCoverage('P-1', { sourceType: 'standard', sourceId: 'S1' });
    await fetchCurriculumProgrammeKsbCoverageSummary('P-1', { sourceType: 'standard', sourceId: 'S2' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
