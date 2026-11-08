import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyComponent, createNewModule, curriculumModuleToCatalogue, duplicateModuleStructure } from '../moduleAuthoringData';
import { requireSelfStudyContent } from '../freeCoursePolicy';
import type { CurriculumModule } from '@/lib/curriculumApi';

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockImplementation(async () => new Response(JSON.stringify({ created: true }), { headers: { 'Content-Type': 'application/json' } }));
});
afterEach(() => vi.unstubAllGlobals());

describe('standalone free courses', () => {
  it('creates independent courses with unique identities and no placement or shared calendar', async () => {
    const input = { isFreeCourse: true, title: 'Study', description: '', weeks: 2, status: 'draft' as const,
      programme: 'Data', programmeId: 'P1', cohortId: 'C1', groupId: 'G1', teamsSharedSourceModuleId: 'OTHER' };
    const first = await createNewModule(input);
    await createNewModule(input);
    const [a, b] = fetchMock.mock.calls.map(call => JSON.parse(call[1].body));
    expect(a).toMatchObject({ isFreeCourse: true, programmeId: '', cohortId: '', groupId: '', teamsSharedSourceModuleId: '', learnerRosterMode: 'manual' });
    expect(a.catalogueId).toBeTruthy();
    expect(b.catalogueId).not.toBe(a.catalogueId);
    expect(first.isFreeCourse).toBe(true);
    expect(first.weekStructure).toHaveLength(2);
  });

  it('retains course identity when rebuilding a catalogue card from the compact API', () => {
    const course = curriculumModuleToCatalogue({ id: 'M1', moduleCatalogueId: 'M1', name: 'Study', isFreeCourse: true, weeks: 2 } as CurriculumModule);
    expect(course).toMatchObject({ isFreeCourse: true, programmeId: '', sourceType: 'free_course' });
  });

  it('duplicates self-study content and hours into a new independent course', async () => {
    const source = await createNewModule({ isFreeCourse: true, programme: '', title: 'Study', description: '', weeks: 1, status: 'draft' });
    source.weekStructure[0].components = [{ ...createEmptyComponent(source.weekStructure[0].id, 'reading', 1), id: 'SOURCE-COMP', title: 'Read', expectedOtjh: 1.5 }];
    fetchMock.mockClear();
    // The save endpoint returns the submitted structure, as the real API does.
    fetchMock.mockImplementation(async (_url, options) => {
      const body = JSON.parse(options.body);
      return new Response(JSON.stringify(options.method === 'POST' ? { created: true } : body), { headers: { 'Content-Type': 'application/json' } });
    });
    const copy = await duplicateModuleStructure(source, { programmeId: 'OTHER', groupId: 'OTHER', teamsCopyMode: 'shared' });
    const create = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(create).toMatchObject({ isFreeCourse: true, groupId: '', cohortId: '', learnerRosterMode: 'manual', teamsSharedSourceModuleId: '' });
    expect(copy.isFreeCourse).toBe(true);
    expect(copy.catalogueId).not.toBe(source.catalogueId);
    expect(copy.weekStructure[0].components[0].id).not.toBe('SOURCE-COMP');
    expect(copy.weekStructure[0].components[0].expectedOtjh).toBe(1.5);
  });

  it('refuses imported live activities while accepting self-study types', () => {
    expect(() => requireSelfStudyContent(['reading', 'video', 'quiz', 'assignment'])).not.toThrow();
    expect(() => requireSelfStudyContent(['reading', 'live-session'])).toThrow(/self-study/i);
  });
});
