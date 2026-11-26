import { describe, expect, it } from 'vitest';
import { mergeWeekTemplates } from '../weekTemplateMerge';
import type { WeekTemplate } from '../weekTemplateData';
import type { ModuleComponent } from '@/pages/curriculum/module-builder/moduleAuthoringData';

/**
 * Two people in the same week template.
 *
 * The component list is the whole risk here: it is what an author spends an
 * afternoon on, and the endpoint takes it whole, so before this merge existed
 * the second save simply replaced the first editor's components with its own
 * copy of them. Every case below is stated as the two editors' actual moves.
 */

function component(id: string, overrides: Partial<ModuleComponent> = {}): ModuleComponent {
  return {
    id,
    weekId: 'WEEK-TEMPLATE',
    type: 'reading',
    title: `Component ${id}`,
    description: '',
    expectedOtjh: 1,
    points: 5,
    reflectionRequired: false,
    reflectionQuestion: '',
    workplaceEvidenceRequired: false,
    tutorValidationRequired: false,
    coachValidationRequired: true,
    ksbMappings: [],
    settings: {},
    ...overrides,
  };
}

function template(components: ModuleComponent[], overrides: Partial<WeekTemplate> = {}): WeekTemplate {
  return {
    id: 'WT-1',
    title: 'Week one',
    summary: '',
    learningOutcomes: [],
    courseType: 'paid',
    programmeId: 'PROG-1',
    programmeName: 'Programme',
    moduleCatalogueId: 'MOD-1',
    groupId: 'GROUP-1',
    groupName: 'Group A',
    status: 'draft',
    ksbMappings: [],
    totalOtjh: components.length,
    points: components.length * 5,
    componentCount: components.length,
    author: 'Someone',
    components,
    ...overrides,
  };
}

const ids = (result: { template: WeekTemplate }) => result.template.components.map(item => item.id);
const titles = (result: { template: WeekTemplate }) => result.template.components.map(item => item.title);

