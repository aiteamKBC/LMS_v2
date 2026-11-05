import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import type { LearnerDetail } from '@/api/learnerDetail';
import type { StudentActivityResponse } from '@/api/studentActivity';
import { buildLearnerJourney, isComponentComplete } from '@/utils/learnerJourney';
import { placeActivity } from '../video-watch/weekPreview';
import { buildUnifiedLearningSummary } from './learningSummary';
import { PreviousLearningNotice } from './PreviousLearningNotice';
import { SubjectCard } from './SubjectWorkspace';
import type { PlanModule } from '@/api/trainingPlanDashboard';

const lineage = { courseRef: 'legacy:50', activityId: 'catalogue:50:material:7',
  sourceActivityId: 7, catalogueKind: 'material' as const, completed: true };
const real = {
  modules: ['Updated course'], week: [{ module: 'Updated course', moduleId: 'M', week: 'Week 1', weekId: 'W' }],
  components: [
    { componentId: 'C1', component: 'Renamed reading', type: 'reading', previousLearning: lineage },
    { componentId: 'C2', component: 'Native completion', type: 'reading' },
    { componentId: 'C3', component: 'New content', type: 'reading' },
    { componentId: 'Q', component: 'Updated quiz', type: 'quiz', isQuiz: true, quizMeta: { quizId: 90 },
      previousLearning: { ...lineage, catalogueKind: 'quiz', activityId: 'catalogue:50:quiz:7' } },
  ].map(c => ({ ...c, module: 'Updated course', moduleId: 'M', week: 'Week 1', weekId: 'W', expectedOtjh: 1 })),
  componentProgress: [{ componentId: 'C1', kind: 'component' }, { componentId: 'C2', kind: 'component' }],
  quizAttempts: [{ quizId: 90, passed: false, grade: 0.2 }], videoProgress: [],
} as unknown as LearnerDetail;
const history = { subjects: [{ id: 50, name: 'Original course' }],
  activities: [
    { activity_id: lineage.activityId, source_activity_id: 7, catalogue_kind: 'material', completed: true },
    { activity_id: 'catalogue:50:quiz:7', source_activity_id: 7, catalogue_kind: 'quiz', completed: true },
    { activity_id: 'catalogue:50:material:8', source_activity_id: 8, catalogue_kind: 'material', completed: true },
  ].map(a => ({ ...a, group_id: 50, activity: 'Original title', category: 'reading' })),
} as StudentActivityResponse;
const metadata = { covers: {}, replacement_courses: { 'current:M': 'legacy:50' } };

