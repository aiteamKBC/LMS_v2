import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { OtjhBody } from '../RealOtjhView';
import type { LearnerDetail } from '@/api/learnerDetail';
import type { StudentActivityResponse } from '@/api/studentActivity';
import type { LearnerMetrics } from '@/api/learnerMetrics';
import { KsbProgressBody } from '../RealKsbView';

// ---------------------------------------------------------------------------
// The activity log is what the "Completed" figure is made of, so it has to
// account for all of it. It used to list quiz attempts and videos only, leaving
// a learner whose hours came from readings, decks or assignments looking at a
// log that did not add up to their own total.
//
// The hours per row follow the backend's rule (see
// active_users.completed_hours_from_progress): the learner-entered time first,
// with tracked or authored time used only when no input was supplied.
// ---------------------------------------------------------------------------

const detail = (overrides: Partial<LearnerDetail> = {}): LearnerDetail => ({
  id: '65',
  name: 'Test Learner',
  email: 'learner@example.com',
  phone: '',
  programme: 'Test fouda',
  programmeStatus: 'Active',
  cohort: 'fouda cohort',
  group: 'Fouda group 1',
  employer: '',
  lineManager: '',
  isActive: true,
  modules: [],
  week: [],
  components: [],
  ksbs: [],
  quizAttempts: [],
  totalExpectedOtjh: 18,
  completedHours: '8',
  plannedHours: '18',
  targetHours: '18',
  ...overrides,
} as LearnerDetail);

const video = {
  kind: 'video' as const,
  componentId: 'COMP-VIDEO',
  expectedOtjh: 6,
  reportedTime: '6',
  startedAt: null,
  submittedAt: '2026-08-27T14:25:58Z',
  timeTaken: '00:00',
};

const assignment = {
  kind: 'component' as const,
  componentType: 'assignment',
  componentId: 'COMP-ASSIGN',
  expectedOtjh: 2,
  reportedTime: '2h',
  startedAt: null,
  submittedAt: '2026-08-27T14:32:13Z',
  timeTaken: '00:33',
};

const components = [
  { component: 'Recorded Session 1', componentId: 'COMP-VIDEO', type: 'video', expectedOtjh: 6 },
  { component: 'Assignment 6', componentId: 'COMP-ASSIGN', type: 'assignment', expectedOtjh: 2 },
];

function renderBody(overrides: Partial<LearnerDetail>) {
  return render(<OtjhBody real={detail(overrides)} loading={false} showHero={false} />);
}

