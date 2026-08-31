import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { OtjhBody } from '../RealOtjhView';
import type { LearnerDetail } from '@/api/learnerDetail';

// ---------------------------------------------------------------------------
// The activity log is what the "Completed" figure is made of, so it has to
// account for all of it. It used to list quiz attempts and videos only, leaving
// a learner whose hours came from readings, decks or assignments looking at a
// log that did not add up to their own total.
//
// The hours per row follow the backend's rule (see
// active_users.completed_hours_from_progress): the component's own off-the-job
// hours first, whatever the learner reported second.
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

  it("counts a component's own hours, not a bare reported number", () => {
    // "60" against a component worth 1h is 60 minutes; reading it as 60 hours
    // is what made the breakdown claim more than the whole programme.
    renderBody({
      componentProgress: [{ ...assignment, expectedOtjh: 1, reportedTime: '60' }],
      components: [{ component: 'Reading Material 2', componentId: 'COMP-ASSIGN', type: 'reading', expectedOtjh: 1 }] as LearnerDetail['components'],
    } as Partial<LearnerDetail>);

    expect(screen.getByText(/1 entry · 1h/)).toBeTruthy();
  });

  it('falls back to a large bare number as minutes, like the total does', () => {
    renderBody({
      componentProgress: [{ ...assignment, expectedOtjh: 0, reportedTime: '90' }],
    } as Partial<LearnerDetail>);

    expect(screen.getByText(/1 entry · 1h 30m/)).toBeTruthy();
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

  it('counts a component completed twice once, as the total does', () => {
    renderBody({
      componentProgress: [
        assignment,
        { ...assignment, submittedAt: '2026-08-28T09:00:00Z' },
      ],
      components: components as LearnerDetail['components'],
    } as Partial<LearnerDetail>);

    // Both attempts are listed — they happened — but the hours count once.
    expect(screen.getByText(/2 entries · 2h/)).toBeTruthy();
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
