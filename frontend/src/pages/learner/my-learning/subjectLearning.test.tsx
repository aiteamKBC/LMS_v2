import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LearnerDetail } from '@/api/learnerDetail';
import type { PlanModule, TrainingPlanDashboard } from '@/api/trainingPlanDashboard';
import type { StudentActivityResponse, SubjectMaterial } from '@/api/studentActivity';
import * as api from '@/api/studentActivity';
import { StudentActivityPanel, subjectsFrom, type Subject, type SubjectEntry } from './SubjectWorkspace';
import { certificateEligible, currentLearningSubject, currentLearningWeek, continuingLearningWeek, learningDeadlines, learningPlanSelection, learningToday, learningHref, nextLearningWeek, recommendedLearningSubject, resolveLearningSubject, subjectMapWeeks, subjectWeeks, subjectOpeningActivity } from './subjectLearning';

const entry = (id: string, date: string, completed = false): SubjectEntry => ({ id, title: `Activity ${id}`, category: 'reading', completed, position: 0,
  schedule: { date, month: date?.slice(0, 7) || 'undated', week_start: date, week_end: date } });
const module = (id: string, start: string | null, end: string | null, extra = {}) => ({ id, title: id, start_date: start, end_date: end,
  programme_name: 'Leadership', cohort_name: 'Autumn', group_name: 'G1', ...extra }) as PlanModule;
