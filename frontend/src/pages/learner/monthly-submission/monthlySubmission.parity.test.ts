import { expect, it } from 'vitest';
import type { LearnerComponentEntry, LearnerDetail } from '@/api/learnerDetail';
import { hasComponentContent } from '@/utils/learnerJourney';
import { groupMonthlyAssignments, isOverdueAssignment, type AssignmentSource } from './model';

/** The fields the Monthly Submission list endpoint sends for one row. */
const LIST_FIELDS = ['componentId', 'type', 'component', 'module', 'week', 'sessionDate', 'expectedOtjh'] as const;

/** What the server sends for the learner-detail payload below: assignments only,
 * no brief, and marking/progress limited to those assignments. */
function listProjection(detail: LearnerDetail): AssignmentSource {
  const rows = detail.components.filter(row => row.componentId && row.type?.trim().toLowerCase().replace(/-/g, '_') === 'assignment');
  const seen = new Set<string>();
  const components = rows.filter(row => !seen.has(row.componentId!) && seen.add(row.componentId!)).map(row => ({
    ...Object.fromEntries(LIST_FIELDS.filter(key => row[key] !== undefined).map(key => [key, row[key]])),
    contentAvailable: hasComponentContent({ ...row, title: row.component }),
  }) as LearnerComponentEntry);
  const ids = new Set(components.map(row => row.componentId));
  return {
    components,
    componentMarkingStatus: Object.fromEntries(Object.entries(detail.componentMarkingStatus || {}).filter(([id]) => ids.has(id))),
    videoProgress: (detail.videoProgress || []).filter(row => ids.has(row.componentId)),
    componentProgress: (detail.componentProgress || []).filter(row => ids.has(row.componentId)),
  };
}

const assignment = (id: string, extra: Partial<LearnerComponentEntry> = {}): LearnerComponentEntry => ({
  componentId: id, component: `Assignment · ${id}`, type: 'assignment', moduleId: 'M1', module: 'Data and insight',
  week: 'Week 1', expectedOtjh: 4, ...extra,
});
const detail = {
  id: '125', name: 'Learner',
  components: [
    assignment('A1', { assignmentBrief: 'Explain your data decisions.', sessionDate: '2026-09-09' }),
    assignment('A2', { type: 'Assignment', resourceUrl: '/curriculum_api/curriculum/uploads/file.docx', expectedOtjh: null }),
    assignment('A1', { assignmentBrief: 'A repeated row' }),
    assignment('A3', { description: '<p>Answer the question.</p>', week: 'Week 2' }),
    assignment('A4', { sessionDate: '2026-10-01' }),
    assignment('A5', { assignmentTopics: [{ id: 't1', name: 'Option', question: '<p>Q</p>', instructions: '', resources: [] }] }),
    assignment('A6', { type: ' ASSIGNMENT ', sessionDate: '2026-08-04' }),
    assignment('A7', { sessionDate: '2026-09-20' }),
    { ...assignment('R1'), type: 'reading', hasReadingContent: true },
    { ...assignment('V1'), type: 'video', videoUrl: 'https://video.example/v1' },
  ],
  componentMarkingStatus: {
    A3: { status: 'referred', feedback: 'Add an example.', reviewedBy: 'Coach', reviewedAt: '2026-09-20T10:00:00Z' },
    A4: { status: 'accepted', feedback: '', reviewedBy: '', reviewedAt: null },
    R1: { status: 'accepted', feedback: '', reviewedBy: '', reviewedAt: null },
  },
  videoProgress: [{ componentId: 'V1', kind: 'video', passed: true }],
  componentProgress: [{ componentId: 'A2', kind: 'component', passed: null }, { componentId: 'A5', kind: 'component', passed: false },
    { componentId: 'R1', kind: 'component', passed: true }],
  quizAttempts: [], activityFeed: [], ksbs: [], week: [], modules: [],
} as unknown as LearnerDetail;

const metadata = { covers: {}, activity_dates: {
  A1: { date: '2026-09-09', month: '2026-09', date_source: 'builder_week', due_timing: 'End of week', week_end: '2026-09-13' },
  A2: { date: '2026-09-16', month: '2026-09', date_source: 'builder_week' },
  A3: { date: '2026-10-07', month: '2026-10', date_source: 'builder_week', date_needs_review: true },
  A5: { date: '2026-07-01', month: '2026-07', date_source: 'original_created_at' },
} } as never;
const contract = { months: { '2026-09': { label: 'Month 4', topics: ['Data'], planned: 40, source: 'contract',
  activities: [{ title: 'Data Coach Led Assignment', method: 'Assignment' }] } }, contractStatus: 'ready' } as never;

const PAGE_FIELDS = ['id', 'title', 'date', 'dueDate', 'month', 'status', 'submitted', 'awaitingBrief', 'action',
  'expectedOtjh', 'module', 'week', 'submissionCount', 'marking'] as const;
const visible = (groups: ReturnType<typeof groupMonthlyAssignments>) => groups.map(group => ({
  month: group.month, label: group.label, topics: group.topics, planAssignments: group.planAssignments, submitted: group.submitted,
  assignments: group.assignments.map(row => Object.fromEntries(PAGE_FIELDS.map(key => [key, row[key]]))),
}));

it.each([
  ['statuses loaded', { A1: 'draft', A6: 'submitted_for_tutor_review' }],
  ['statuses unavailable', null],
] as const)('groups the list projection exactly as learner detail (%s)', (_name, statuses) => {
  const counts = statuses ? { A1: 2, A6: 1 } : {};
  const full = groupMonthlyAssignments(detail, metadata, contract, statuses, counts);
  const light = groupMonthlyAssignments(listProjection(detail), metadata, contract, statuses, counts);
  expect(visible(light)).toEqual(visible(full));
  for (const today of ['2026-09-10', '2026-09-14', '2026-11-04']) {
    expect(light.flatMap(group => group.assignments.filter(row => isOverdueAssignment(row, today)).map(row => row.id)))
      .toEqual(full.flatMap(group => group.assignments.filter(row => isOverdueAssignment(row, today)).map(row => row.id)));
  }
  // The fixture exercises every precedence step and the awaiting-brief rule.
  const rows = Object.fromEntries(full.flatMap(group => group.assignments).map(row => [row.id, row]));
  expect(Object.keys(rows).sort()).toEqual(['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7']);
  expect(rows.A1.status).toBe(statuses ? 'draft' : '');
  expect(rows.A3.status).toBe('referred');      // coach marking
  expect(rows.A2.status).toBe('completed');     // recorded completion
  expect(rows.A5.status).toBe(statuses ? 'todo' : '');  // a failed attempt is not a completion
  expect(rows.A1.dueDate).toBe('2026-09-13');
  expect(rows.A3.month).toBe('');               // a date needing review stays unscheduled
  expect(rows.A7.awaitingBrief).toBe(Boolean(statuses));
  expect(rows.A4.awaitingBrief).toBe(false);
});
