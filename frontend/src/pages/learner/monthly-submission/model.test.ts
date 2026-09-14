import { describe, expect, it } from 'vitest';
import type { LearnerComponentEntry, LearnerDetail } from '@/api/learnerDetail';
import { assignmentCounts, currentAssignmentMonthKey, defaultAssignmentMonth, groupMonthlyAssignments, nextMonthlyAssignment } from './model';

function component(id: string, extra: Partial<LearnerComponentEntry> = {}): LearnerComponentEntry {
  return { componentId: id, component: `Assignment ${id}`, type: 'assignment',
    module: 'Marketing', week: 'Workplace practice', expectedOtjh: 2,
    assignmentBrief: 'Explain how you applied your learning at work.', ...extra };
}

function learner(components: LearnerComponentEntry[], extra: Partial<LearnerDetail> = {}): LearnerDetail {
  return { components, componentProgress: [], videoProgress: [], quizAttempts: [], ...extra } as LearnerDetail;
}

const dates = { covers: {}, activity_dates: {
  A1: { date: '2026-09-09', date_source: 'builder_week' },
  A2: { date: '2026-10-07', date_source: 'builder_week' },
} };

describe('monthly assignment dates', () => {
  it('defaults only to the current London month, including when it has no scheduled work', () => {
    const groups = groupMonthlyAssignments(learner([component('A1'), component('A2')]), dates, null, {});
    expect(defaultAssignmentMonth(groups, new Date('2026-09-14T12:00:00Z'))?.month).toBe('2026-09');
    expect(defaultAssignmentMonth(groups, new Date('2026-07-01T12:00:00Z'))).toBeUndefined();
    expect(defaultAssignmentMonth(groups, new Date('2027-01-01T12:00:00Z'))).toBeUndefined();
  });

  it('uses the London month around a UTC month boundary', () => {
    const groups = groupMonthlyAssignments(learner([component('A1'), component('A2')]), dates, null, {});
    expect(defaultAssignmentMonth(groups, new Date('2026-08-31T23:30:00Z'))?.month).toBe('2026-09');
    expect(currentAssignmentMonthKey(new Date('2026-08-31T23:30:00Z'))).toBe('2026-09');
  });

  it('deduplicates assignment identities and does not list reading activities as submissions', () => {
    const groups = groupMonthlyAssignments(learner([
      component('A1'), component('A1'), component('R1', { type: 'reading' }), component('A2'),
    ]), dates, null, {});
    expect(groups.flatMap(group => group.assignments.map(row => row.id))).toEqual(['A1', 'A2']);
  });

  it('does not use import dates or ambiguous delivery dates to claim a scheduled month', () => {
    const groups = groupMonthlyAssignments(learner([component('A1'), component('A2')]), {
      covers: {}, activity_dates: {
        A1: { date: '2026-09-01', date_source: 'original_created_at' },
        A2: { date: '2026-10-01', date_source: 'builder_section_title', date_needs_review: true },
      },
    }, null, {});
    expect(groups).toHaveLength(1);
    expect(groups[0].month).toBe('');
    expect(groups[0].assignments.every(row => row.date === '')).toBe(true);
  });
});

describe('monthly assignment actions', () => {
  it.each([
    ['todo', 'Start assignment'],
    ['draft', 'Continue assignment'],
    ['referred', 'Read feedback & update'],
    ['returned', 'Read feedback & update'],
    ['rejected', 'Read feedback & update'],
    ['partial', 'Read feedback & update'],
    ['submitted_for_tutor_review', 'View submission'],
    ['escalated', 'View submission'],
    ['accepted', 'View result'],
    ['completed', 'View result'],
  ])('gives %s work the appropriate direct action', (status, action) => {
    const [group] = groupMonthlyAssignments(learner([component('A1')]), dates, null, { A1: status });
    expect(group.assignments[0].action).toBe(action);
  });

  it('does not present unknown submission states as new work', () => {
    const [group] = groupMonthlyAssignments(learner([component('A1')]), dates, null, null);
    expect(group.assignments[0]).toMatchObject({ status: '', action: 'Open assignment', awaitingBrief: false });
  });

  it('keeps existing work openable when the authored brief has been removed', () => {
    const real = learner([component('A1', { assignmentBrief: null })]);
    const draft = groupMonthlyAssignments(real, dates, null, { A1: 'draft' })[0].assignments[0];
    const unknown = groupMonthlyAssignments(real, dates, null, null)[0].assignments[0];
    expect(draft).toMatchObject({ awaitingBrief: false, action: 'Continue assignment' });
    expect(unknown).toMatchObject({ awaitingBrief: false, action: 'Open assignment' });
  });

  it('requires a brief before starting a new assignment and accepts a file-only brief', () => {
    const real = learner([
      component('A1', { assignmentBrief: null }),
      component('A2', { assignmentBrief: null, resourceUrl: '/uploads/brief.pdf' }),
    ]);
    const rows = groupMonthlyAssignments(real, dates, null, {}).flatMap(group => group.assignments);
    expect(rows[0]).toMatchObject({ awaitingBrief: true, action: 'Awaiting assignment brief' });
    expect(rows[1]).toMatchObject({ awaitingBrief: false, action: 'Start assignment' });
  });
});

describe('current-month work prioritisation', () => {
  function rows(statuses: Record<string, string>) {
    return groupMonthlyAssignments(learner(Object.keys(statuses).map(id => component(id))), null, null, statuses)[0].assignments;
  }

  it('puts requested changes before saved drafts and then work that has not started', () => {
    const assignments = rows({ todo: 'todo', draft: 'draft', changes: 'referred' });
    expect(nextMonthlyAssignment(assignments)?.id).toBe('changes');
    expect(nextMonthlyAssignment(assignments.filter(row => row.id !== 'changes'))?.id).toBe('draft');
    expect(nextMonthlyAssignment(assignments.filter(row => row.id === 'todo'))?.id).toBe('todo');
  });

  it('does not recommend missing briefs, unknown statuses or work already submitted', () => {
    const assignments = groupMonthlyAssignments(learner([
      component('missing', { assignmentBrief: null }), component('unknown'), component('submitted'), component('done'),
    ]), null, null, { missing: 'todo', unknown: 'unrecognised', submitted: 'submitted_for_tutor_review', done: 'accepted' })[0].assignments;
    expect(nextMonthlyAssignment(assignments)).toBeUndefined();
  });

  it('keeps work, review, completion, missing briefs and unknown states in distinct counts', () => {
    const assignments = groupMonthlyAssignments(learner([
      component('todo'), component('draft'), component('referred'), component('submitted'),
      component('accepted'), component('completed'), component('missing', { assignmentBrief: null }), component('unknown'),
    ]), null, null, { todo: 'todo', draft: 'draft', referred: 'referred', submitted: 'submitted_for_tutor_review',
      accepted: 'accepted', completed: 'completed', missing: 'todo', unknown: 'unrecognised' })[0].assignments;
    expect(assignmentCounts(assignments)).toEqual({ needsWork: 3, awaitingReview: 1, completed: 2,
      waitingForBrief: 1, unknown: 1, total: 8 });
  });
});