const metadata = { covers: {}, current_subjects: [{ id: 'M1', title: 'Leadership' }], builder_subjects: { 'legacy:1': { id: 'M1', title: 'Leadership' } } };
const data = { learner_name: 'Test learner', activities: [
  { activity_id: 'la:1:1', source_activity_id: 1, group_id: 1, group_name: 'Leadership', activity: 'First reading', category: 'reading', position: 0,
    completed: false, date: '2026-09-07', month: '2026-09', week_start: '2026-09-07', week_end: '2026-09-13', planned: 2, planned_hours_mapped: true },
  { activity_id: 'la:1:2', source_activity_id: 2, group_id: 1, group_name: 'Leadership', activity: 'Second reading', category: 'reading', position: 1,
    completed: false, date: '2026-09-14', month: '2026-09', week_start: '2026-09-14', week_end: '2026-09-20', planned: 1, planned_hours_mapped: true },
] } as StudentActivityResponse;
const material = { title: 'First reading', reading_html: '', media: [{ kind: 'embed', url: 'https://example.org/first-reading', title: 'Reading frame' }],
  quiz: null, available: true, has_reading: false, source_live: true, persistence_ready: true, can_attempt: false, history: [],
  historical: { answers: [], score: null, maximum_score: null }, csrf_token: '' } as SubjectMaterial;

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('shared subject and week selection', () => {
  it('shows the tutor, module dates and session count from the training plan in list view', () => {
    const schedule = {
      modules: [module('M1', '2026-09-01', '2026-12-18', { title: 'Leadership programme module', tutor_name: 'Tutor 2', sessions_number: 8 })],
      moduleLinks: { 'legacy:1': { id: 'M1', title: 'Leadership' } },
    } as unknown as TrainingPlanDashboard;
    render(<MemoryRouter><StudentActivityPanel data={data} loading={false} error={null} onRetry={vi.fn()} schedule={schedule} /></MemoryRouter>);

    const layoutGroup = screen.getByRole('group', { name: 'Subject layout' });
    expect(within(layoutGroup).getAllByRole('button').map(button => button.textContent)).toEqual(['List', 'Grid']);
    expect(screen.getByRole('button', { name: 'List' })).toHaveAttribute('aria-pressed', 'true');
    const details = screen.getByText('Tutor 2').closest('dl')!;
    expect(within(details).getByText('Tutor')).toBeVisible();
    expect(within(details).getByText('Tutor 2')).toBeVisible();
    expect(within(details).queryByText('Module')).not.toBeInTheDocument();
    expect(within(details).getByText('1 Sept 2026')).toBeVisible();
    expect(within(details).getByText('18 Dec 2026')).toBeVisible();
    expect(within(details).getByText('8 sessions')).toBeVisible();
  });

  it('orders list and grid cards by module start date with undated modules last', () => {
    const laterActivity = { ...data.activities[0], activity_id: 'la:1:1', group_id: 1, group_name: 'Later module' };
    const earlierActivity = { ...data.activities[0], activity_id: 'la:2:1', group_id: 2, group_name: 'Earlier module' };
    const undatedActivity = { ...data.activities[0], activity_id: 'la:3:1', group_id: 3, group_name: 'Undated module' };
    const schedule = {
      modules: [
        module('M1', '2026-10-01', '2026-10-31'),
        module('M2', '2026-09-01', '2026-09-30'),
        module('M3', null, null),
      ],
      moduleLinks: {
        'legacy:1': { id: 'M1', title: 'Later module' },
        'legacy:2': { id: 'M2', title: 'Earlier module' },
        'legacy:3': { id: 'M3', title: 'Undated module' },
      },
    } as unknown as TrainingPlanDashboard;
    render(<MemoryRouter><StudentActivityPanel data={{ ...data, activities: [laterActivity, undatedActivity, earlierActivity] }} loading={false} error={null} onRetry={vi.fn()} schedule={schedule} /></MemoryRouter>);

    const cardTitles = () => screen.getAllByRole('heading', { level: 3 }).map(heading => heading.textContent);
    expect(screen.getByRole('combobox', { name: 'Sort by' })).toHaveValue('start');
    expect(cardTitles()).toEqual(['Earlier module', 'Later module', 'Undated module']);

    fireEvent.click(screen.getByRole('button', { name: 'Grid' }));
    expect(cardTitles()).toEqual(['Earlier module', 'Later module', 'Undated module']);
  });

  it('recommends current, then next dated, then any incomplete subject', () => {
    const current: Subject = { id: 'current:M1', title: 'Current', source: 'current', activities: [entry('current', '2026-09-10', true)] };
    const next: Subject = { id: 'current:M2', title: 'Next', source: 'current', activities: [entry('next', '2026-10-10')] };
    const fallback: Subject = { id: 'legacy:3', title: 'Fallback', source: 'legacy', activities: [entry('fallback', '')] };
    const schedule = { modules: [module('M1', '2026-09-01', '2026-09-30'), module('M2', '2026-10-01', '2026-10-31')], moduleLinks: {} } as unknown as TrainingPlanDashboard;
    expect(recommendedLearningSubject([fallback, current, next], null, undefined, schedule, '2026-09-16')).toBe(next);
    expect(recommendedLearningSubject([fallback, current], null, undefined, { ...schedule, modules: [schedule.modules[0]] }, '2026-09-16')).toBe(fallback);
  });

  it('creates deadlines only for unfinished end-of-week assignments and checkpoints', () => {
    const due = { ...entry('due', '2050-10-04'), category: 'assignment', schedule: { date: '2050-10-04', month: '2050-10', week_start: '2050-10-04', week_end: '2050-10-10', due_timing: 'end of week' } };
    const ordinary = { ...entry('ordinary', '2050-10-04'), category: 'assignment' };
    const subject: Subject = { id: 'current:M1', title: 'Subject', source: 'current', activities: [due, ordinary] };
    expect(learningDeadlines([subject], '2050-01-01')).toEqual([{ id: 'due', title: 'Activity due', type: 'assignment', date: '2050-10-10', subjectId: 'current:M1' }]);
  });

  it('requires a passed final quiz when the certificate template says so', () => {
    const quiz = { ...entry('final', '2026-09-10', true), native: { componentId: 'FINAL', title: 'Final Test', isQuiz: true, quizAttempts: [{ passed: false }] } } as SubjectEntry;
    const subject: Subject = { id: 'current:M1', title: 'Current', source: 'current', activities: [quiz] };
    const template = { id: 1, version: 2, title: 'Certificate', minimumProgress: 100, requireFinalTest: true };
    expect(certificateEligible(subject, template)).toBe(false);
    quiz.native!.quizAttempts = [{ passed: true, grade: 1, quizId: 1, startedAt: '2026-09-10T09:00:00Z', submittedAt: '2026-09-10T09:10:00Z' }];
    expect(certificateEligible(subject, template)).toBe(true);
  });

  it('keeps a calendar week together across two months and preserves every activity', () => {
    const subject: Subject = { id: 'legacy:1', title: 'Subject', source: 'legacy', activities: [entry('1', '2026-08-31'),
      { ...entry('2', '2026-09-01'), schedule: { date: '2026-09-01', month: '2026-09', week_start: '2026-08-31', week_end: '2026-09-06' } }] };
    const weeks = subjectWeeks(subject);
    expect(weeks).toHaveLength(1);
    expect(weeks[0].activities.map(a => a.id)).toEqual(['1', '2']);
    expect(weeks[0].end).toBe('2026-09-06');
  });

  it('uses the current placement module even when a previous cohort has a module on the same dates', () => {
    const subjects = subjectsFrom(data, null, metadata);
    subjects.push({ id: 'current:OLD', title: 'Old', source: 'current', activities: [entry('3', '2026-09-07')] });
    const schedule = { modules: [module('OLD', '2026-09-01', '2026-10-01', { cohort_name: 'Last year' }), module('M1', '2026-09-01', '2026-10-01')], moduleLinks: metadata.builder_subjects } as unknown as TrainingPlanDashboard;
    expect(currentLearningSubject(subjects, { programme: 'Leadership', cohort: 'Autumn', group: 'G1' } as LearnerDetail, metadata, schedule, '2026-09-13')?.id).toBe('legacy:1');
  });

  it.each([
    ['2026-08-31', undefined, 'next'],
    ['2026-09-01', 'legacy:1', 'current'],
    ['2026-09-30', 'legacy:1', 'current'],
    ['2026-10-01', undefined, 'previous'],
  ])('classifies the actual training period on %s without calling next or previous modules current', (today, expected, status) => {
    const subjects = subjectsFrom(data, null, metadata);
    const schedule = { modules: [module('M1', '2026-09-01', '2026-09-30')], moduleLinks: metadata.builder_subjects } as unknown as TrainingPlanDashboard;
    expect(currentLearningSubject(subjects, null, metadata, schedule, today)?.id).toBe(expected);
    expect(learningPlanSelection(subjects, null, metadata, schedule, today)).toMatchObject({ status, entries: [{ subject: { id: 'legacy:1' } }] });
  });

  it('uses training-plan dates even when a future module has activities and progress today', () => {
    const subjects = subjectsFrom(data, null, metadata);
    subjects[0].activities[0].completed = true;
    const schedule = { modules: [module('M1', '2026-10-05', '2027-02-11')], moduleLinks: metadata.builder_subjects } as unknown as TrainingPlanDashboard;
    expect(currentLearningSubject(subjects, null, metadata, schedule, '2026-09-13')).toBeUndefined();
    expect(learningPlanSelection(subjects, null, metadata, schedule, '2026-09-13').status).toBe('next');
  });

  it('does not infer a current module from activity dates when the schedule is missing, empty or from another placement', () => {
    const subjects = subjectsFrom(data, null, metadata);
    const placement = { programme: 'Leadership', cohort: 'Autumn', group: 'G1' } as LearnerDetail;
    for (const schedule of [null, { modules: [] }, { modules: [module('M1', '2026-09-01', '2026-10-01', { group_name: 'Other group' })] }]) {
      expect(currentLearningSubject(subjects, placement, metadata, schedule as TrainingPlanDashboard, '2026-09-13')).toBeUndefined();
    }
  });

  it.each([[null, null], [null, '2026-10-01'], ['2026-02-30', '2026-10-01']])('does not make missing or invalid plan dates current (%s, %s)', (start, end) => {
    const subjects = subjectsFrom(data, null, metadata);
    const schedule = { modules: [module('M1', start, end)], moduleLinks: metadata.builder_subjects } as unknown as TrainingPlanDashboard;
    expect(currentLearningSubject(subjects, null, metadata, schedule, '2026-09-13')).toBeUndefined();
    expect(learningPlanSelection(subjects, null, metadata, schedule, '2026-09-13').status).toBe('undated');
  });

  it('retains all overlapping current modules and keeps a completed one current until its teaching period ends', () => {
    const subjects = subjectsFrom(data, null, metadata);
    subjects[0].activities.forEach(activity => { activity.completed = true; });
    subjects.push({ id: 'current:M2', title: 'Another module', source: 'current', activities: [] });
    const schedule = { modules: [module('M1', '2026-09-01', '2026-09-30'), module('M2', '2026-09-07', '2026-10-01')], moduleLinks: metadata.builder_subjects } as unknown as TrainingPlanDashboard;
    const selection = learningPlanSelection(subjects, null, metadata, schedule, '2026-09-13');
    expect(selection.status).toBe('current');
    expect(selection.entries.map(entry => entry.subject.id)).toEqual(['legacy:1', 'current:M2']);
  });

  it('does not substitute unrelated unfinished materials when the current planned module cannot be resolved', () => {
    const subjects = subjectsFrom(data, null, metadata);
    const schedule = { modules: [module('UNAVAILABLE', '2026-09-01', '2026-10-01')], moduleLinks: {} } as unknown as TrainingPlanDashboard;
    expect(currentLearningSubject(subjects, null, metadata, schedule, '2026-09-13')).toBeUndefined();
  });

  it('changes the current module at UK midnight, including British Summer Time', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const subjects = subjectsFrom(data, null, metadata);
    const schedule = { modules: [module('M1', '2026-09-14', '2026-09-30')], moduleLinks: metadata.builder_subjects } as unknown as TrainingPlanDashboard;
    vi.setSystemTime(new Date('2026-09-13T22:59:59Z'));
    expect(learningToday()).toBe('2026-09-13');
    expect(currentLearningSubject(subjects, null, metadata, schedule)).toBeUndefined();
    vi.setSystemTime(new Date('2026-09-13T23:00:00Z'));
    expect(learningToday()).toBe('2026-09-14');
    expect(currentLearningSubject(subjects, null, metadata, schedule)?.id).toBe('legacy:1');
  });

  it('resolves current module links to the merged imported subject', () => {
    const subjects = subjectsFrom(data, null, metadata);
    expect(resolveLearningSubject(subjects, 'current:M1', metadata)?.id).toBe('legacy:1');
    expect(resolveLearningSubject(subjects, 'missing', metadata)).toBeUndefined();
  });

  it('does not choose an ambiguous imported module by title', () => {
    const subjects = [1, 2].map(id => ({ id: `legacy:${id}`, title: 'Repeated', source: 'legacy', activities: [] }) as Subject);
    expect(resolveLearningSubject(subjects, 'current:M1', { covers: {}, current_subjects: [{ id: 'M1', title: 'Repeated' }] })).toBeUndefined();
  });

  it('continues with an unfinished activity in the current week and skips complete weeks', () => {
    const subject = subjectsFrom(data, null)[0];
    expect(nextLearningWeek(subject, '2026-09-15')?.id).toBe('2026-09-14');
    subject.activities[1].completed = true;
    expect(nextLearningWeek(subject, '2026-09-15')?.id).toBe('2026-09-07');
    expect(continuingLearningWeek(subject, '2026-09-15')?.id).toBe('2026-09-14');
  });

  it('derives the current Monday–Sunday range from activity dates when no week range is supplied', () => {
    const subject: Subject = { id: 'current:M1', title: 'Module', source: 'current', activities: [
      { ...entry('old', '2026-08-24'), schedule: { date: '2026-08-24' } },
      { ...entry('a', '2026-08-31'), schedule: { date: '2026-08-31' } },
      { ...entry('b', '2026-09-03'), schedule: { date: '2026-09-03' } },
    ] };
    for (const today of ['2026-08-31', '2026-09-01', '2026-09-06']) {
      expect(currentLearningWeek(subject, today)).toMatchObject({ start: '2026-08-31', end: '2026-09-06', label: 'Week 2' });
      expect(currentLearningWeek(subject, today)?.activities.map(a => a.id)).toEqual(['a', 'b']);
    }
    expect(currentLearningWeek(subject, '2026-09-07')).toBeUndefined();
    expect(continuingLearningWeek(subject, '2026-09-07')?.id).toBe('2026-08-24');
  });

  it('does not call invalid, upload-only or unverified dates the current teaching week', () => {
    for (const schedule of [
      { date: '2026-02-30' }, { date: null },
      { date: '2026-09-13', date_source: 'original_created_at' },
      { date: '2026-09-13', date_needs_review: true },
    ]) {
      const subject: Subject = { id: 'current:M1', title: 'Module', source: 'current', activities: [{ ...entry('1', null), schedule }] };
      expect(currentLearningWeek(subject, '2026-09-13')).toBeUndefined();
    }
  });

  it('switches the current week at UK midnight even when the learner has finished that week', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const subject = subjectsFrom(data, null)[0];
    subject.activities.forEach(activity => { activity.completed = true; });
    vi.setSystemTime(new Date('2026-09-13T22:59:59Z'));
    expect(continuingLearningWeek(subject)?.id).toBe('2026-09-07');
    vi.setSystemTime(new Date('2026-09-13T23:00:00Z'));
    expect(continuingLearningWeek(subject)?.id).toBe('2026-09-14');
  });

  it('keeps introductions and extras separate from scheduled weeks', () => {
    const subject = subjectsFrom(data, null)[0];
    subject.activities.push({ ...entry('intro', null), schedule: { date: null, month: 'undated', date_source: 'introduction' } },
      { ...entry('extra', '2026-09-07'), schedule: { date: '2026-09-07', month: '2026-09', date_source: 'extra_activity' } });
    const weeks = subjectWeeks(subject);
    expect(weeks.map(w => w.label)).toEqual(['Introduction', 'Week 1', 'Week 2', 'Extra activities']);
    expect(weeks.flatMap(w => w.activities)).toHaveLength(4);
  });

  it('opens the current week before unfinished earlier weeks and skips unpublished content', () => {
    const reading = (id: string, date: string, completed = false): SubjectEntry => ({ ...entry(id, date, completed),
      native: { title: id, componentId: id, type: 'reading', expectedOtjh: null, contentHtml: '<p>Lesson</p>' } });
    const subject: Subject = { id: 'current:M1', title: 'Module', source: 'current', activities: [
      reading('earlier', '2026-09-07'), reading('complete', '2026-09-13', true),
      { ...reading('locked', '2026-09-13'), native: { title: 'Locked', componentId: 'locked', type: 'reading', expectedOtjh: null } },
      reading('current', '2026-09-13'), reading('future', '2026-09-21'),
    ] };
    expect(subjectOpeningActivity(subject, undefined, '2026-09-13')?.id).toBe('current');
    subject.activities[3].completed = true;
    expect(subjectOpeningActivity(subject, undefined, '2026-09-13')?.id).toBe('complete');
    expect(subjectOpeningActivity(subject, subjectWeeks(subject)[2], '2026-09-13')?.id).toBe('future');
  });

  it('preserves learner identity and encodes the same subject and week for both entry points', () => {
    for (const view of ['catalogue', 'map'] as const) {
      const url = new URL(learningHref(view, 'commercial', '132', 'legacy:1', 'extra:Planning & review'), 'http://localhost');
      expect(url.pathname).toContain('/commercial/132');
      expect(url.searchParams.get('subject')).toBe('legacy:1');
      expect(url.searchParams.get('week')).toBe('extra:Planning & review');
    }
  });

  it('includes assigned weeks with no published materials without inventing dates or activities', () => {
    const subject = subjectsFrom(data, null, metadata)[0];
    const real = { week: [{ moduleId: 'M1', module: 'Leadership', weekId: 'W3', week: 'Week 3' },
      { moduleId: 'OTHER', module: 'Other', weekId: 'W4', week: 'Week 4' }] } as LearnerDetail;
    const weeks = subjectMapWeeks(subject, real, metadata);
    expect(weeks).toHaveLength(3);
    expect(weeks[2]).toMatchObject({ id: 'W3', title: 'Week 3', start: null, activities: [] });
    expect(weeks.flatMap(w => w.activities)).toHaveLength(2);
  });
});

