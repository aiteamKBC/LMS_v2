import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearCurriculumGetCache, fetchCurriculumDeliveryScope, fetchCurriculumKsbSets,
  fetchCurriculumKsbSetSummaries, fetchCurriculumKsbSourceDefinitions,
  updateCurriculumGroup, updateCurriculumProgramme, updateCurriculumKsbFramework,
  fetchCurriculumProgrammeDetailModules,
} from '@/lib/curriculumApi';

describe('lightweight curriculum reads', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    clearCurriculumGetCache();
    fetchMock.mockReset().mockImplementation(async () => new Response(JSON.stringify({ results: [], cohorts: [], groups: [] }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    clearCurriculumGetCache();
    vi.unstubAllGlobals();
  });

  it('keeps summary, full-library and selected-source responses in separate cache entries', async () => {
    await fetchCurriculumKsbSetSummaries();
    await fetchCurriculumKsbSets(undefined, { all: true });
    await fetchCurriculumKsbSourceDefinitions('KSBP/ONE');
    await fetchCurriculumKsbSetSummaries();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const urls = fetchMock.mock.calls.map(([url]) => String(url));
    expect(urls[0]).toContain('ksb-sets/?view=summary&visibility=all');
    expect(urls[1]).toContain('ksb-sets/?visibility=all');
    expect(urls[2]).toContain('ksb-sets/KSBP%2FONE/definitions/?visibility=all');
  });

  it.each(['group', 'programme'])('invalidates delivery scope after a %s update', async entity => {
    await fetchCurriculumDeliveryScope();
    await fetchCurriculumDeliveryScope();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    if (entity === 'group') await updateCurriculumGroup('G1', { name: 'Updated' });
    else await updateCurriculumProgramme('P1', { name: 'Updated' });
    await fetchCurriculumDeliveryScope();
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('/delivery-scope/'))).toHaveLength(2);
  });

  it('invalidates both source counts and definitions after updating a profile', async () => {
    await fetchCurriculumKsbSetSummaries();
    await fetchCurriculumKsbSourceDefinitions('KSBP-ONE');
    await updateCurriculumKsbFramework('KSBP-ONE', { name: 'Updated' });
    await fetchCurriculumKsbSetSummaries();
    await fetchCurriculumKsbSourceDefinitions('KSBP-ONE');
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it('separates the programme workspace projection from full detail and invalidates both after a save', async () => {
    await fetchCurriculumProgrammeDetailModules('P/1', undefined, { visibility: 'all', view: 'workspace' });
    await fetchCurriculumProgrammeDetailModules('P/1', undefined, { visibility: 'all' });
    await fetchCurriculumProgrammeDetailModules('P/1', undefined, { visibility: 'all', view: 'workspace' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/P%2F1/detail/modules/?visibility=all&view=workspace');
    expect(String(fetchMock.mock.calls[1][0])).toContain('/P%2F1/detail/modules/?visibility=all');
    await updateCurriculumProgramme('P/1', { name: 'Updated' });
    await fetchCurriculumProgrammeDetailModules('P/1', undefined, { visibility: 'all', view: 'workspace' });
    await fetchCurriculumProgrammeDetailModules('P/1', undefined, { visibility: 'all' });
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });
});
