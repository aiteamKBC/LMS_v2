import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as api from '@/api/studentActivity';
import { currentLearningWeek, subjectWeeks } from './subjectLearning';
import { groupSubjectActivities } from './SubjectWorkspace';
import type { LearnerDetail } from '@/api/learnerDetail';
import type { StudentActivityItem, StudentActivityResponse } from '@/api/studentActivity';
import { buildUnifiedLearningSummary, StudentActivityPanel, subjectsFrom } from './SubjectWorkspace';

vi.mock('./DeferredStudentMaterial', () => ({
  DeferredStudentMaterial: ({ groupId, activityId }: { groupId: number; activityId: number }) =>
    <div>Source material {groupId}/{activityId}</div>,
}));

const activity = (course: number, kind: string, id: number): StudentActivityItem => ({
  activity_id: `record:${course}:${id}`, source_activity_id: 10, group_id: course,
  group_name: `Course ${course}`, activity: `${kind} ${id}`, category: kind, catalogue_kind: kind,
  can_open_material: kind === 'material', completed: true, status: 'Complete', date: null,
  actual: 0.3, planned: 0, hours_mapped: true, planned_hours_mapped: false,
  quiz_score: null, quiz_maximum_score: null,
});
const data: StudentActivityResponse = {
  learner_name: 'Synthetic learner', progress_basis: 'recorded_activities', count: 3,
  unique_activity_count: 3, module_count: 2, completed_count: 3, actual_total: 0.9,
  planned_total: null, mapped_count: 3, planned_mapped_count: 0,
  subjects: [{ id: 1, name: 'Course 1', module_id: 'HISTORY', catalogue_count: 265, accepted_hours: 0.3 },
    { id: 2, name: 'Course 2', catalogue_count: 36, accepted_hours: 0.6 }],
  activities: [activity(1, 'quiz', 1), activity(2, 'material', 2), activity(2, 'quiz', 3)],
};

const pending = (course: number, id: number): StudentActivityItem => ({
  ...activity(course, 'material', id), activity_id: `catalogue:${course}:material:${id}`,
  source_activity_id: id, activity: `Pending lesson ${course}-${id}`,
  completed: false, status: 'Not started', actual: 0, hours_mapped: false, has_result: false,
});
const catalogueData: StudentActivityResponse = {
  ...data, progress_basis: 'catalogue_activities', count: 6, unique_activity_count: 6,
  module_count: 3,
  subjects: [{ ...data.subjects![0], catalogue_count: 3 }, data.subjects![1],
    { id: 3, name: 'Unstarted course', catalogue_count: 1, accepted_hours: 0 }],
  activities: [...data.activities.map(item => ({ ...item,
    activity_id: `catalogue:${item.group_id}:${item.catalogue_kind}:${item.source_activity_id}`,
    record_ids: [item.activity_id.split(':').at(-1)!],
  })), pending(1, 10), pending(1, 20), pending(3, 10)],
};

