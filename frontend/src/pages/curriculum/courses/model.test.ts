import { describe, expect, it } from 'vitest';
import type { FreeProgrammeModule } from '@/lib/curriculumApi';
import { filterCourses, groupCourses } from './model';

const week = (id: string, overrides: Partial<FreeProgrammeModule> = {}): FreeProgrammeModule => ({
  id, courseId: 'C1', title: 'A course', description: '', displayOrder: 0, componentCount: 2, totalOtjh: 1.25, components: [], ...overrides,
});

describe('Courses catalogue grouping and filters', () => {
  it('groups by identity, preserves category and orders weeks without changing records', () => {
    const modules = [week('W2', { weekNumber: 2 }), week('W1', { weekNumber: 1 }), week('A1', { courseId: 'A', courseType: 'apprentices' })];
    const before = JSON.stringify(modules), cards = groupCourses(modules);
    expect(cards).toHaveLength(2);
    expect(cards[0]).toMatchObject({ courseType: 'free', componentCount: 4, totalOtjh: 2.5 });
    expect(cards[0].weeks.map(item => item.id)).toEqual(['W1', 'W2']);
    expect(cards[1].courseType).toBe('apprentices');
    expect(JSON.stringify(modules)).toBe(before);
  });

  it('keeps same-named courses of different types separate without an existing course id', () => {
    expect(groupCourses([week('W1', { courseId: undefined }), week('W2', { courseId: undefined, courseType: 'apprentices' })])).toHaveLength(2);
  });

  it('combines type and search filters, including week titles, without treating programme modules as courses', () => {
    const cards = groupCourses([week('W1', { title: 'Marketing', weekTitle: 'Inclusion' }), week('W2', { courseId: 'A', title: 'Leadership', courseType: 'apprentices' })]);
    expect(filterCourses(cards, 'free', 'inclusion')).toHaveLength(1);
    expect(filterCourses(cards, 'apprentices', 'inclusion')).toHaveLength(0);
    expect(filterCourses(cards, 'apprentices', ' LEADERSHIP ')).toHaveLength(1);
    expect(filterCourses(cards, 'all', '')).toHaveLength(2);
  });
});
