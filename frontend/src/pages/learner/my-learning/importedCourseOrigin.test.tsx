import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LearnerDetail } from '@/api/learnerDetail';
import type { StudentActivityResponse } from '@/api/studentActivity';
import type { LearningSchedule } from '@/api/learnerOverview';
import * as api from '@/api/studentActivity';
import { StudentActivityPanel } from './SubjectWorkspace';
import { buildUnifiedLearningSummary, type CoverMetadata } from './learningSummary';
import { resolveLearningSubject } from './subjectLearning';

vi.mock('@/api/learnerCertificates', () => ({
  fetchLearnerCertificateTemplate: vi.fn().mockResolvedValue({ template: null, csrfToken: '' }),
  issueLearnerModuleCertificate: vi.fn(),
}));

const title = 'Shared course title';
const history = {
  progress_basis: 'catalogue_activities', subjects: [{ id: 50, name: title, module_id: 'IMPORTED', accepted_hours: 4 }],
  activities: [1, 2, 3, 4].map(id => ({ activity_id: `catalogue:50:material:${id}`, group_id: 50,
    source_activity_id: id, activity: `Original lesson ${id}`, category: 'reading', catalogue_kind: 'material',
    completed: true, actual: 1, planned: 0, hours_mapped: true, planned_hours_mapped: false, date: null })),
} as StudentActivityResponse;
const real = {
  modules: [title], components: [
    { moduleId: 'IMPORTED', module: title, componentId: 'COPY-1', component: 'Imported copy 1', type: 'reading' },
    { moduleId: 'IMPORTED', module: title, componentId: 'COPY-2', component: 'Imported copy 2', type: 'reading' },
    { moduleId: 'NEW', module: title, componentId: 'NEW-1', component: 'Newly authored lesson', type: 'reading' },
  ], componentProgress: [], quizAttempts: [],
} as unknown as LearnerDetail;
const metadata: CoverMetadata = {
  covers: {}, current_subjects: [{ id: 'IMPORTED', title }, { id: 'NEW', title }],
  imported_courses: { 'current:IMPORTED': 'legacy:50' },
};

afterEach(() => vi.restoreAllMocks());