describe('full historical course catalogue', () => {
  afterEach(() => vi.restoreAllMocks());

  it('keeps month-only source placements distinct and chronological on the learning map', () => {
    const recovered = { ...catalogueData, activities: [
      { ...pending(1, 10), month: '2026-09', date_source: 'section_month' },
      { ...pending(1, 20), month: '2026-04', date_source: 'section_month' },
      { ...pending(1, 30), month: '2026-03', date_source: 'section_month' },
      { ...pending(1, 40), month: 'undated', date_needs_review: true },
    ] };
    const subject = subjectsFrom(recovered, null)[0];
    const weeks = subjectWeeks(subject);
    expect(weeks.map(week => week.activities.map(item => item.legacy?.source_activity_id))).toEqual([[30], [20], [10], [40]]);
    expect(weeks.slice(0, 3).map(week => week.label)).toEqual(['March 2026', 'April 2026', 'September 2026']);
    expect(weeks.every(week => week.start === null && week.end === null)).toBe(true);
    expect(currentLearningWeek(subject, '2026-04-15')).toBeUndefined();
    expect(groupSubjectActivities(subject.activities).map(group => group.month)).toEqual(['2026-03', '2026-04', '2026-09', 'undated']);
  });

  it.each(['commercial', 'apprenticeship'])('shows a sourced month without describing its activities as awaiting a date (%s)', async kind => {
    vi.spyOn(api, 'subjectRequest').mockResolvedValue({ covers: {} });
    const recovered = { ...catalogueData, activities: [
      { ...pending(1, 10), month: '2026-03', date_source: 'section_month' },
    ] };
    render(<MemoryRouter initialEntries={['/?subject=legacy%3A1']}><StudentActivityPanel data={recovered}
      kind={kind} learnerId="77" loading={false} error={null} onRetry={vi.fn()} /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'Expand March 2026' }));
    fireEvent.click(screen.getByRole('button', { name: 'Expand March 2026, Activities in this month' }));
    expect(screen.getByRole('group', { name: 'Pending lesson 1-10 activity' })).toBeVisible();
    expect(screen.queryByText('Activities awaiting a date')).not.toBeInTheDocument();
    expect(screen.queryByText('Undated activities')).not.toBeInTheDocument();
  });

  it('uses recovered source months and introduction consistently in the catalogue and map', () => {
    const recovered = { ...catalogueData, activities: [
      { ...pending(1, 10), month: 'undated', date_source: 'introduction' },
      { ...pending(1, 20), month: '2026-03', date: '2026-03-06', date_source: 'section_title', week_start: '2026-03-02', week_end: '2026-03-08' },
      { ...pending(1, 30), month: 'undated', date_needs_review: true },
    ] };
    const subject = subjectsFrom(recovered, null)[0];
    expect(groupSubjectActivities(subject.activities).map(group => group.month)).toEqual(['introduction', '2026-03', 'undated']);
    expect(subjectWeeks(subject).map(week => week.id)).toEqual(['introduction', '2026-03-02', 'undated']);
    expect(subject.activities.every(item => !item.completed)).toBe(true);
  });

  it.each(['commercial', 'apprenticeship'])('links a recovered quiz source to the exact parent in its course (%s)', async kind => {
    vi.spyOn(api, 'subjectRequest').mockResolvedValue({ covers: {} });
    const recovered = { ...catalogueData, activities: catalogueData.activities.map(item => item.catalogue_kind === 'quiz' && item.group_id === 1
      ? { ...item, completed: false, source_material_activity_id: 'catalogue:1:material:20' } : item) };
    render(<MemoryRouter initialEntries={['/?activity=catalogue:1:quiz:10']}><StudentActivityPanel data={recovered}
      kind={kind} learnerId="77" loading={false} error={null} onRetry={vi.fn()} /></MemoryRouter>);
    const row = within(await screen.findByRole('group', { name: 'quiz 1 activity' }));
    expect(row.getByRole('link', { name: 'View source material' })).toHaveAttribute('href',
      `/learner/my-learning/${kind}/77?subject=legacy%3A1&activity=catalogue%3A1%3Amaterial%3A20`);
    expect(row.queryByText('Content not available yet')).not.toBeInTheDocument();
    expect(row.getByText('Not complete')).toBeVisible();
    expect(row.queryByRole('button', { name: 'Open activity' })).not.toBeInTheDocument();
    fireEvent.click(row.getByRole('link', { name: 'View source material' }));
    expect(await screen.findByText('Source material 1/20')).toBeVisible();
    expect(screen.queryByText('Source material 1/10')).not.toBeInTheDocument();
    expect(screen.queryByText('Source material 2/20')).not.toBeInTheDocument();
  });

  it('counts every component, preserving distinct quiz/material and course identities', () => {
    const result = buildUnifiedLearningSummary(catalogueData, null);
    expect(result.subjects.map(subject => subject.activities.length)).toEqual([3, 2, 1]);
    expect(result.activityCount).toBe(6);
    expect(result.completedActivityCount).toBe(3);
    expect(result.percent).toBe(50);
  });

  it('keeps the full imported catalogue separate from a duplicate Builder snapshot', () => {
    const real = { modules: ['Current KSBs'], components: [
      { moduleId: 'CURRENT', componentId: 'C1', component: 'Current task', module: 'Current KSBs', type: 'reading' },
      { moduleId: 'HISTORY', componentId: 'C2', component: 'Snapshot of imported component', module: 'Course 1', type: 'reading' },
    ], progress: [], quizAttempts: [] } as unknown as LearnerDetail;
    const result = subjectsFrom(catalogueData, real, { covers: {}, current_subjects: [
      { id: 'CURRENT', title: 'Current KSBs' }, { id: 'HISTORY', title: 'Course 1' },
    ] });
    expect(result.find(subject => subject.id === 'legacy:1')?.activities).toHaveLength(3);
    expect(result.some(subject => subject.id === 'current:HISTORY')).toBe(false);
    expect(result.find(subject => subject.id === 'current:CURRENT')?.activities).toHaveLength(1);
  });

  it('shows the full denominator and both completed and remaining components after opening', async () => {
    render(<MemoryRouter><StudentActivityPanel data={catalogueData} loading={false} error={null} onRetry={vi.fn()} /></MemoryRouter>);
    const card = screen.getByRole('button', { name: /Course 1.*Open subject/ });
    expect(within(card).getByText('1 of 3 completed')).toBeVisible();
    expect(within(card).getByText('33.33%')).toBeVisible();
    expect(within(card).getByText('In progress')).toBeVisible();
    expect(within(card).getByText(/Accepted time: 18m/)).toBeVisible();
    expect(screen.queryByText(/Recorded activities only/)).not.toBeInTheDocument();
    expect(within(screen.getByRole('button', { name: /Unstarted course.*Open subject/ })).getByText('0 of 1 completed')).toBeVisible();
    fireEvent.click(card);
    fireEvent.click(screen.getByRole('button', { name: 'Expand Undated activities' }));
    fireEvent.click(screen.getByRole('button', { name: 'Expand Undated activities, Activities awaiting a date' }));
    expect(await screen.findByRole('group', { name: 'quiz 1 activity' })).toHaveTextContent('Complete');
    expect(screen.getByRole('group', { name: 'Pending lesson 1-10 activity' })).toHaveTextContent('Not complete');
    expect(screen.getByRole('group', { name: 'Pending lesson 1-20 activity' })).toHaveTextContent('Not complete');
  });

  it('preserves links from a recorded activity to its catalogue component', async () => {
    render(<MemoryRouter initialEntries={['/?activity=record:1']}><StudentActivityPanel data={catalogueData} loading={false} error={null} onRetry={vi.fn()} /></MemoryRouter>);
    expect(await screen.findByRole('group', { name: 'quiz 1 activity' })).toBeVisible();
    expect(screen.getByRole('group', { name: 'Pending lesson 1-20 activity' })).toBeVisible();
  });
});

