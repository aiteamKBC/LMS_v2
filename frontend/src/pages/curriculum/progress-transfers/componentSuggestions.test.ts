import { describe, expect, it } from 'vitest';
import { byWeek, componentSuggestions, nameSimilarity, suggestedMappings } from './componentSuggestions';
const source = { sourceActivityRef: 'material:7', title: 'P2-PPT-Project Fundamentals and Value Delivery', type: 'quiz', week: '', automaticTargetId: null,
  contentAvailable: false, contentScores: [{ componentId: 'A', score: 0.99 }, { componentId: 'B', score: null }] };
const targets = [
  { componentId: 'A', title: 'Budget planning', type: 'quiz', week: '', plannedHours: null },
  { componentId: 'B', title: 'Project fundamentals & value delivery', type: 'quiz', week: '', plannedHours: null },
];
const module = { moduleId: 'M1', courseRef: 'legacy:50', title: 'New module', sources: [source], targets };
const review = { reviewToken: 'review', csrfToken: 'csrf', modules: [module] };

// The requested matching policy now uses names rather than body content.
describe('component name recommendations', () => {
  it('offers only the recorded different-type recommendation and never preselects it', () => {
    const original = { ...source, title: 'Narrated walkthrough', type: 'video', recommendedTargetId: 'A' };
    const destinations = targets.map(target => ({ ...target, type: 'reading', title: original.title }));
    const result = componentSuggestions(original, destinations, new Set());
    expect(result.candidates.map(t => t.componentId)).toEqual(['A']);
    expect(result.suggestedId).toBe('A');
    expect(componentSuggestions(original, destinations, new Set(['A'])).suggestedId).toBeNull();
    for (const type of ['video', 'reading']) {
      expect(suggestedMappings({ ...review, modules: [{ ...module, sources: [{ ...original, type }], targets: destinations }] })).toEqual([]);
    }
    expect(componentSuggestions({ ...original, recommendedTargetId: 'FOREIGN' }, destinations, new Set()).candidates).toEqual([]);
    expect(componentSuggestions({ ...original, type: 'unknown' }, destinations, new Set()).candidates).toEqual([]);
    // Existing saved selections are not replaced by recommendations on another source.
    expect(suggestedMappings({ ...review, modules: [{ ...module, sources: [original, { ...source, sourceActivityRef: 'material:8', savedTargetId: 'B' }], targets: [...destinations.slice(0, 1), targets[1]] }] }))
      .toEqual([{ moduleId: 'M1', sourceActivityRef: 'material:8', targetComponentId: 'B' }]);
  });
  it('restores saved matches before name suggestions without claiming their destinations twice', () => {
    const saved = { ...source, savedTargetId: 'A' };
    const second = { ...source, sourceActivityRef: 'material:8', title: 'Budget planning' };
    const input = { ...review, modules: [{ ...module, sources: [saved, second] }, { ...module, moduleId: 'M2' }] };
    const before = structuredClone(input);
    expect(suggestedMappings(input)).toEqual([
      { moduleId: 'M1', sourceActivityRef: 'material:7', targetComponentId: 'A' },
      { moduleId: 'M2', sourceActivityRef: 'material:7', targetComponentId: 'B' },
    ]);
    expect(input).toEqual(before);
  });
  it('does not restore saved destinations that are invalid, incompatible, occupied or duplicated', () => {
    const saved = { ...source, title: 'Unrelated old title', savedTargetId: 'A' };
    for (const sources of [
      [{ ...saved, savedTargetId: 'FOREIGN' }], [{ ...saved, type: 'video' }], [{ ...saved, type: 'unknown' }],
      [saved, { ...saved, sourceActivityRef: 'material:8' }],
      [saved, { ...saved, sourceActivityRef: 'material:8', automaticTargetId: 'A' }],
    ]) expect(suggestedMappings({ ...review, modules: [{ ...module, sources }] })).toEqual([]);
  });
  it('preselects an equivalent title with a spaced numeric export prefix', () => {
    const original = { ...source, title: 'Welcome to the scheduling module', type: 'video' };
    for (const prefix of ['00 - ', '00-', '00 : ', '00. ']) {
      const target = { ...targets[0], title: `${prefix}${original.title}`, type: 'video' };
      expect(nameSimilarity(original.title, target.title)).toBe(1);
      expect(suggestedMappings({ ...review, modules: [{ ...module, sources: [original], targets: [target] }] }))
        .toEqual([{ moduleId: 'M1', sourceActivityRef: 'material:7', targetComponentId: 'A' }]);
    }
    expect(nameSimilarity('Session 1 Part 1: Scheduling', '00 - Session 1 Part 2: Scheduling')).toBe(0);
  });
  it('preselects the matching podcast despite dash/spacing differences and a different week', () => {
    const oldTitle = 'AUD–Overview of the Programme and assignment';
    const newTitle = 'AUD - Overview of the Programme and assignment';
    const podcast = { ...source, title: oldTitle, type: 'podcast', week: 'Induction 9/6/2026' };
    const destination = { ...targets[0], title: newTitle, type: 'podcast', week: 'Lecture 1: Introduction' };
    expect(nameSimilarity(oldTitle, newTitle)).toBe(1);
    expect(suggestedMappings({ ...review, modules: [{ ...module, sources: [podcast], targets: [destination] }] }))
      .toEqual([{ moduleId: 'M1', sourceActivityRef: 'material:7', targetComponentId: 'A' }]);
    expect(suggestedMappings({ ...review, modules: [{ ...module, sources: [{ ...podcast, type: 'video' }], targets: [destination] }] }))
      .toEqual([]);
  });
  it('matches names even when content is missing or scores favour a different title', () => {
    const result = componentSuggestions(source, targets, new Set());
    expect(result.candidates.map(t => t.componentId)).toEqual(['B', 'A']);
    expect(result.suggestedId).toBe('B');
  });
  it('allows punctuation, export prefixes, small typos and reordered words', () => {
    for (const [oldTitle, newTitle] of [
      ['P3-PPT-Overview of the Programme and assigment', 'Overview of the programme and assignment'],
      ['P2 - PPT - Project Fundamentals and Value Delivery', 'Project Fundamentals & Value Delivery'],
      ['Quality planning and management', 'Planning and management quality'],
    ]) {
      expect(nameSimilarity(oldTitle, newTitle)).toBeGreaterThanOrEqual(0.84);
      expect(componentSuggestions({ ...source, title: oldTitle }, [{ ...targets[0], title: newTitle }], new Set()).suggestedId).toBe('A');
    }
  });
  it('leaves numbered parts, weak or blank names, and ambiguous titles unresolved', () => {
    expect(nameSimilarity('Project management part 1', 'Project management part 2')).toBe(0);
    for (const title of ['', 'Safety policy']) {
      expect(componentSuggestions({ ...source, title }, targets, new Set()).suggestedId).toBeNull();
    }
    expect(componentSuggestions(source, [targets[1], { ...targets[1], componentId: 'C' }], new Set()).suggestedId).toBeNull();
    expect(componentSuggestions(source, [{ ...targets[1], componentId: 'C', title: 'Project fundamentals and value deliveries' }, targets[1]], new Set()).suggestedId).toBeNull();
  });
  it('does not recommend used, wrong-type or unknown-type components', () => {
    const result = componentSuggestions(source, targets, new Set(['B']));
    expect(result.candidates.map(t => t.componentId)).toEqual(['A', 'B']);
    expect(result.suggestedId).toBeNull();
    expect(componentSuggestions({ ...source, type: 'reading' }, targets, new Set()).candidates).toEqual([]);
    expect(componentSuggestions({ ...source, type: 'unknown' }, [{ ...targets[0], type: 'unknown' }], new Set()).candidates).toEqual([]);
  });
  it('prepares explicit review mappings without mutating the review and keeps modules separate', () => {
    const before = structuredClone(review);
    expect(suggestedMappings({ ...review, modules: [module, { ...module, moduleId: 'M2', sources: [{ ...source, sourceActivityRef: 'material:8' }] }] })).toEqual([
      { moduleId: 'M1', sourceActivityRef: 'material:7', targetComponentId: 'B' },
      { moduleId: 'M2', sourceActivityRef: 'material:8', targetComponentId: 'B' },
    ]);
    expect(review).toEqual(before);
  });
  it('leaves competing sources unresolved and never claims a verified destination', () => {
    const second = { ...source, sourceActivityRef: 'material:8' };
    for (const sources of [[source, second], [second, source], [source, { ...second, automaticTargetId: 'B' }]]) {
      expect(suggestedMappings({ ...review, modules: [{ ...module, sources }] })).toEqual([]);
    }
  });
  it('groups every option into naturally ordered weeks, preserving rank inside each week', () => {
    const rows = [{ week: 'Week 10', id: '10' }, { week: '', id: 'none' }, { week: 'Week 2', id: '2a' }, { week: 'Week 1', id: '1' }, { week: 'Week 2', id: '2b' }];
    expect(byWeek(rows).map(([week, items]) => [week, items.map(row => row.id)])).toEqual([
      ['Week 1', ['1']], ['Week 2', ['2a', '2b']], ['Week 10', ['10']], ['', ['none']],
    ]);
    expect(rows[0].id).toBe('10');
  });
});