describe('week template merge', () => {
  it('keeps both editors when they edit different components', () => {
    const base = template([component('C1'), component('C2')]);
    const local = template([component('C1', { title: 'B edited this' }), component('C2')]);
    const remote = template([component('C1'), component('C2', { title: 'A edited this' })]);

    const result = mergeWeekTemplates(base, local, remote);

    expect(titles(result)).toEqual(['B edited this', 'A edited this']);
    expect(result.notices).toEqual([]);
  });

  it('keeps both editors when they change different fields of one component', () => {
    const base = template([component('C1', { title: 'Reading task' })]);
    const local = template([component('C1', { title: 'Reading task', description: 'B wrote this' })]);
    const remote = template([component('C1', { title: 'Reading task', expectedOtjh: 3 })]);

    const result = mergeWeekTemplates(base, local, remote);

    expect(result.template.components[0]).toMatchObject({ description: 'B wrote this', expectedOtjh: 3 });
    expect(result.notices).toEqual([]);
  });

  it('keeps this reader and names the component when both edit the same field', () => {
    const base = template([component('C1', { title: 'Reading task' }), component('C2')]);
    const local = template([component('C1', { title: 'B title' }), component('C2')]);
    const remote = template([component('C1', { title: 'A title' }), component('C2', { description: 'A wrote this' })]);

    const result = mergeWeekTemplates(base, local, remote);

    expect(result.template.components[0].title).toBe('B title');
    // The component they did not both touch is merged, not reported.
    expect(result.template.components[1].description).toBe('A wrote this');
    expect(result.notices).toHaveLength(1);
    expect(result.notices[0]).toMatch(/both changed the title in "B title"/i);
  });

  it('adds a component from each editor without duplicating or losing either', () => {
    const base = template([component('C1')]);
    const local = template([component('C1'), component('B-NEW')]);
    const remote = template([component('C1'), component('A-NEW')]);

    const result = mergeWeekTemplates(base, local, remote);

    expect(ids(result)).toEqual(['C1', 'B-NEW', 'A-NEW']);
    expect(new Set(ids(result)).size).toBe(3);
  });

  it('takes a component the other editor added while this one edited another', () => {
    const base = template([component('C1')]);
    const local = template([component('C1', { title: 'B edited this' })]);
    const remote = template([component('C1'), component('A-NEW')]);

    const result = mergeWeekTemplates(base, local, remote);

    expect(ids(result)).toEqual(['C1', 'A-NEW']);
    expect(result.template.components[0].title).toBe('B edited this');
    expect(result.notices).toEqual([]);
  });

  it('honours a delete of a component this reader never touched', () => {
    const base = template([component('C1'), component('C2')]);
    const local = template([component('C1', { title: 'B edited this' }), component('C2')]);
    const remote = template([component('C1')]);

    const result = mergeWeekTemplates(base, local, remote);

    expect(ids(result)).toEqual(['C1']);
    expect(result.notices).toEqual([]);
  });

  it('keeps a component the other editor deleted under an editor working in it', () => {
    const base = template([component('C1'), component('C2')]);
    const local = template([component('C1'), component('C2', { description: 'B spent an hour on this' })]);
    const remote = template([component('C1')]);

    const result = mergeWeekTemplates(base, local, remote);

    expect(ids(result)).toEqual(['C1', 'C2']);
    expect(result.template.components[1].description).toBe('B spent an hour on this');
    expect(result.notices[0]).toMatch(/deleted a component you were editing/i);
  });

  it('does not resurrect a component this reader deleted', () => {
    const base = template([component('C1'), component('C2')]);
    const local = template([component('C1')]);
    const remote = template([component('C1'), component('C2', { title: 'A renamed it' })]);

    const result = mergeWeekTemplates(base, local, remote);

    expect(ids(result)).toEqual(['C1']);
    expect(result.notices[0]).toMatch(/stays deleted/i);
  });

  it('takes the other editor reorder when this one has not reordered', () => {
    const base = template([component('C1'), component('C2'), component('C3')]);
    const local = template([component('C1'), component('C2'), component('C3', { title: 'B edited this' })]);
    const remote = template([component('C3'), component('C1'), component('C2')]);

    const result = mergeWeekTemplates(base, local, remote);

    expect(ids(result)).toEqual(['C3', 'C1', 'C2']);
    expect(result.template.components[0].title).toBe('B edited this');
    expect(result.notices).toEqual([]);
  });

  it('keeps this reader order and says so when both reordered', () => {
    const base = template([component('C1'), component('C2'), component('C3')]);
    const local = template([component('C2'), component('C1'), component('C3')]);
    const remote = template([component('C3'), component('C2'), component('C1')]);

    const result = mergeWeekTemplates(base, local, remote);

    expect(ids(result)).toEqual(['C2', 'C1', 'C3']);
    expect(result.notices[0]).toMatch(/both reordered the components/i);
  });

  it('merges settings key by key rather than whole', () => {
    const base = template([component('C1', { settings: { videoUrl: '', instructions: '' } })]);
    const local = template([component('C1', { settings: { videoUrl: '', instructions: 'B wrote instructions' } })]);
    const remote = template([component('C1', { settings: { videoUrl: 'https://video', instructions: '' } })]);

    const result = mergeWeekTemplates(base, local, remote);

    expect(result.template.components[0].settings).toMatchObject({
      videoUrl: 'https://video',
      instructions: 'B wrote instructions',
    });
    expect(result.notices).toEqual([]);
  });

  it('never reports a derived count or a rule-driven point value as a disagreement', () => {
    // Two adds of different sizes, and a points rule that resolved at different
    // moments on the two screens. Nobody decided either of these.
    const base = template([component('C1', { points: 5 })]);
    const local = template([component('C1', { points: 30 }), component('B-1'), component('B-2')]);
    const remote = template([component('C1', { points: 20 }), component('A-1')]);

    const result = mergeWeekTemplates(base, local, remote);

    expect(result.notices).toEqual([]);
    expect(ids(result)).toEqual(['C1', 'B-1', 'B-2', 'A-1']);
  });

  it('takes the stored template whole when this reader has changed nothing', () => {
    const base = template([component('C1')]);
    const remote = template([component('C1', { title: 'A renamed it' }), component('A-NEW')]);

    const result = mergeWeekTemplates(base, base, remote);

    expect(ids(result)).toEqual(['C1', 'A-NEW']);
    expect(result.template.components[0].title).toBe('A renamed it');
    expect(result.notices).toEqual([]);
  });

  it('never rewrites a component id', () => {
    const base = template([component('C1'), component('C2')]);
    const local = template([component('C1', { title: 'B' }), component('C2')]);
    const remote = template([component('C1'), component('C2', { title: 'A' })]);

    const result = mergeWeekTemplates(base, local, remote);

    expect(ids(result)).toEqual(['C1', 'C2']);
  });
});
