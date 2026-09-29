import { describe, expect, it } from 'vitest';
import type { CoachLearnerCaseFileData } from '../types';
import { normalizeKsbCode, selectCaseFileKsbRows, selectCaseFileKsbSummary } from './ksbSelectors';

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