describe('replacement module transfer', () => {
  it('shows explicitly simulated aggregate progress without completing old or new activities', () => {
    const data = { ...history, activities: history.activities.map(row => ({ ...row, completed: false })) };
    const subject = buildUnifiedLearningSummary(data, real, { ...metadata,
      module_credits: { 'legacy:50': { progress: 40, actualHours: 0, demoProgress: true } } }).subjects[0];
    expect(subject).toMatchObject({ source: 'legacy', demoProgress: true, aggregateProgress: 40, acceptedHours: 0 });
    expect(subject.activities.every(activity => !activity.completed)).toBe(true);
    render(<MemoryRouter><SubjectCard subject={subject} template={null} csrfToken="" onOpen={() => {}} /></MemoryRouter>);
    expect(screen.getByText('Demo progress')).toBeVisible();
    expect(screen.getByText('40%')).toBeVisible();
    expect(screen.getByText('Completed 0m')).toBeVisible();
  });

  it('uses approved aggregate hours against the new plan without overlapping native totals', () => {
    const data = { ...history, subjects: [{ id: 50, name: 'Original course', accepted_hours: 1.5 }],
      replacement_hours: { 'current:M': { course_ref: 'legacy:50', accepted_hours: 1.75 } } };
    const approved = { ...metadata, approved_transfers: { 'current:M': 'legacy:50' },
      module_credits: { 'current:M': { progress: 40, transferredProgress: 40, actualHours: 1.75 } } };
    const subject = buildUnifiedLearningSummary(data, real, approved).subjects[0];
    render(<MemoryRouter><SubjectCard subject={subject} template={null} csrfToken="" onOpen={() => {}}
      planModule={{ total_otjh: 7 } as PlanModule}
      moduleProgress={{ hours: { actual: 0.75 }, ksb: { completed: 0, total: 0 }, attendance: { attended: 0, total: 0 } }} /></MemoryRouter>);
    expect(screen.getByText('Completed 1h 45m')).toBeVisible();
    expect(screen.getByText('Planned 7h')).toBeVisible();
    expect(screen.getByRole('progressbar', { name: 'Updated course hours progress' })).toHaveAttribute('aria-valuenow', '25');
    expect(data.subjects[0].accepted_hours).toBe(1.5);
  });

  it.each([undefined, { 'current:M': { course_ref: 'legacy:99', accepted_hours: 10 } }])(
    'keeps old hours unavailable before approval even when a native total exists', (hours) => {
      const subject = buildUnifiedLearningSummary({ ...history, replacement_hours: hours }, real, metadata).subjects[0];
      expect(subject.acceptedHours).toBeUndefined();
      render(<MemoryRouter><SubjectCard subject={subject} template={null} csrfToken="" onOpen={() => {}}
        planModule={{ total_otjh: 7 } as PlanModule}
        moduleProgress={{ hours: { actual: 0.75 }, ksb: { completed: 0, total: 0 }, attendance: { attended: 0, total: 0 } }} /></MemoryRouter>);
      expect(screen.queryByText('Completed 45m')).not.toBeInTheDocument();
      expect(screen.getByRole('progressbar', { name: 'Original course hours progress' })).not.toHaveAttribute('aria-valuenow');
      expect(screen.getByText('Completed Unavailable')).toBeVisible();
    },
  );

  it('keeps accepted zero distinct from unavailable and ignores unrelated course-hour mappings', () => {
    const data = { ...history, subjects: [{ id: 50, name: 'Original course', accepted_hours: 0 }],
      replacement_hours: { 'current:M': { course_ref: 'legacy:50', accepted_hours: 8 } } };
    expect(buildUnifiedLearningSummary(data, real, metadata).subjects[0].acceptedHours).toBe(0);
    const separate = buildUnifiedLearningSummary(data, real, { covers: {} });
    expect(separate.subjects.find(s => s.id === 'current:M')?.acceptedHours).toBeUndefined();
    expect(separate.subjects).toHaveLength(2);
  });

  it('shows merged completion and historical percentage separately without changing attempts or history', () => {
    const before = JSON.stringify({ real, history });
    const summary = buildUnifiedLearningSummary(history, real, { ...metadata,
      approved_transfers: { 'current:M': 'legacy:50' },
      module_credits: { 'current:M': { progress: 75, transferredProgress: 40, actualHours: 2 } } });
    expect(summary).toMatchObject({ subjectCount: 1, activityCount: 4, completedActivityCount: 3, percent: 75 });
    expect(summary.subjects).toHaveLength(1);
    expect(summary.subjects[0].activities.map(a => [a.id, a.completed])).toEqual([
      ['C1', true], ['C2', true], ['C3', false], ['Q', true],
    ]);
    expect(summary.subjects[0].archivedActivities).toBeUndefined();
    expect(JSON.stringify({ real, history })).toBe(before);
    render(<MemoryRouter><SubjectCard subject={summary.subjects[0]} template={null} csrfToken="" onOpen={() => {}} /></MemoryRouter>);
    expect(screen.getByRole('progressbar', { name: 'Updated course current plan activities progress' })).toHaveAttribute('aria-valuenow', '75');
    expect(screen.getByText('3 of 4 completed')).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent('Progress merged.');
    expect(screen.getByRole('status')).toHaveTextContent('Old LMS progress before transfer: 40% (historical)');
  });

  it('uses the same completion in the activity player and week sidebar without inventing a passed attempt', () => {
    const components = buildLearnerJourney(real)[0].weeks[0].components;
    const quiz = components.find(c => c.componentId === 'Q')!;
    expect(isComponentComplete(quiz, new Set())).toBe(true);
    expect(quiz.quizAttempts).toEqual(real.quizAttempts);
    const placement = placeActivity(real, { componentId: 'C1' }, new Set(['C2']));
    expect(placement?.weeks[0]).toMatchObject({ count: 4, completed: 3 });
  });

  it('retains the old catalogue until current content is available', () => {
    const summary = buildUnifiedLearningSummary(history, null, { ...metadata, current_subjects: [{ id: 'M', title: 'Updated course' }] });
    expect(summary.subjects).toHaveLength(1);
    expect(summary.subjects.find(s => s.id === 'legacy:50')?.activities).toHaveLength(3);
    expect(summary.subjects.every(s => !s.replacementCourseRef)).toBe(true);
  });

  it('links the original record without presenting a new quiz score', () => {
    render(<MemoryRouter><PreviousLearningNotice learning={lineage} kind="commercial" learnerId="12" /></MemoryRouter>);
    expect(screen.getByText(/Completed in previous learning/)).toBeVisible();
    const url = new URL(screen.getByRole('link', { name: 'View original record' }).getAttribute('href')!, 'https://example.test');
    expect(url.searchParams.get('subject')).toBe('legacy:50');
    expect(url.searchParams.get('activity')).toBe(lineage.activityId);
    expect(screen.queryByText(/Passed|100%/)).not.toBeInTheDocument();
  });
});
