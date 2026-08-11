import { describe, expect, it } from 'vitest';
import { filterQuizzesForScope, filterWeekTemplatesForScope, reorderComponents, type WeekScope, type WeekTemplate, type WorkspaceQuizSummary } from './weekTemplateData';

function quiz(overrides: Partial<WorkspaceQuizSummary> = {}): WorkspaceQuizSummary {
  return { id: 1, title: 'Untitled quiz', programme: 'Digital Marketing', programmeId: 'p1', module: 'Module 1', status: 'draft', ...overrides };
}

function paidScope(overrides: Partial<WeekScope> = {}): WeekScope {
  return { courseType: 'paid', programmeId: 'p1', programmeName: 'Digital Marketing', moduleName: 'Module 1', ...overrides };
}

describe('filterQuizzesForScope', () => {
  it('matches paid scope by programme + module', () => {
    const quizzes = [
      quiz({ id: 1, programmeId: 'p1', module: 'Module 1' }),
      quiz({ id: 2, programmeId: 'p2', programme: 'Other Programme', module: 'Module 1' }), // wrong programme
      quiz({ id: 3, programmeId: 'p1', module: 'Module 2' }), // wrong module
    ];
    const result = filterQuizzesForScope(quizzes, paidScope());
    expect(result.map(q => q.id)).toEqual([1]);
  });

  it('excludes trashed quizzes regardless of scope', () => {
    const quizzes = [quiz({ id: 1, status: 'trash' })];
    expect(filterQuizzesForScope(quizzes, paidScope())).toHaveLength(0);
  });

  it('matches by programme name when programmeId differs', () => {
    const quizzes = [quiz({ id: 1, programmeId: undefined, programme: 'Digital Marketing', module: 'Module 1' })];
    expect(filterQuizzesForScope(quizzes, paidScope())).toHaveLength(1);
  });

  it('returns every non-trashed quiz for a free-course scope', () => {
    const quizzes = [
      quiz({ id: 1, programmeId: 'p1', module: 'Module 1' }),
      quiz({ id: 2, programmeId: 'p9', module: 'Module 9' }),
      quiz({ id: 3, status: 'trash' }),
    ];
    const freeScope: WeekScope = { courseType: 'free', programmeId: '', programmeName: '', moduleName: '' };
    const result = filterQuizzesForScope(quizzes, freeScope);
    expect(result.map(q => q.id)).toEqual([1, 2]);
  });
});

function template(overrides: Partial<WeekTemplate> = {}): WeekTemplate {
  return {
    id: 'wt1', title: 'Week', summary: '', learningOutcomes: [], courseType: 'paid',
    programmeId: 'p1', programmeName: 'Digital Marketing', moduleCatalogueId: 'm1',
    groupId: '', groupName: '', status: 'draft', ksbMappings: [], totalOtjh: 0, points: 0,
    componentCount: 0, author: '', components: [], ...overrides,
  };
}

describe('filterWeekTemplatesForScope', () => {
  it('always includes free-course templates', () => {
    const templates = [template({ id: 'free1', courseType: 'free', programmeId: '', programmeName: '' })];
    const result = filterWeekTemplatesForScope(templates, { programmeId: 'p1', programmeName: 'Digital Marketing' });
    expect(result.map(t => t.id)).toEqual(['free1']);
  });

  it('matches paid templates by programme, excludes non-matching ones', () => {
    const templates = [
      template({ id: 'match', programmeId: 'p1' }),
      template({ id: 'other', programmeId: 'p2', programmeName: 'Other Programme' }),
    ];
    const result = filterWeekTemplatesForScope(templates, { programmeId: 'p1', programmeName: 'Digital Marketing' });
    expect(result.map(t => t.id)).toEqual(['match']);
  });

  it('does NOT fall back to showing every programme when nothing matches', () => {
    const templates = [template({ id: 'other', programmeId: 'p2', programmeName: 'Other Programme' })];
    const result = filterWeekTemplatesForScope(templates, { programmeId: 'p1', programmeName: 'Digital Marketing' });
    expect(result).toEqual([]);
  });

  it('excludes trashed templates', () => {
    const templates = [template({ id: 'trashed', status: 'trash' })];
    const result = filterWeekTemplatesForScope(templates, { programmeId: 'p1', programmeName: 'Digital Marketing' });
    expect(result).toEqual([]);
  });
});

describe('reorderComponents', () => {
  it('moves a component from one index to another', () => {
    const components = [{ id: 'a' }, { id: 'b' }, { id: 'c' }] as WeekTemplate['components'];
    const result = reorderComponents(components, 'a', 'c');
    expect(result.map(c => c.id)).toEqual(['b', 'c', 'a']);
  });

  it('returns the same list when either id is missing', () => {
    const components = [{ id: 'a' }, { id: 'b' }] as WeekTemplate['components'];
    expect(reorderComponents(components, 'missing', 'b')).toBe(components);
  });
});