describe('OTJ hours activity log', () => {
  const metrics: LearnerMetrics = { migrated: true,
    programme: { completed: 2, total: 3, percent: 66.67, status: 'ready' },
    otjh: { historical: 1171.34, new: 1, actual: 1172.34, planned: 867 },
    ksb: { completed: 2, total: 3, percent: 66.67, status: 'ready',
      codes: [{ code: 'K1', completed: 2, total: 3, percent: 66.67 }] },
  };
  it('shows the combined actual and contract plan even when the old activity response differs', () => {
    render(<OtjhBody real={detail()} loading={false} showHero={false} metrics={metrics}
      activityData={{ activities: [], audit_lms_actual: 1171.34, audit_tp_planned: 100 } as unknown as StudentActivityResponse} />);
    expect(screen.getByText('1172.34 h')).toBeTruthy();
    expect(screen.getByText('867.00 h')).toBeTruthy();
    expect(screen.queryByText('1171.34 h')).toBeNull();
  });
  it('shows old and new KSB point totals instead of an empty native-only percentage', () => {
    render(<KsbProgressBody real={detail()} loading={false} showHero={false} metric={metrics.ksb} />);
    expect(screen.getByText('2 of 3 points achieved across all components')).toBeTruthy();
    expect(screen.getByRole('cell', { name: 'K1' })).toBeTruthy();
    expect(screen.queryByText('Fully evidenced')).toBeNull();
  });
  it('uses Audit totals in the summary while keeping the activity log traceable', () => {
    const activityData = {
      learner_name: 'Test Learner',
      count: 3,
      unique_activity_count: 2,
      module_count: 38,
      completed_count: 2,
      actual_total: 1,
      recorded_otjh_total: 1.5,
      planned_total: 2,
      audit_tp_planned: 867,
      audit_lms_actual: 1171.34,
      mapped_count: 2,
      planned_mapped_count: 1,
      activities: [
        {
          activity_id: 'la:1:10', source_activity_id: 10, group_id: 1, group_name: 'Old subject',
          date: '2026-09-30', source_date: '2026-05-21', category: 'Reading', activity: 'Historical &amp; reading', status: 'complete',
          completed: true, actual: 1, planned: 2, planned_hours_mapped: true, hours_mapped: true,
          quiz_score: null, quiz_maximum_score: null,
        },
        {
          activity_id: 'la:2:10', source_activity_id: 10, group_id: 2, group_name: 'Shared subject',
          date: '2026-09-30', source_date: '2026-05-21', category: 'Reading', activity: 'Historical &amp; reading', status: 'complete',
          completed: true, actual: 1, planned: 2, planned_hours_mapped: true, hours_mapped: true,
          quiz_score: null, quiz_maximum_score: null,
        },
        {
          activity_id: 'la:1:11', source_activity_id: 11, group_id: 1, group_name: 'Old subject',
          date: '2026-09-30', source_date: '2026-05-21', category: 'Video', activity: 'Mapped but zero time', status: null,
          completed: false, actual: 0, planned: 0, planned_hours_mapped: false, hours_mapped: true,
          quiz_score: null, quiz_maximum_score: null,
        },
      ],
      direct_otjh_activities: [{
        kind: 'component', componentId: 'NEW-READING', componentTitle: 'New reading',
        componentType: 'reading', reportedTime: '30m', submittedAt: '2026-09-10T09:00:00Z',
      }],
    } as StudentActivityResponse;

    render(<OtjhBody real={detail()} loading={false} showHero={false} activityData={activityData} subjectCount={49} />);

    expect(screen.getAllByText('Actual').length).toBeGreaterThan(0);
    expect(screen.getByText('1171.34 h')).toBeTruthy();
    expect(screen.getByText('TP Planned')).toBeTruthy();
    expect(screen.getByText('867.00 h')).toBeTruthy();
    expect(screen.getAllByText('1h 30m').length).toBeGreaterThan(0);
    expect(screen.getByText(/2 entries · 1h 30m/)).toBeTruthy();
    expect(screen.getByText('49 subjects')).toBeTruthy();
    expect(screen.getByText('Historical & reading')).toBeTruthy();
    expect(screen.queryByText('Historical &amp; reading')).toBeNull();
    expect(screen.queryByText('Mapped but zero time')).toBeNull();
    expect(screen.getByText(/May 21, 2026/)).toBeTruthy();
    expect(screen.queryByText(/Sep 30, 2026/)).toBeNull();
    expect(screen.queryByText('Partial mapped plan')).toBeNull();
    expect(screen.queryByText('Current target')).toBeNull();
    expect(screen.queryByText('Progress against current target')).toBeNull();
  });

  it('allocates rounded category minutes so the breakdown equals the visible total', () => {
    const makeActivity = (id: number, category: string) => ({
      activity_id: `la:1:${id}`, source_activity_id: id, group_id: 1, group_name: 'Subject',
      date: '2026-08-10', category, activity: `${category} activity`, status: 'complete',
      completed: true, actual: 30.5 / 60, planned: 0, planned_hours_mapped: false, hours_mapped: true,
      quiz_score: null, quiz_maximum_score: null,
    });
    const activityData = {
      learner_name: 'Test Learner', count: 2, unique_activity_count: 2, module_count: 1,
      completed_count: 2, actual_total: 61 / 60, recorded_otjh_total: 61 / 60,
      planned_total: null, mapped_count: 2, planned_mapped_count: 0,
      activities: [makeActivity(10, 'Video'), makeActivity(11, 'Reading')],
    } as StudentActivityResponse;

    render(<OtjhBody real={detail()} loading={false} showHero={false} activityData={activityData} />);

    expect(screen.getByText(/2 entries · 1h 1m/)).toBeTruthy();
    const breakdownPanel = screen.getByText('By activity type').closest('section');
    expect(breakdownPanel).not.toBeNull();
    expect(within(breakdownPanel!).getByText('31m')).toBeTruthy();
    expect(within(breakdownPanel!).getByText('30m')).toBeTruthy();
  });

  it('lists every kind of completion, not just quizzes and videos', () => {
    renderBody({
      videoProgress: [video],
      componentProgress: [assignment],
      components: components as LearnerDetail['components'],
    } as Partial<LearnerDetail>);

    expect(screen.getByText('Recorded Session 1')).toBeTruthy();
    expect(screen.getByText('Assignment 6')).toBeTruthy();
    expect(screen.getByText(/2 entries/)).toBeTruthy();
  });

  it('adds up to the hours it is explaining', () => {
    // 6h video + 2h assignment = the learner's 8 completed hours.
    renderBody({
      videoProgress: [video],
      componentProgress: [assignment],
      components: components as LearnerDetail['components'],
    } as Partial<LearnerDetail>);

    expect(screen.getByText(/2 entries · 8h/)).toBeTruthy();
  });

  it("counts the learner's input instead of tracked or authored time", () => {
    renderBody({
      componentProgress: [{ ...assignment, expectedOtjh: 1, reportedTime: '3h', verifiedSeconds: 120 }],
      components: [{ component: 'Reading Material 2', componentId: 'COMP-ASSIGN', type: 'reading', expectedOtjh: 1 }] as LearnerDetail['components'],
    } as Partial<LearnerDetail>);

    expect(screen.getByText(/1 entry · 3h/)).toBeTruthy();
  });

  it('falls back to a large bare number as minutes, like the total does', () => {
    renderBody({
      componentProgress: [{ ...assignment, expectedOtjh: 0, reportedTime: '90' }],
    } as Partial<LearnerDetail>);

    expect(screen.getByText(/1 entry · 1h 30m/)).toBeTruthy();
  });

  it('uses tracked time when the learner did not enter a time', () => {
    renderBody({
      componentProgress: [{ ...assignment, expectedOtjh: 2, reportedTime: '', verifiedSeconds: 1800 }],
    } as Partial<LearnerDetail>);

    expect(screen.getByText(/1 entry · 30m/)).toBeTruthy();
  });

  it('keeps different Time spent inputs when reported defaults are identical', () => {
    renderBody({
      videoProgress: [
        {
          ...video,
          componentId: 'VIDEO-1',
          reportedTime: '60',
          claimedSeconds: 3600,
          verifiedSeconds: 11,
        },
        {
          ...video,
          componentId: 'VIDEO-2',
          reportedTime: '60',
          claimedSeconds: 7200,
          verifiedSeconds: 12,
        },
      ],
    } as Partial<LearnerDetail>);

    expect(screen.getByText(/2 entries · 3h/)).toBeTruthy();
    expect(screen.getByText('2h')).toBeTruthy();
  });

  it('groups the hours by what kind of activity they came from', () => {
    renderBody({
      videoProgress: [video],
      componentProgress: [assignment],
      components: components as LearnerDetail['components'],
    } as Partial<LearnerDetail>);

    // Both kinds are named, where the log used to show only "Video".
    expect(screen.getAllByText('Video').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Assignment').length).toBeGreaterThan(0);
  });

  it('uses the highest attempt and shows the attempt count as a note', () => {
    renderBody({
      componentProgress: [
        { ...assignment, attempt: 1, reportedTime: '1h' },
        { ...assignment, attempt: 2, reportedTime: '3h', submittedAt: '2026-08-28T09:00:00Z' },
      ],
      components: components as LearnerDetail['components'],
    } as Partial<LearnerDetail>);

    expect(screen.getByText(/1 entry · 3h/)).toBeTruthy();
    expect(screen.getByText(/2 attempts/)).toBeTruthy();
  });

  it('accounts for the reported case: one video and two readings', () => {
    // The learner whose page showed a single "Video · 60" entry and a breakdown
    // claiming 60 hours, while their total said 5. Their three completions are
    // 1h + 2h + 2h, and the video's "60" is 60 minutes against a 1h component.
    renderBody({
      videoProgress: [{ ...video, expectedOtjh: 1, reportedTime: '60' }],
      componentProgress: [
        { ...assignment, componentId: 'COMP-READ-2', componentType: 'reading', expectedOtjh: 2, reportedTime: '2h' },
        { ...assignment, componentId: 'COMP-READ-3', componentType: 'reading', expectedOtjh: 2, reportedTime: '2h' },
      ],
      components: [
        { component: 'Recorded Session 1', componentId: 'COMP-VIDEO', type: 'video', expectedOtjh: 1 },
        { component: 'Reading Material 2', componentId: 'COMP-READ-2', type: 'reading', expectedOtjh: 2 },
        { component: 'Reading Material 3', componentId: 'COMP-READ-3', type: 'reading', expectedOtjh: 2 },
      ] as LearnerDetail['components'],
      completedHours: '5',
    } as Partial<LearnerDetail>);

    expect(screen.getByText(/3 entries · 5h/)).toBeTruthy();
    expect(screen.getByText('Reading Material 2')).toBeTruthy();
    expect(screen.getByText('Reading Material 3')).toBeTruthy();
    // Reading 4h, Video 1h — not one bar claiming 60.
    expect(screen.getByText('4h')).toBeTruthy();
  });
});