function Navigation() {
  const location = useLocation();
  const navigate = useNavigate();
  return <><output data-testid="location">{location.pathname}{location.search}</output><button onClick={() => navigate(-1)}>Browser Back</button></>;
}

function renderWorkspace(path: string, view: 'map' | 'catalogue' = 'map') {
  vi.spyOn(api, 'subjectRequest').mockImplementation(async <T,>(url: string) => (url.includes('subject-covers') ? metadata : material) as T);
  return render(<MemoryRouter initialEntries={[path]}><StudentActivityPanel view={view} kind="commercial" learnerId="132" data={data} loading={false} error={null} onRetry={() => {}} /><Navigation /></MemoryRouter>);
}

describe('map and My Learning navigation', () => {
  it.each(['legacy%3A1', 'current%3AM1', ''])('resolves a current-week Continue link from activity dates (%s)', async subject => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-15T12:00:00Z'));
    vi.spyOn(api, 'subjectRequest').mockResolvedValue(metadata);
    const completedCurrentWeek = { ...data, activities: data.activities.map((activity, index) => ({ ...activity, completed: index === 1 })) };
    render(<MemoryRouter initialEntries={[`/learner/my-learning/commercial/132?${subject ? `subject=${subject}&` : ''}week=current`]}>
      <StudentActivityPanel data={completedCurrentWeek} kind="commercial" learnerId="132" loading={false} error={null} onRetry={() => {}} />
    </MemoryRouter>);
    expect(await screen.findByRole('region', { name: 'Week 2 materials' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Second reading' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'First reading' })).not.toBeInTheDocument();
  });

  it('moves Continue learning from a completed current module to an unfinished subject', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-15T12:00:00Z'));
    vi.spyOn(api, 'subjectRequest').mockResolvedValue(metadata);
    const completedModule = { ...data, activities: [
      ...data.activities.map(activity => ({ ...activity, completed: true })),
      { ...data.activities[0], activity_id: 'la:2:1', group_id: 2, group_name: 'Another subject' },
    ] };
    const schedule = { modules: [module('M1', '2026-09-01', '2026-09-30')], moduleLinks: metadata.builder_subjects } as unknown as TrainingPlanDashboard;
    render(<MemoryRouter><StudentActivityPanel data={completedModule} schedule={schedule} kind="commercial" learnerId="132" loading={false} error={null} onRetry={() => {}} /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'Continue learning' }));
    expect(screen.getByRole('heading', { name: 'Another subject' })).toBeVisible();
  });

  it('hides the whole Continue learning panel when every activity is complete', async () => {
    vi.spyOn(api, 'subjectRequest').mockResolvedValue(metadata);
    const completed = { ...data, activities: data.activities.map(activity => ({ ...activity, completed: true })) };
    render(<MemoryRouter><StudentActivityPanel view="catalogue" data={completed} kind="commercial" learnerId="132" loading={false} error={null} onRetry={() => {}} /></MemoryRouter>);
    await screen.findByRole('button', { name: /Open subject/ });
    expect(screen.queryByRole('heading', { name: 'Continue learning' })).not.toBeInTheDocument();
  });

  it.each(['current', '2026-09-07'])('opens a completed current-week native player from a Continue link (%s)', async week => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-13T12:00:00Z'));
    vi.spyOn(api, 'subjectRequest').mockResolvedValue({ covers: {}, activity_dates: {
      OLD: { date: '2026-09-01', date_source: 'builder_week' },
      CURRENT: { date: '2026-09-09', date_source: 'builder_week' },
    } });
    const real = { modules: ['Leadership'], components: [
      { componentId: 'OLD', moduleId: 'M1', module: 'Leadership', week: 'Week 1', component: 'Earlier lesson', type: 'reading', contentHtml: '<p>Earlier lesson</p>' },
      { componentId: 'CURRENT', moduleId: 'M1', module: 'Leadership', week: 'Week 2', component: 'Current lesson', type: 'reading', contentHtml: '<p>Current lesson</p>' },
    ], componentProgress: [{ componentId: 'CURRENT', kind: 'component' }] } as LearnerDetail;
    render(<MemoryRouter initialEntries={[`/learner/my-learning/commercial/132?subject=current%3AM1&week=${week}`]}><Routes>
      <Route path="/learner/my-learning/commercial/132" element={<StudentActivityPanel data={null} real={real} kind="commercial" learnerId="132" loading={false} error={null} onRetry={() => {}} />} />
      <Route path="/learner/component/commercial/132/:activityId" element={<p>Activity player</p>} />
    </Routes><Navigation /></MemoryRouter>);
    expect(await screen.findByText('Activity player')).toBeVisible();
    expect(screen.getByTestId('location')).toHaveTextContent('/learner/component/commercial/132/CURRENT?week=Week%202');
  });

  it.each([
    ['reading', { contentHtml: '<p>Current lesson</p>' }, '/learner/component/commercial/132/CURRENT'],
    ['video', { videoUrl: 'https://example.org/lesson.mp4' }, '/learner/video/commercial/132/CURRENT'],
    ['quiz', { isQuiz: true, quizMeta: { quizId: 25, questions: 2, duration: null, timeUnit: null } }, '/learner/quiz/commercial/132/25'],
  ])('opens the current %s player from the catalogue and Back returns to the catalogue', async (type, content, path) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-13T12:00:00Z'));
    vi.spyOn(api, 'subjectRequest').mockResolvedValue({ covers: {}, activity_dates: {
      OLD: { date: '2026-09-01', week_start: '2026-08-31', week_end: '2026-09-06', date_source: 'builder_week' },
      CURRENT: { date: '2026-09-13', week_start: '2026-09-07', week_end: '2026-09-13', date_source: 'builder_week' },
    } });
    const real = { modules: ['Leadership'], components: [
      { componentId: 'OLD', moduleId: 'M1', module: 'Leadership', week: 'Week 1', component: 'Earlier lesson', type: 'reading', contentHtml: '<p>Earlier lesson</p>' },
      { componentId: 'CURRENT', moduleId: 'M1', module: 'Leadership', week: 'Week 2', component: 'Current lesson', type, ...content },
    ] } as LearnerDetail;
    render(<MemoryRouter initialEntries={['/learner/my-learning/commercial/132']}><Routes>
      <Route path="/learner/my-learning/commercial/132" element={<StudentActivityPanel data={null} real={real} kind="commercial" learnerId="132" loading={false} error={null} onRetry={() => {}} />} />
      <Route path="/learner/:type/commercial/132/:activityId" element={<p>Activity player</p>} />
    </Routes><Navigation /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: /Open subject/ }));
    expect(await screen.findByText('Activity player')).toBeVisible();
    expect(screen.getByTestId('location')).toHaveTextContent(`${path}?week=Week%202`);
    fireEvent.click(screen.getByRole('button', { name: 'Browser Back' }));
    expect(await screen.findByRole('button', { name: /Open subject/ })).toBeVisible();
    expect(screen.getByTestId('location')).not.toHaveTextContent('subject=');
  });

  it('opens the next planned module with its real dates and a Next module label before teaching starts', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-13T12:00:00Z'));
    vi.spyOn(api, 'subjectRequest').mockResolvedValue(metadata);
    const schedule = { modules: [module('M1', '2026-10-05', '2027-02-11')], moduleLinks: metadata.builder_subjects } as unknown as TrainingPlanDashboard;
    render(<MemoryRouter><StudentActivityPanel view="map" kind="commercial" learnerId="132" data={data} schedule={schedule} loading={false} error={null} onRetry={() => {}} /></MemoryRouter>);
    expect(await screen.findByRole('combobox', { name: 'Filter by module' })).toHaveValue('legacy:1');
    expect(screen.getByRole('option', { name: 'Leadership · Next module' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Current/ })).not.toBeInTheDocument();
    expect(screen.getByText('Next module', { exact: true })).toBeVisible();
    expect(screen.getByText(/5 Oct 2026 – 11 Feb 2027/)).toBeVisible();
  });

  it('keeps manual selection separate from the actual current training-plan module', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-13T12:00:00Z'));
    vi.spyOn(api, 'subjectRequest').mockResolvedValue({ ...metadata, current_subjects: [...metadata.current_subjects, { id: 'M2', title: 'Future subject' }] });
    const schedule = { modules: [module('M1', '2026-09-01', '2026-09-30'), module('M2', '2026-10-01', '2026-10-31')], moduleLinks: metadata.builder_subjects } as unknown as TrainingPlanDashboard;
    render(<MemoryRouter><StudentActivityPanel view="map" kind="commercial" learnerId="132" data={data} schedule={schedule} loading={false} error={null} onRetry={() => {}} /></MemoryRouter>);
    const select = await screen.findByRole('combobox', { name: 'Filter by module' });
    expect(select).toHaveValue('legacy:1');
    fireEvent.change(select, { target: { value: 'current:M2' } });
    expect(select).toHaveValue('current:M2');
    expect(screen.getByRole('option', { name: 'Leadership · Current module' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Future subject' })).toBeInTheDocument();
    expect(screen.getByText('Selected module', { exact: true })).toBeVisible();
  });

  it('opens a week, uses the existing iframe player, and returns through browser history', async () => {
    renderWorkspace('/learner/learning-plan/modules/commercial/132?subject=current%3AM1');
    fireEvent.click(await screen.findByRole('button', { name: 'Open Week 1: First reading' }));
    expect(screen.getByTestId('location')).toHaveTextContent('subject=legacy%3A1&week=2026-09-07');
    expect(screen.getByRole('region', { name: 'Week 1 materials' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Second reading' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'First reading' }));
    expect(await screen.findByTitle('Reading frame')).toHaveAttribute('src', 'https://example.org/first-reading');
    fireEvent.click(screen.getByRole('button', { name: 'Browser Back' }));
    expect(screen.getByRole('list', { name: 'Leadership weekly timeline' })).toBeVisible();
    expect(screen.queryByTitle('Reading frame')).not.toBeInTheDocument();
  });

  it('opens a saved week directly in My Learning and links the same subject back to the map', async () => {
    renderWorkspace('/learner/my-learning/commercial/132?subject=legacy%3A1&week=2026-09-14', 'catalogue');
    await screen.findByRole('region', { name: 'Week 2 materials' });
    expect(screen.getByRole('button', { name: 'Second reading' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Back to subject' }));
    expect(screen.getByRole('link', { name: 'View learning map' })).toHaveAttribute('href', '/learner/learning-plan/modules/commercial/132?subject=legacy%3A1');
    fireEvent.click(screen.getByRole('button', { name: 'All subjects' }));
    expect(screen.getByRole('button', { name: /Open subject/ })).toBeVisible();
  });

  it('switches module without keeping the previous week and restores it with browser Back', async () => {
    vi.spyOn(api, 'subjectRequest').mockResolvedValue({ ...metadata, current_subjects: [...metadata.current_subjects, { id: 'M2', title: 'New subject' }] });
    render(<MemoryRouter initialEntries={['/learner/learning-plan/modules/commercial/132?subject=legacy%3A1&week=2026-09-07']}><StudentActivityPanel view="map" data={data} kind="commercial" learnerId="132" loading={false} error={null} onRetry={() => {}} /><Navigation /></MemoryRouter>);
    await screen.findByRole('region', { name: 'Week 1 materials' });
    fireEvent.change(screen.getByRole('combobox', { name: 'Filter by module' }), { target: { value: 'current:M2' } });
    expect(screen.getByTestId('location')).not.toHaveTextContent('&week=');
    expect(screen.getByText('Weeks will appear when activities are added to this module.')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Browser Back' }));
    expect(screen.getByRole('region', { name: 'Week 1 materials' })).toBeVisible();
  });

  it('keeps headline totals unchanged by filters and switches grid/list accessibly', async () => {
    renderWorkspace('/learner/my-learning/commercial/132', 'catalogue');
    await screen.findByRole('button', { name: /Open subject/ });
    fireEvent.change(screen.getByRole('combobox', { name: 'Filter by progress' }), { target: { value: 'complete' } });
    expect(screen.queryByRole('button', { name: /Open subject/ })).not.toBeInTheDocument();
    expect(within(screen.getByText('Total activities').parentElement!).getByText('2')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getByRole('button', { name: 'List' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Grid' }));
    expect(screen.getByRole('button', { name: 'Grid' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'List' }));
    expect(screen.getByRole('button', { name: 'List' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /Open subject/ })).toBeVisible();
  });

  it('uses the authoritative activity total everywhere and opens deadlines as assignments', async () => {
    vi.spyOn(api, 'subjectRequest').mockResolvedValue({ ...metadata, activity_dates: {
      'ASSIGNMENT-1': { date: '2050-10-04', month: '2050-10', week_start: '2050-10-04', week_end: '2050-10-10', due_timing: 'end of week' },
    } });
    const real = { components: [{ moduleId: 'M1', module: 'Leadership', componentId: 'ASSIGNMENT-1', component: 'Due assignment', type: 'assignment' }] } as LearnerDetail;
    render(<MemoryRouter><StudentActivityPanel view="catalogue" kind="commercial" learnerId="132" data={data} real={real} loading={false} error={null} onRetry={() => {}}
      metrics={{ migrated: true,
        programme: { completed: 35, total: 304, percent: 11.51, status: 'ready' },
        ksb: { completed: 0, total: 0, percent: null, status: 'empty' },
        otjh: { historical: 0, new: 0, actual: 0, planned: 0 } }} />
    </MemoryRouter>);

    await screen.findByRole('button', { name: /Open subject/ });
    expect(screen.getByText('1 subjects · 304 activities')).toBeVisible();
    expect(screen.getByRole('link', { name: 'View all assignments' })).toHaveAttribute('href', '/learner/my-learning/commercial/132?tab=assignments');
    expect(screen.getByRole('link', { name: /Due assignment/ })).toHaveAttribute('href', '/learner/monthly-submission/commercial/132/ASSIGNMENT-1');
  });
});
