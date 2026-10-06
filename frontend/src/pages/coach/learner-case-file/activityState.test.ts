import { describe, expect, it } from 'vitest';
import type { LearnerDetail } from '@/api/learnerDetail';
import type { StudentActivityResponse } from '@/api/studentActivity';
import type { JourneyModule } from '@/utils/learnerJourney';
import { buildCaseFileActivityStates, moduleActivitySummary } from './activityState';

const modules: JourneyModule[] = [{
  module: 'Commercial Intelligence',
  weeks: [{ week: 'Week 1', otjh: 0, components: [
    { componentId: 'component-a', title: 'Repeated title', expectedOtjh: null, type: 'reading' },
    { componentId: 'component-b', title: 'Repeated title', expectedOtjh: null, type: 'video' },
    { componentId: 'component-c', title: 'Third', expectedOtjh: null, type: 'reading' },
  ] }],
}];

const nativeDetail = (overrides: Partial<LearnerDetail> = {}) => ({
  studentActivityAvailable: false,
  quizAttempts: [], videoProgress: [], componentProgress: [], activityFeed: [], componentMarkingStatus: {},
  ...overrides,
} as LearnerDetail);

describe('case-file activity state', () => {
  it('classifies completed, started incomplete, and absent native activity by component id', () => {
    const states = buildCaseFileActivityStates(modules, nativeDetail({
      componentProgress: [{ kind: 'component', componentType: 'reading', componentId: 'component-a',
        startedAt: '2026-09-01T09:00:00Z', submittedAt: '2026-09-01T10:00:00Z', timeTaken: null }],
      videoProgress: [{ kind: 'video', componentId: 'component-b', passed: false,
        startedAt: '2026-09-02T09:00:00Z', submittedAt: '2026-09-02T10:00:00Z', timeTaken: null }],
    }), null);

    expect(states['component-a']).toMatchObject({ status: 'completed', completedAt: '2026-09-01T10:00:00Z' });
    expect(states['component-b'].status).toBe('in-progress');
    expect(states['component-c'].status).toBe('not-started');
  });

  it('does not cross-match duplicate titles or another learner activity', () => {
    const states = buildCaseFileActivityStates(modules, nativeDetail({
      componentProgress: [{ kind: 'component', componentType: 'reading', componentId: 'component-a',
        componentTitle: 'Repeated title', startedAt: null, submittedAt: '2026-09-01T10:00:00Z', timeTaken: null }],
    }), null);
    expect(states['component-a'].status).toBe('completed');
    expect(states['component-b'].status).toBe('not-started');
    expect(states['component-c'].status).toBe('not-started');
  });

  it('uses Aptem group/activity lineage and never native rows for an Aptem learner', () => {
    const aptem = {
      activity_sources: {
        'component-a': { module_id: 'module-1', group_id: 10, activity_id: 100 },
        'component-b': { module_id: 'module-1', group_id: 10, activity_id: 101 },
      },
      activities: [
        { group_id: 10, source_activity_id: 100, completed: true, has_result: true },
        { group_id: 10, source_activity_id: 101, completed: false, has_result: true, video_started: true },
        { group_id: 99, source_activity_id: 100, completed: true, has_result: true },
      ],
    } as unknown as StudentActivityResponse;
    const states = buildCaseFileActivityStates(modules, nativeDetail({
      studentActivityAvailable: true,
      componentProgress: [{ kind: 'component', componentType: 'reading', componentId: 'component-c',
        startedAt: null, submittedAt: '2026-09-01T10:00:00Z', timeTaken: null }],
    }), aptem);
    expect(states['component-a']).toMatchObject({ status: 'completed', sourceRef: 'aptem:10:100', completedAt: null });
    expect(states['component-b'].status).toBe('in-progress');
    expect(states['component-c']).toMatchObject({ status: 'unavailable', unavailableReason: 'no_aptem_result' });
  });

  it('derives module counts, percentage, and all three statuses from activities', () => {
    const all = buildCaseFileActivityStates(modules, nativeDetail({ componentProgress: modules[0].weeks[0].components.map(component => ({
      kind: 'component', componentType: 'reading', componentId: component.componentId!, startedAt: null,
      submittedAt: '2026-09-01T10:00:00Z', timeTaken: null,
    })) }), null);
    expect(moduleActivitySummary(modules[0], all)).toMatchObject({ completed: 3, total: 3, percent: 100, status: 'completed' });

    const partial = { ...all, 'component-b': { ...all['component-b'], status: 'in-progress' as const } };
    expect(moduleActivitySummary(modules[0], partial)).toMatchObject({ completed: 2, total: 3, percent: 67, status: 'in-progress' });

    expect(moduleActivitySummary(modules[0], {})).toMatchObject({ completed: 0, total: 3, percent: 0, status: 'not-started' });
  });
});
