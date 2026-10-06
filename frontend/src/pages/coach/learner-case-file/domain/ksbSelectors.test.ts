import { describe, expect, it } from 'vitest';
import type { CoachLearnerCaseFileData } from '../types';
import { normalizeKsbCode, selectCaseFileKsbRows, selectCaseFileKsbSummary, selectCaseFileKsbProgress, selectCaseFileKsbPointRows } from './ksbSelectors';

function caseFile(overrides: Partial<CoachLearnerCaseFileData> = {}): CoachLearnerCaseFileData {
  return {
    touchedKsbCodes: [],
    mappedKsbCodes: [],
    snapshot: null,
    detail: null,
    ...overrides,
  } as CoachLearnerCaseFileData;
}

describe('KSB selectors', () => {
  it('normalizes child codes to their canonical parent', () => {
    expect(normalizeKsbCode(' b1.2 ')).toBe('B1');
    expect(normalizeKsbCode('K12')).toBe('K12');
    expect(normalizeKsbCode('custom')).toBe('CUSTOM');
  });

  it('aggregates child rows under one parent and prefers the parent title', () => {
    const fallback = [
      { code: 'B1.2', description: 'Child', type: 'Behaviour', number: '1.2' },
      { code: 'B1', description: 'Parent', type: 'Behaviour', number: '1' },
      { code: 'B1.1', description: 'Other child', type: 'Behaviour', number: '1.1' },
    ];
    const rows = selectCaseFileKsbRows(caseFile({ mappedKsbCodes: ['B1'] }), fallback);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ code: 'B1', description: 'Parent', category: 'Behaviours' });
  });

  it('keeps evidenced and total counts and unavailable percentages unchanged', () => {
    const rows = selectCaseFileKsbRows(
      caseFile({ touchedKsbCodes: ['S2.1'], mappedKsbCodes: ['S2', 'K1'] }),
      [
        { code: 'S2', description: 'Skill', type: 'Skill', number: '2' },
        { code: 'K1', description: 'Knowledge', type: 'Knowledge', number: '1' },
      ],
    );
    expect(selectCaseFileKsbSummary(rows)).toMatchObject({ total: 2, achieved: 1, remaining: 1, percent: 50 });
    expect(selectCaseFileKsbSummary([])).toMatchObject({ total: 0, achieved: 0, remaining: 0, percent: null });
  });

  it('sorts naturally without mutating its input', () => {
    const fallback = [
      { code: 'K10', description: 'Ten', type: 'Knowledge', number: '10' },
      { code: 'K2', description: 'Two', type: 'Knowledge', number: '2' },
      { code: 'K1', description: 'One', type: 'Knowledge', number: '1' },
    ];
    const original = structuredClone(fallback);

    expect(selectCaseFileKsbRows(caseFile(), fallback).map((row) => row.code)).toEqual(['K1', 'K2', 'K10']);
    expect(fallback).toEqual(original);
  });

  it('groups evidence from child codes under the canonical parent', () => {
    const data = caseFile({
      touchedKsbCodes: ['B1.1'],
      mappedKsbCodes: ['B1'],
      snapshot: {
        ksbCompletedDetails: [{
          code: 'B1.2',
          sources: [{ id: 'evidence-1', title: 'Observed activity', kind: 'live_session' }],
        }],
      } as CoachLearnerCaseFileData['snapshot'],
    });
    const rows = selectCaseFileKsbRows(data, [{ code: 'B1', description: 'Behaviour', type: 'Behaviour', number: '1' }]);

    expect(rows[0]).toMatchObject({ linked: true, evidenceCount: 1 });
    expect(rows[0].evidenceActivities[0]).toMatchObject({ title: 'Observed activity', type: 'Live session' });
  });

  it('resolves a generic video label through the exact completed component id', () => {
    const data = caseFile({
      touchedKsbCodes: ['B3'],
      snapshot: {
        ksbCompletedDetails: [{ code: 'B3', sources: [{ id: 'video-evidence', title: 'Video', typeLabel: 'Video', componentId: 'VIDEO-1' }] }],
      } as CoachLearnerCaseFileData['snapshot'],
      detail: {
        components: [
          { componentId: 'VIDEO-1', component: 'Resilience in practice', type: 'video', ksbMappings: [{ code: 'B3' }] },
          { componentId: 'VIDEO-2', component: 'Unrelated video', type: 'video', ksbMappings: [{ code: 'B3' }] },
        ],
      } as CoachLearnerCaseFileData['detail'],
    });

    const rows = selectCaseFileKsbRows(data, [{ code: 'B3', description: 'Resilience', type: 'Behaviours', number: '3' }]);

    expect(rows[0].evidenceCount).toBe(1);
    expect(rows[0].evidenceActivities[0]).toMatchObject({ title: 'Resilience in practice', type: 'Video' });
    expect(rows[0].evidenceActivities[0].componentId).toBeUndefined();
  });

  it('shows the saved title of a historical video outside the current component list', () => {
    const data = caseFile({
      touchedKsbCodes: ['B1'],
      detail: {
        components: [],
        quizAttempts: [],
        videoProgress: [{
          kind: 'video', componentId: 'legacy-video-1', componentTitle: 'Working with change',
          ksbs: ['B1'], startedAt: null, submittedAt: '2026-09-01T10:00:00Z', timeTaken: null,
        }],
      } as CoachLearnerCaseFileData['detail'],
    });

    const rows = selectCaseFileKsbRows(data, [{ code: 'B1', description: 'Behaviour', type: 'Behaviours', number: '1' }]);

    expect(rows[0].evidenceCount).toBe(1);
    expect(rows[0].evidenceActivities[0]).toMatchObject({ title: 'Working with change', type: 'Video' });
  });

  it('enriches a generic snapshot video from the matching historical completion', () => {
    const data = caseFile({
      touchedKsbCodes: ['B1'],
      snapshot: {
        ksbCompletedDetails: [{ code: 'B1', sources: [{ id: 'evidence-1', title: 'Video', typeLabel: 'Video', componentId: 'legacy-video-1' }] }],
      } as CoachLearnerCaseFileData['snapshot'],
      detail: {
        components: [], quizAttempts: [],
        videoProgress: [{
          kind: 'video', componentId: 'legacy-video-1', componentTitle: 'Working with change',
          ksbs: ['B1'], startedAt: null, submittedAt: '2026-09-01T10:00:00Z', timeTaken: null,
        }],
      } as CoachLearnerCaseFileData['detail'],
    });

    const rows = selectCaseFileKsbRows(data, [{ code: 'B1', description: 'Behaviour', type: 'Behaviours', number: '1' }]);

    expect(rows[0].evidenceActivities).toHaveLength(1);
    expect(rows[0].evidenceActivities[0].title).toBe('Working with change');
  });
});

