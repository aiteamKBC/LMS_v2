import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearCurriculumGetCache,
  fetchCurriculumKsbAchievement,
  fetchCurriculumProgrammeKsbCoverage,
  updateCurriculumProgramme,
} from '../curriculumApi';

/**
 * Applying a KSB source is a programme PATCH. Every read that names the applied
 * source -- Achievement, Coverage -- must be asked again afterwards, not served
 * from the client cache, so the page shows the new source without a hard
 * refresh.
 */

const mockFetch = vi.fn();

function jsonResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}

function achievementFor(sourceId: string) {
  return { appliedSource: { type: 'standard', id: sourceId, label: sourceId, definitionCount: 1 } };
}

beforeEach(() => {
  global.fetch = mockFetch;
});

afterEach(() => {
  clearCurriculumGetCache();
  mockFetch.mockReset();
});

describe('applying a KSB source refreshes the source-bearing reads', () => {
  it('re-reads Achievement after the programme source is changed', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse(achievementFor('st0310-v1-5')))
      .mockResolvedValueOnce(jsonResponse({ updated: true, programme: { id: 'PROG-PCP-L6' } }))
      .mockResolvedValueOnce(jsonResponse(achievementFor('st0845-v1-1')));

    const before = await fetchCurriculumKsbAchievement('PROG-PCP-L6');
    // A second read before any write is the cached answer.
    expect(await fetchCurriculumKsbAchievement('PROG-PCP-L6')).toEqual(before);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    await updateCurriculumProgramme('PROG-PCP-L6', { ksbProfileSourceId: 'standard:st0845-v1-1' });
    const after = await fetchCurriculumKsbAchievement('PROG-PCP-L6');

    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(after.appliedSource.id).toBe('st0845-v1-1');
  });

  it('re-reads Coverage after the programme source is changed', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ source: { type: 'standard', id: 'st0310-v1-5' }, items: [] }))
      .mockResolvedValueOnce(jsonResponse({ updated: true, programme: { id: 'PROG-PCP-L6' } }))
      .mockResolvedValueOnce(jsonResponse({ source: { type: 'standard', id: 'st0845-v1-1' }, items: [] }));

    await fetchCurriculumProgrammeKsbCoverage('PROG-PCP-L6');
    await updateCurriculumProgramme('PROG-PCP-L6', { ksbProfileSourceId: 'standard:st0845-v1-1' });
    await fetchCurriculumProgrammeKsbCoverage('PROG-PCP-L6');

    expect(mockFetch).toHaveBeenCalledTimes(3);
    const lastUrl = String(mockFetch.mock.calls[2][0]);
    expect(lastUrl).toContain('/curriculum/programmes/PROG-PCP-L6/ksb-coverage/');
  });
});