describe('recorded historical course progress', () => {
  it('keeps quiz/material namespaces and placements in different courses', () => {
    const result = buildUnifiedLearningSummary(data, null);
    expect(result.subjects.map(s => s.activities.length)).toEqual([1, 2]);
    expect(result.completedActivityCount).toBe(3);
    expect(result.percent).toBe(100);
  });

  it('does not mix historical catalogue components into recorded progress or duplicate the current module', () => {
    const real = { modules: ['Current KSBs'], components: [
      { moduleId: 'CURRENT', componentId: 'C1', component: 'Current task', module: 'Current KSBs', type: 'reading' },
      { moduleId: 'HISTORY', componentId: 'C2', component: 'Catalogue-only task', module: 'Course 1', type: 'reading' },
    ], progress: [], quizAttempts: [] } as unknown as LearnerDetail;
    const result = subjectsFrom(data, real, { covers: {}, current_subjects: [
      { id: 'CURRENT', title: 'Current KSBs' }, { id: 'HISTORY', title: 'Course 1' },
    ] });
    expect(result.filter(s => s.title === 'Current KSBs')).toHaveLength(1);
    expect(result.find(s => s.id === 'legacy:1')?.activities).toHaveLength(1);
    expect(result.find(s => s.id === 'current:CURRENT')?.activities).toHaveLength(1);
    expect(result.some(s => s.id === 'current:HISTORY')).toBe(false);
  });

  it('shows the catalogue separately from the recorded denominator and accepted time', () => {
    render(<MemoryRouter><StudentActivityPanel data={data} loading={false} error={null} onRetry={vi.fn()} /></MemoryRouter>);
    expect(screen.getByText(/Recorded activities only.*Full catalogue: 265/)).toBeVisible();
    expect(screen.getByText(/Accepted time: 18m/)).toBeVisible();
    expect(screen.getByText('1 of 1 completed')).toBeVisible();
  });
});