describe('learner Overview KSB points', () => {
  it('counts activity points without collapsing repeated framework codes', () => {
    const data = caseFile({ metricsAvailable: true, ksbStatus: 'ready', ksbProgress: 85.3,
      ksbEvidencedCount: 498, ksbTotalCount: 584, touchedKsbCodes: ['K1', 'S1', 'B1'],
      ksbCodeProgress: [{ code: 'K1', completed: 200, total: 220 },
        { code: 'K1.1', completed: 100, total: 120 }, { code: 'S1', completed: 150, total: 180 },
        { code: 'B1', completed: 48, total: 64 }] });
    expect(selectCaseFileKsbProgress(data)).toMatchObject({ total: 584, achieved: 498, remaining: 86, percent: 85.3,
      knowledge: { total: 340, achieved: 300 }, skills: { total: 180, achieved: 150 }, behaviours: { total: 64, achieved: 48 } });
  });
  it('does not replace unavailable totals with touched framework codes', () => {
    expect(selectCaseFileKsbProgress(caseFile({ ksbStatus: 'unavailable', touchedKsbCodes: ['K1'],
      ksbEvidencedCount: 1, ksbTotalCount: 1, ksbProgress: 100 }))).toMatchObject({
        total: null, achieved: null, remaining: null, percent: null, knowledge: { total: null, achieved: null } });
  });
});

describe('canonical KSB activity rows', () => {
  it('keeps repeated codes in separate activities with their own completion and details', () => {
    const points = [
      { activityId: '1', code: 'K1', completed: true, title: 'First activity', type: 'reading', module: null, status: null, source: null, completedAt: null, componentId: 'component-1' },
      { activityId: '2', code: 'K1', completed: false, title: 'Second activity', type: 'video', module: null, status: null, source: null, completedAt: null, componentId: null },
      { activityId: '2', code: 'S1.1', completed: false, title: 'Second activity', type: 'video', module: null, status: null, source: null, completedAt: null, componentId: null },
    ];
    const rows = selectCaseFileKsbPointRows(caseFile({ ksbStatus: 'ready', ksbActivityPoints: points, touchedKsbCodes: ['K1'] }));
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((row) => row.id)).size).toBe(3);
    expect(rows.map((row) => row.linked)).toEqual([true, false, false]);
    expect(rows[1].evidenceActivities).toEqual([expect.objectContaining({ activityId: '2', title: 'Second activity' })]);
    expect(rows[2].code).toBe('S1.1');
    expect(points[1].completed).toBe(false);
  });
  it('does not fabricate activity rows from framework or aggregate totals', () => {
    expect(selectCaseFileKsbPointRows(caseFile({ ksbTotalCount: 584, ksbEvidencedCount: 498, mappedKsbCodes: ['K1'] }),
      [{ code: 'K1', description: 'Knowledge', type: 'Knowledge', number: '1' }])).toEqual([]);
  });
});


describe('KSB cell display resolution', () => {
  it.each([
    ['B1.1', '101', 'B1.2', 'B1.1'],
    ['K2', '202', 'K2.3', 'K2.3'],
    ['S4', '303', 'S4.1', 'S4.1'],
    ['B1', undefined, undefined, 'B1'],
    ['B1', '404', undefined, 'B1'],
    ['B1', undefined, 'B1.2', 'B1'],
    ['B1', '505', 'B2.1', 'B1'],
    ['K2', '606', 'K2.3.1', 'K2.3.1'],
  ])('resolves %s through its own stored definition', (code, ksbDefinitionId, definitionCode, expected) => {
    const point = { activityId: 'activity', code, ksbDefinitionId, definitionCode, completed: true,
      title: null, type: null, module: null, status: null, source: null, completedAt: null, componentId: null };
    const [row] = selectCaseFileKsbPointRows(caseFile({ ksbActivityPoints: [point] }));
    expect(row.displayCode).toBe(expected);
    expect(row.typeLetter).toBe(code[0]);
    expect(row.code).toBe(code);
    expect(row.id).toBe(JSON.stringify(['activity', code]));
    expect(row.linked).toBe(true);
  });

  it('never numbers repeated parent rows or guesses from framework children', () => {
    const points = ['one', 'two'].map(activityId => ({ activityId, code: 'B1', completed: false,
      title: null, type: null, module: null, status: null, source: null, completedAt: null, componentId: null }));
    const rows = selectCaseFileKsbPointRows(caseFile({ ksbActivityPoints: points }),
      [{ code: 'B1.1', description: 'Framework child', type: 'Behaviours', number: '1.1' }]);
    expect(rows.map(row => row.displayCode)).toEqual(['B1', 'B1']);
  });
});