describe('original imported course identity', () => {
  it('keeps the original catalogue and progress once, alongside a same-named newly authored module', () => {
    const before = JSON.stringify({ history, real, metadata });
    const summary = buildUnifiedLearningSummary(history, real, metadata);
    expect(summary.subjects.map(subject => subject.id)).toEqual(['current:NEW', 'legacy:50']);
    expect(summary).toMatchObject({ subjectCount: 2, activityCount: 1, completedActivityCount: 0,
      previousLearning: { activityCount: 4, completedActivityCount: 4, percent: 100 } });
    expect(summary.subjects.find(subject => subject.source === 'legacy')).toMatchObject({ acceptedHours: 4 });
    expect(summary.subjects.find(subject => subject.source === 'legacy')?.activities.map(item => item.legacy))
      .toEqual(history.activities);
    expect(JSON.stringify({ history, real, metadata })).toBe(before);
  });

  it('does not infer an import from matching names or a legacy curriculum link', () => {
    const summary = buildUnifiedLearningSummary(history, real, { ...metadata, imported_courses: {} });
    expect(summary.subjects.map(subject => subject.id)).toEqual(['current:IMPORTED', 'current:NEW', 'legacy:50']);
  });

  it('keeps an assigned imported module when its exact original course is unavailable', () => {
    const summary = buildUnifiedLearningSummary(history, real, {
      ...metadata, imported_courses: { 'current:IMPORTED': 'legacy:OTHER' },
    });
    expect(summary.subjects.find(subject => subject.id === 'current:IMPORTED')).toMatchObject({
      source: 'current', importedCourseRef: 'legacy:OTHER', activities: expect.any(Array),
    });
    expect(summary.subjects.find(subject => subject.id === 'current:IMPORTED')?.activities).toHaveLength(2);
    expect(summary.subjects.find(subject => subject.id === 'legacy:50')?.activities).toHaveLength(4);
  });

  it('does not recreate a renamed import through title-only or retained-quiz fallbacks', () => {
    const renamed = { ...real, modules: ['Renamed import', title], components: real.components.map(item =>
      item.moduleId === 'IMPORTED' ? { ...item, module: 'Renamed import' } : item),
      retiredQuizComponents: [{ moduleId: 'IMPORTED', module: 'Renamed import', componentId: 'RETIRED',
        component: 'Retained quiz', isQuiz: true, quizMeta: { quizId: 99 } }],
      quizAttempts: [{ quizId: 99, grade: 1, passed: true }],
    } as LearnerDetail;
    const summary = buildUnifiedLearningSummary(history, renamed, {
      ...metadata, current_subjects: [{ id: 'IMPORTED', title: 'Renamed import' }, { id: 'NEW', title }],
    });
    expect(summary.subjects.map(subject => subject.id)).toEqual(['current:NEW', 'legacy:50']);
    expect(summary.previousLearning?.completedActivityCount).toBe(4);
  });

  it('resolves saved Builder links by original course id even when names differ', () => {
    const summary = buildUnifiedLearningSummary(history, real, metadata);
    const renamedMetadata = { ...metadata, current_subjects: [{ id: 'IMPORTED', title: 'Renamed import' }] };
    expect(resolveLearningSubject(summary.subjects, 'current:IMPORTED', renamedMetadata)?.id).toBe('legacy:50');
    expect(resolveLearningSubject(summary.subjects, 'IMPORTED', renamedMetadata)?.id).toBe('legacy:50');
    expect(resolveLearningSubject(summary.subjects, 'current:NEW', metadata)?.id).toBe('current:NEW');
  });

  it.each(['commercial', 'apprenticeship'])('shows the old record once with preserved hours and source filters for %s', async kind => {
    vi.spyOn(api, 'subjectRequest').mockResolvedValue(metadata);
    const schedule = { modules: [{ id: 'IMPORTED', title, total_otjh: 2 }], moduleLinks: {}, generatedAt: '' } as LearningSchedule;
    render(<MemoryRouter><StudentActivityPanel data={history} real={real} kind={kind} learnerId="12"
      schedule={schedule} moduleProgress={{ IMPORTED: { hours: { actual: 0.5 }, ksb: { completed: 0, total: 0 }, attendance: { attended: 0, total: 0 } } }}
      loading={false} error={null} onRetry={vi.fn()} /></MemoryRouter>);
    const oldCard = within(await screen.findByRole('button', { name: /Old LMS.*Open subject/ }));
    expect(oldCard.getByText('4 of 4 completed')).toBeVisible();
    expect(oldCard.getByText('Completed 4h')).toBeVisible();
    expect(oldCard.getByText('Planned Unavailable')).toBeVisible();
    expect(screen.getAllByRole('button', { name: /Open subject/ })).toHaveLength(2);
    expect(within(screen.getByRole('button', { name: /New LMS.*Open subject/ })).getByText('0 of 1 completed')).toBeVisible();
    fireEvent.click(screen.getByRole('tab', { name: 'New LMS' }));
    expect(screen.getAllByRole('button', { name: /Open subject/ })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: /Old LMS.*Open subject/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Old LMS' }));
    expect(screen.getAllByRole('button', { name: /Open subject/ })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: /Old LMS.*Open subject/ }));
    expect(screen.getByRole('group', { name: 'Original lesson 4 activity' })).toHaveTextContent('Complete');
    expect(screen.queryByText('Imported copy 1')).not.toBeInTheDocument();
  });

  it('labels an assigned import without an old record as Old LMS and retains its current activities', async () => {
    vi.spyOn(api, 'subjectRequest').mockResolvedValue(metadata);
    render(<MemoryRouter><StudentActivityPanel data={null} real={real} kind="commercial" learnerId="12"
      loading={false} error={null} onRetry={vi.fn()} /></MemoryRouter>);
    expect(await screen.findByText('Old LMS · Current learning plan')).toBeVisible();
    fireEvent.click(screen.getByRole('tab', { name: 'Old LMS' }));
    const card = within(screen.getByRole('button', { name: /Old LMS.*Open subject/ }));
    expect(card.getByText('0 of 2 completed')).toBeVisible();
    expect(screen.queryByRole('button', { name: /New LMS.*Open subject/ })).not.toBeInTheDocument();
  });

  it('uses one current catalogue and retains the original record for a verified replacement', () => {
    const linked = { ...metadata, imported_courses: {}, replacement_courses: { 'current:IMPORTED': 'legacy:50' } };
    const current = { ...real, componentProgress: [{ componentId: 'COPY-1', kind: 'component' }] } as LearnerDetail;
    const before = JSON.stringify({ history, current });
    const summary = buildUnifiedLearningSummary(history, current, linked);
    expect(summary.subjectCount).toBe(2);
    expect(summary.subjects).toHaveLength(2);
    expect(summary.subjects.find(subject => subject.id === 'current:IMPORTED')).toMatchObject({ replacementCourseRef: 'legacy:50' });
    expect(summary.subjects.find(subject => subject.id === 'current:IMPORTED')?.activities.filter(item => item.completed)).toHaveLength(1);
    expect(summary.previousLearning).toMatchObject({ activityCount: 0, completedActivityCount: 0 });
    expect(summary.subjects.find(subject => subject.id === 'current:IMPORTED')?.archivedActivities?.map(item => item.legacy)).toEqual(history.activities);
    expect(resolveLearningSubject(summary.subjects, 'current:IMPORTED', linked)?.id).toBe('current:IMPORTED');
    expect(resolveLearningSubject(summary.subjects, 'legacy:50', linked)?.id).toBe('current:IMPORTED');
    expect(JSON.stringify({ history, current })).toBe(before);
  });

  it('does not group a verified replacement with a different historical course', () => {
    const summary = buildUnifiedLearningSummary(history, real, {
      ...metadata, imported_courses: {}, replacement_courses: { 'current:IMPORTED': 'legacy:OTHER' },
    });
    expect(summary.subjectCount).toBe(3);
    expect(summary.subjects.find(subject => subject.id === 'current:IMPORTED')?.replacementCourseRef).toBeUndefined();
  });

  it('opens a saved original activity link in the unified course as read-only history', async () => {
    const request = vi.spyOn(api, 'subjectRequest').mockImplementation(async <T,>(url: string) => {
      if (url.includes('subject-covers')) return { ...metadata, imported_courses: {},
        replacement_courses: { 'current:IMPORTED': 'legacy:50' } } as T;
      return { title: 'Original reading', reading_html: '<p>Saved original content</p>', media: [], quiz: null,
        has_reading: true, available: true, persistence_ready: true, can_attempt: true, history: [],
        historical: { completed: true, answers: [], score: null, maximum_score: null } } as T;
    });
    render(<MemoryRouter initialEntries={['/?subject=legacy%3A50&activity=catalogue%3A50%3Amaterial%3A1']}>
      <StudentActivityPanel data={history} real={real} kind="commercial" learnerId="12" loading={false} error={null} onRetry={vi.fn()} />
    </MemoryRouter>);
    expect(await screen.findByText('Saved original content')).toBeVisible();
    expect(screen.getByRole('group', { name: 'Original lesson 1 activity' })).toHaveTextContent('Complete');
    expect(screen.queryByRole('button', { name: /Mark.*complete|Start quiz|Try quiz again/ })).not.toBeInTheDocument();
    expect(request.mock.calls.every(([, options]) => options?.method !== 'POST')).toBe(true);
  });

  it.each(['commercial', 'apprenticeship'])('shows one updated card with an accessible historical record for %s', async kind => {
    vi.spyOn(api, 'subjectRequest').mockResolvedValue({
      ...metadata, imported_courses: {}, replacement_courses: { 'current:IMPORTED': 'legacy:50' },
    });
    const current = { ...real, componentProgress: [{ componentId: 'COPY-1', kind: 'component' }] } as LearnerDetail;
    render(<MemoryRouter><StudentActivityPanel data={history} real={current} kind={kind} learnerId="12"
      loading={false} error={null} onRetry={vi.fn()} /></MemoryRouter>);
    const oldCard = within(await screen.findByRole('button', { name: /Old LMS.*Open subject/ }));
    expect(oldCard.getByText('1 of 2 completed')).toBeVisible();
    expect(oldCard.queryByText('Completed 4h')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Open subject/ })).toHaveLength(2);
    expect(screen.queryByText('Updated learning plan')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'New LMS' }));
    expect(screen.getAllByRole('button', { name: /Open subject/ })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Open updated plan' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Old LMS' }));
    expect(screen.getAllByRole('button', { name: /Open subject/ })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Open updated plan' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Old LMS.*Open subject/ }));
    expect(screen.getByRole('group', { name: 'Imported copy 1 activity' })).toHaveTextContent('Complete');
    expect(screen.getByRole('group', { name: 'Imported copy 2 activity' })).toHaveTextContent('Not complete');
    fireEvent.click(screen.getByText('Previous learning record'));
    expect(screen.getByRole('group', { name: 'Original lesson 4 activity' })).toHaveTextContent('Complete');
  });
});
