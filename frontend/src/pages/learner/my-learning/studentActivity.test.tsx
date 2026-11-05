import { act, fireEvent, render as renderReact, renderHook, screen, waitFor, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StudentActivityResponse, SubjectMaterial, SubjectAttemptResult } from '@/api/studentActivity';
import type { LearnerDetail } from '@/api/learnerDetail';
import type { LearningSchedule } from '@/api/learnerOverview';
import * as api from '@/api/studentActivity';
import * as reads from '@/api/learnerRead';
import { QuizzesTab, StudentActivityPanel } from './page';
import { StudentMaterial } from './StudentMaterial';
import { buildUnifiedLearningSummary, subjectsFrom } from './learningSummary';
import { useSubjectMetadata } from './useSubjectLearningData';
import { CompactModules } from './CompactModules';

// AppIcon is normally supplied by the app build's auto-import plugin.
vi.stubGlobal('AppIcon', () => <span />);
beforeEach(() => localStorage.clear());
const render = (element: ReactElement) => renderReact(element, { wrapper: MemoryRouter });

const data: StudentActivityResponse = {
  learner_name: 'Anna Rundell', count: 2, unique_activity_count: 2,
  module_count: 1, completed_count: 1, actual_total: 0, planned_total: null,
  mapped_count: 1, planned_mapped_count: 0,
  activities: [
    { activity_id: 'la:1:10', source_activity_id: 10, group_id: 1, group_name: 'Leadership',
      date: null, category: 'video', activity: 'Introduction', status: 'completed',
      completed: true, actual: 0, planned: 0, hours_mapped: true, planned_hours_mapped: false,
      quiz_score: null, quiz_maximum_score: null },
    { activity_id: 'la:1:11', source_activity_id: 11, group_id: 1, group_name: 'Leadership',
      date: null, category: 'reading', activity: 'Reflection', status: null,
      completed: false, actual: 0, planned: 0, hours_mapped: false, planned_hours_mapped: false,
      quiz_score: null, quiz_maximum_score: null },
  ],
};

function selectMonthWeek(month = 'February 2026') {
  const sidebar = within(screen.getByRole('complementary', { name: 'Module activities' }));
  const heading = sidebar.getByRole('heading', { name: month, level: 3 });
  // The desktop row now expands in place. These player-state cases use the
  // mobile selector to switch the displayed week directly.
  const label = within(heading.closest('li')!).getAllByRole('button')[0].getAttribute('aria-label')!.replace(/, \d+ components.*$/, '');
  const selector = screen.getByRole('combobox', { name: 'Select week' });
  const option = within(selector).getAllByRole('option').find(item => item.textContent === label)!;
  fireEvent.change(selector, { target: { value: (option as HTMLOptionElement).value } });
}
function weekProgress() {
  return screen.getByRole('progressbar', { name: 'Week progress' });
}

describe('learner subject cards', () => {
  afterEach(() => vi.restoreAllMocks());

  it('does not describe successfully verified canonical history as a failed refresh', () => {
    render(<StudentActivityPanel data={{ ...data, source_status: 'historical', verification_status: 'verified' }} loading={false} error={null} onRetry={vi.fn()} />);
    expect(screen.queryByText(/The latest results could not be verified/)).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Leadership' })).toBeVisible();
  });

  it('labels and filters old LMS courses separately from assigned new Curriculum modules', async () => {
    vi.spyOn(api, 'subjectRequest').mockResolvedValue({
      covers: {}, current_subjects: [{ id: 'MOD-NEW', title: 'New curriculum module' }],
    });
    render(<StudentActivityPanel data={data} real={{ components: [{
      moduleId: 'MOD-NEW', module: 'New curriculum module', componentId: 'NEW-1',
      component: 'New activity', type: 'reading', week: 'Week 1',
    }] } as LearnerDetail} kind="commercial" learnerId="132" loading={false} error={null} onRetry={vi.fn()} />);

    await screen.findByRole('heading', { name: 'New curriculum module' });
    expect(screen.getByRole('heading', { name: 'Leadership' })).toBeVisible();
    const oldLmsCard = within(screen.getByRole('button', { name: /Leadership.*Open subject/ }));
    expect(oldLmsCard.getByText('Old LMS · Previous learning')).toBeVisible();
    expect(oldLmsCard.getByText('Review only')).toBeVisible();
    const newLmsCard = within(screen.getByRole('button', { name: /New curriculum module.*Open subject/ }));
    expect(newLmsCard.getByText('New LMS · Current learning plan')).toBeVisible();
    expect(newLmsCard.queryByText('Study here & record progress')).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'All modules' })).toHaveAttribute('aria-selected', 'true');

    fireEvent.click(screen.getByRole('tab', { name: 'Old LMS' }));
    expect(screen.getByRole('heading', { name: 'Leadership' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'New curriculum module' })).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Old LMS' })).toHaveAttribute('aria-selected', 'true');

    fireEvent.click(screen.getByRole('tab', { name: 'New LMS' }));
    expect(screen.getByRole('heading', { name: 'New curriculum module' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Leadership' })).not.toBeInTheDocument();
    expect(screen.getByText(/1 shown/)).toBeVisible();

    fireEvent.click(screen.getByRole('tab', { name: 'All modules' }));
    expect(screen.getByRole('heading', { name: 'New curriculum module' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Leadership' })).toBeVisible();
  });

  it('uses the old LMS course accepted hours instead of the linked module total', async () => {
    vi.spyOn(api, 'subjectRequest').mockResolvedValue({ covers: {} });
    const schedule: LearningSchedule = {
      modules: [{ id: 'M1', title: 'Leadership', description: '', start_date: null, end_date: null,
        tutor_name: '', coach_name: '', total_otjh: 7.41 }],
      moduleLinks: {}, generatedAt: '2026-10-15T00:00:00Z',
    };
    render(<StudentActivityPanel data={{ ...data, subjects: [
      { id: 1, name: 'Leadership', module_id: 'M1', accepted_hours: 1 + 2 / 60 },
    ] }} schedule={schedule} moduleProgress={{
      M1: { attendance: { attended: 0, total: 0 }, hours: { actual: 22.8 }, ksb: { completed: 0, total: 0 } },
    }} loading={false} error={null} onRetry={vi.fn()} />);

    const card = within(await screen.findByRole('button', { name: /Leadership.*Open subject/ }));
    expect(card.getByText('Completed 1h 2m')).toBeVisible();
    expect(card.getByText('Planned 7h 24m 36s')).toBeVisible();
    expect(card.getByRole('progressbar', { name: 'Leadership hours progress' })).toHaveAttribute('aria-valuenow', '13.95');
  });

  it('keeps unstarted enrolled courses visible with an Upcoming badge', async () => {
    vi.spyOn(api, 'subjectRequest').mockResolvedValue({ covers: {},
      current_subjects: [{ id: 'FUTURE-1', title: 'Future enrolled course' }],
    });
    const unstarted = { ...data, completed_count: 0,
      activities: data.activities.map(activity => ({ ...activity, completed: false, status: null })) };
    render(<StudentActivityPanel data={unstarted} real={{ components: [] } as unknown as LearnerDetail}
      kind="commercial" learnerId="132" loading={false} error={null} onRetry={vi.fn()} />);
    const assigned = await screen.findByRole('button', { name: /Future enrolled course.*Open subject/ });
    expect(within(assigned).getByText('Upcoming')).toBeVisible();
    const imported = screen.getByRole('button', { name: /Leadership.*Open subject/ });
    expect(within(imported).getByText('Upcoming')).toBeVisible();
    expect(imported).toBeEnabled();
    expect(assigned).toBeEnabled();
  });

  it('shows scheduled learning and working help destinations in the catalogue sidebar', async () => {
    vi.spyOn(api, 'subjectRequest').mockResolvedValue({ covers: {} });
    render(<StudentActivityPanel data={data} real={{ components: [
      { moduleId: 'M1', module: 'Project', componentId: 'LIVE-1', component: 'Project workshop', type: 'live_session', week: 'Week 1', sessionDateTimeUtc: '2099-08-03T10:00:00Z' },
      { moduleId: 'M1', module: 'Project', componentId: 'LIVE-2', component: 'Second workshop', type: 'live_session', week: 'Week 1', sessionDate: '2099-08-04' },
      { moduleId: 'M1', module: 'Project', componentId: 'LIVE-3', component: 'Third workshop', type: 'live_session', week: 'Week 1', sessionDateTimeUtc: '2099-08-05T10:00:00Z' },
      { moduleId: 'M1', module: 'Project', componentId: 'LIVE-4', component: 'Fourth workshop', type: 'live_session', week: 'Week 1', sessionDateTimeUtc: '2099-08-06T10:00:00Z' },
    ] } as LearnerDetail} kind="commercial" learnerId="132" loading={false} error={null} onRetry={vi.fn()}
      upcomingSessions={[
        { id: 'future', moduleId: 'M1', title: 'Project workshop', start: '2099-08-03T10:00:00Z', end: '2099-08-03T11:00:00Z', minutes: 60, joinUrl: 'https://example.com/session', status: 'scheduled', attended: null },
        { id: 'second', moduleId: 'M1', title: 'Second workshop', start: '2099-08-04T10:00:00Z', end: null, minutes: 60, joinUrl: null, status: 'scheduled', attended: null },
        { id: 'third', moduleId: 'M1', title: 'Third workshop', start: '2099-08-05T10:00:00Z', end: null, minutes: 60, joinUrl: null, status: 'scheduled', attended: null },
        { id: 'fourth', moduleId: 'M1', title: 'Fourth workshop', start: '2099-08-06T10:00:00Z', end: null, minutes: 60, joinUrl: null, status: 'scheduled', attended: null },
        { id: 'cancelled', moduleId: 'M1', title: 'Cancelled workshop', start: '2099-01-04T10:00:00Z', end: null, minutes: 60, joinUrl: null, status: 'cancelled', attended: null },
      ]} />);
    const shortcuts = within(await screen.findByRole('complementary', { name: 'Learning shortcuts' }));
    expect(shortcuts.getByRole('link', { name: /Project workshop/ })).toHaveAttribute('href', '/learner/component/commercial/132/LIVE-1?week=Week%201');
    expect(shortcuts.getByRole('link', { name: /Second workshop/ })).toHaveAttribute('href', '/learner/component/commercial/132/LIVE-2?week=Week%201');
    expect(shortcuts.getByRole('link', { name: /Project workshop/ })).toHaveTextContent('11:00');
    expect(shortcuts.getByRole('link', { name: /Project workshop/ })).toHaveTextContent('Online');
    expect(shortcuts.queryByText('Cancelled workshop')).not.toBeInTheDocument();
    expect(shortcuts.queryByText('Fourth workshop')).not.toBeInTheDocument();
    fireEvent.click(shortcuts.getByRole('button', { name: 'View all' }));
    expect(shortcuts.getByRole('link', { name: /Fourth workshop/ })).toBeVisible();
    expect(shortcuts.getByRole('link', { name: /Fourth workshop/ })).toHaveAttribute('href', '/learner/component/commercial/132/LIVE-4?week=Week%201');
    expect(shortcuts.getByRole('link', { name: /Book a tutor meeting/ })).toHaveAttribute('href', '/learner/calendar?book=student-support');
    expect(shortcuts.getByRole('link', { name: /Contact student support/ })).toHaveAttribute('href', '/learner/support?action=new-ticket&category=learning');
    expect(shortcuts.queryByRole('link', { name: /Technical support/ })).not.toBeInTheDocument();
  });

  it.each(['legacy:1','current:MOD-1'])('opens the exact subject from a Continue learning deep link (%s)', async subjectId => {
    const imported=subjectId.startsWith('legacy:');
    vi.spyOn(api,'subjectRequest').mockResolvedValue({covers:{},current_subjects:[{id:'MOD-1',title:'Current module'}],
      builder_subjects:imported?{'legacy:1':{id:'MOD-1',title:'Current module'}}:{}});
    renderReact(<MemoryRouter initialEntries={[`/learner/modules/commercial/132?subject=${encodeURIComponent(subjectId)}`]}>
      <StudentActivityPanel data={imported?data:null} real={{modules:['Current module'],components:[{
        moduleId:'MOD-1',module:'Current module',componentId:'C1',component:'Current reading',type:'reading',week:'Week 1',
      }]} as LearnerDetail} kind="commercial" learnerId="132" loading={false} error={null} onRetry={vi.fn()} />
    </MemoryRouter>);
    const workspace=within(await screen.findByRole('region',{name:'Your subjects'}));
    expect((await workspace.findAllByRole('heading',{name:'Current module'}))[0]).toBeVisible();
    expect(workspace.getByRole('button',{name:'All subjects'})).toBeVisible();
    expect(workspace.queryByRole('button',{name:/Open subject/})).not.toBeInTheDocument();
  });

  it('reads the linked Builder title and image without offering uploads in the learner workspace', async () => {
    const image = 'data:image/png;base64,aGVsbG8=';
    vi.spyOn(api, 'subjectRequest').mockResolvedValue({
      covers: { 'legacy:1': image }, can_manage: true, persistence_ready: true,
      builder_subjects: { 'legacy:1': { id: 'MOD-1', title: 'Updated Leadership' } },
    });
    const { container } = render(<StudentActivityPanel data={data} learnerId="132" loading={false} error={null} onRetry={vi.fn()} />);
    expect(await screen.findByRole('img', { name: 'Updated Leadership cover' })).toHaveAttribute('src', image);
    expect(screen.getByText('1 of 2 completed')).toBeInTheDocument();
    expect(container.querySelector('input[type="file"]')).toBeNull();
    expect(screen.queryByText('Upload image')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Updated Leadership/ }));
    selectMonthWeek('Undated activities');
    expect(screen.getByRole('group', { name: 'Reflection activity' })).toBeVisible();
    expect(screen.getByRole('progressbar', { name: 'Subject progress' })).toHaveAttribute('aria-valuenow', '50');
    expect(container.querySelector('input[type="file"]')).toBeNull();
  });

  it('uses the module default when its Builder cover is removed', async () => {
    vi.spyOn(api, 'subjectRequest').mockResolvedValue({
      covers: { 'legacy:1': '' },
      builder_subjects: { 'legacy:1': { id: 'MOD-1', title: 'Updated Leadership' } },
    });
    render(<StudentActivityPanel data={{ ...data, covers: { 'legacy:1': 'https://example.com/old.png' } }} learnerId="132" loading={false} error={null} onRetry={vi.fn()} />);
    await screen.findByRole('heading', { name: 'Updated Leadership' });
    expect(screen.getByRole('img', { name: 'Updated Leadership cover' })).toHaveAttribute('src', '/assets/my-learning/default-module-cover.png');
  });


  it('opens a subject card and distinguishes missing OTJH from recorded zero', () => {
    render(<StudentActivityPanel data={data} loading={false} error={null} onRetry={vi.fn()} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('Anna Rundell')).toBeInTheDocument();
    expect(within(screen.getByText('Planned OTJH').parentElement!).getByText('Unavailable')).toBeInTheDocument();
    expect(within(screen.getByText('Recorded OTJH').parentElement!).queryByText('Unavailable')).not.toBeInTheDocument();
    const module = screen.getByRole('button', { name: /Leadership/ });
    fireEvent.click(module);
    selectMonthWeek('Undated activities');
    expect(screen.getByRole('button', { name: 'All subjects' })).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Subject progress' })).toHaveAttribute('aria-valuenow', '50');
    expect(screen.getByText('Not complete')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Reflection activity' })).toBeVisible();
    expect(screen.getByText(/OTJH: Unavailable/)).toBeInTheDocument();
  });

  it('filters activities without changing the full module completion or hours summary', () => {
    render(<StudentActivityPanel data={data} loading={false} error={null} onRetry={vi.fn()} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Search modules or activities' }), { target: { value: 'Reflection' } });
    fireEvent.click(screen.getByRole('button', { name: /Leadership/ }));
    selectMonthWeek('Undated activities');
    expect(within(screen.getByRole('region', { name: 'Module progress' })).getByText('1 of 2 completed')).toBeVisible();
    expect(screen.queryByRole('group', { name: 'Introduction activity' })).not.toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Reflection activity' })).toBeVisible();
  });

  it('offers retry on a failed fetch', () => {
    const retry = vi.fn();
    render(<StudentActivityPanel data={null} loading={false} error="Database unavailable" onRetry={retry} />);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it('identifies a retained historical snapshot instead of presenting it as a live verification', () => {
    const retry = vi.fn();
    render(<StudentActivityPanel data={{ ...data, source_status: 'historical' }} loading={false} error={null} onRetry={retry} />);
    expect(screen.getByRole('status')).toHaveTextContent('The latest results could not be verified');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledOnce();
  });
});

describe('explicit previous learning display groups', () => {
  afterEach(() => vi.restoreAllMocks());
  const metadata = { covers: {}, current_subjects: [{ id: 'M-CURRENT', title: 'Current scheduling' }],
    previous_learning_groups: { 'legacy:1': 'current:M-CURRENT' } };
  const real = { modules: ['Current scheduling'], components: [{ moduleId: 'M-CURRENT', module: 'Current scheduling',
    componentId: 'CURRENT-1', component: 'Current lesson', type: 'reading', week: 'Week 1' }],
    componentProgress: [], quizAttempts: [] } as unknown as LearnerDetail;

  it('shows one course with separate current and previous progress and preserves source filters', async () => {
    vi.spyOn(api, 'subjectRequest').mockResolvedValue(metadata);
    render(<StudentActivityPanel data={data} real={real} kind="commercial" learnerId="132" loading={false} error={null} onRetry={vi.fn()} />);
    const grouped = within(await screen.findByRole('region', { name: 'Current scheduling learning record' }));
    expect(grouped.getByRole('heading', { name: 'Current learning plan' })).toBeVisible();
    expect(grouped.getByRole('heading', { name: 'Previous learning' })).toBeVisible();
    expect(grouped.getByRole('progressbar', { name: 'Current scheduling current plan activities progress' })).toHaveAttribute('aria-valuenow', '0');
    expect(grouped.getByRole('progressbar', { name: 'Leadership previous learning activities progress' })).toHaveAttribute('aria-valuenow', '50');
    expect(screen.getByText('1 subjects · 3 activities')).toBeVisible();
    fireEvent.click(screen.getByRole('tab', { name: 'Old LMS' }));
    expect(screen.getByRole('heading', { name: 'Leadership' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Current scheduling' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'New LMS' }));
    expect(screen.getByRole('heading', { name: 'Current scheduling' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Leadership' })).not.toBeInTheDocument();
  });

  it('keeps previous learning standalone when the current detail is unavailable', () => {
    const summary = buildUnifiedLearningSummary(data, null, metadata);
    expect(summary.subjectCount).toBe(1);
    expect(summary.subjects[0].source).toBe('legacy');
    expect(summary.subjects[0].previousLearningFor).toBeUndefined();
    expect(summary.previousLearning?.completedActivityCount).toBe(1);
  });

  it('does not group lookalike titles without an explicit owned mapping', () => {
    const summary = buildUnifiedLearningSummary(data, real, { covers: {} });
    expect(summary.subjectCount).toBe(2);
    expect(summary.subjects.every(subject => !subject.previousLearningFor)).toBe(true);
  });
});

describe('quiz recovery', () => {
  function quizLearner(attempts: unknown[]): LearnerDetail {
    return { components: [{ isQuiz: true, component: 'Synthetic quiz', componentId: 'Q1',
      module: 'Synthetic module', week: null, quizMeta: { quizId: 7, questions: 10 } }],
      quizAttempts: attempts } as LearnerDetail;
  }

  it('retains a source-confirmed pass with an unknown score', () => {
    render(<QuizzesTab real={quizLearner([{ quizId: 7, passed: true, grade: null }])} loading={false} loadError={null} canTake={false} navigate={vi.fn()} />);
    const row = within(screen.getByRole('row', { name: /Synthetic quiz/ }));
    expect(row.getByText('Completed')).toBeVisible();
    expect(row.queryByText('0%')).not.toBeInTheDocument();
  });

  it('does not label an unresolved imported result as failed', () => {
    render(<QuizzesTab real={quizLearner([{ quizId: 7, passed: null, grade: null }])} loading={false} loadError={null} canTake={false} navigate={vi.fn()} />);
    const row = within(screen.getByRole('row', { name: /Synthetic quiz/ }));
    expect(row.getByText('Result unavailable')).toBeVisible();
    expect(row.queryByText('Failed')).not.toBeInTheDocument();
  });

  it('displays a recorded zero score instead of replacing it with an absent score', () => {
    render(<QuizzesTab real={quizLearner([{ quizId: 7, passed: null, grade: null }, { quizId: 7, passed: false, grade: 0 }])} loading={false} loadError={null} canTake={false} navigate={vi.fn()} />);
    const row = within(screen.getByRole('row', { name: /Synthetic quiz/ }));
    expect(row.getByText('0%')).toBeVisible();
    expect(row.getByText('Failed')).toBeVisible();
  });

  it('preserves a previous pass when a higher-scoring later attempt failed', () => {
    render(<QuizzesTab real={quizLearner([{ quizId: 7, passed: false, grade: .9 }, { quizId: 7, passed: true, grade: .8 }])} loading={false} loadError={null} canTake={false} navigate={vi.fn()} />);
    expect(within(screen.getByRole('row', { name: /Synthetic quiz/ })).getByText('Completed')).toBeVisible();
  });

  it('offers retry when the learner detail request fails', () => {
    const retry = vi.fn();
    render(<QuizzesTab real={null} loading={false} loadError="Could not load quizzes" kind="commercial" id="132" canTake navigate={vi.fn()} onRetry={retry} />);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledOnce();
  });
});

const linkedMetadata = {
  covers: {},
  current_subjects: [{ id: 'MOD-1', title: 'Leadership' }],
  builder_subjects: { 'legacy:1': { id: 'MOD-1', title: 'Leadership' } },
  activity_sources: {
    'COMP-10': { module_id: 'MOD-1', group_id: 1, activity_id: 10 },
    'COMP-11': { module_id: 'MOD-1', group_id: 1, activity_id: 11 },
  },
};
const linkedReal = {
  modules: ['Leadership'], studentActivityAvailable: true,
  components: [
    { componentId: 'COMP-10', moduleId: 'MOD-1', module: 'Leadership', component: 'Introduction', type: 'video' },
    { componentId: 'COMP-11', moduleId: 'MOD-1', module: 'Leadership', component: 'Reflection', type: 'reading' },
    { componentId: 'NEW-12', moduleId: 'MOD-1', module: 'Leadership', component: 'Reflection', type: 'reading' },
  ],
  componentProgress: [{ componentId: 'COMP-11', kind: 'component' }],
} as LearnerDetail;

describe('subjects shared with Module Builder', () => {
  afterEach(() => vi.restoreAllMocks());

  it('counts effective-plan modules even when newly inherited modules have no activities yet', () => {
    const summary = buildUnifiedLearningSummary(null, null, {
      covers: {},
      current_subjects: [
        { id: 'SAVED-1', title: 'Saved module' },
        { id: 'GROUP-NEW-1', title: 'New from group one' },
        { id: 'GROUP-NEW-2', title: 'New from group two' },
      ],
    });

    expect(summary.subjectCount).toBe(3);
    expect(summary.subjects.map(subject => subject.id)).toEqual([
      'current:GROUP-NEW-1', 'current:GROUP-NEW-2', 'current:SAVED-1',
    ]);
    expect(summary.activityCount).toBe(0);
  });

  it('uses verified activity lineage from the activity API when the cover response has none', () => {
    const summary = buildUnifiedLearningSummary({ ...data, activity_sources: linkedMetadata.activity_sources }, linkedReal,
      { covers: {}, current_subjects: [{ id: 'MOD-1', title: 'Renamed current module' }] });
    expect(summary.subjectCount).toBe(2);
    expect(summary.activityCount).toBe(3);
    expect(summary.completedActivityCount).toBe(1);
  });


  it('opens a native module directly in its activity player without month or week clicks', async () => {
    vi.spyOn(api, 'subjectRequest').mockResolvedValue({ covers: {} });
    const real = { modules: ['Native module'], components: [
      { componentId: 'COMP-1', moduleId: 'MOD-1', module: 'Native module', week: 'Week 1',
        component: 'Native reading', type: 'reading', contentHtml: '<p>Read this lesson.</p>' },
    ] } as LearnerDetail;
    function Location() { return <output data-testid="path">{useLocation().pathname}</output>; }
    render(<><Location /><StudentActivityPanel real={real} data={null} kind="commercial" learnerId="132" loading={false} error={null} onRetry={vi.fn()} /></>);
    fireEvent.click(await screen.findByRole('button', { name: /Native module/ }));
    expect(screen.getByTestId('path')).toHaveTextContent('/learner/component/commercial/132/COMP-1');
  });

  it.each(['132', '245'])('places a newly built Introduction before months for learner %s', async learnerId => {
    const real = { modules: ['New module'], components: [
      { componentId: 'NEW-INTRO', moduleId: 'NEW-MODULE', module: 'New module', component: 'Welcome', type: 'reading', week: 'Introduction' },
      { componentId: 'NEW-LESSON', moduleId: 'NEW-MODULE', module: 'New module', component: 'First lecture', type: 'reading', week: 'Week 1' },
    ], componentProgress: [{ componentId: 'NEW-INTRO', kind: 'component' }] } as LearnerDetail;
    vi.spyOn(api, 'subjectRequest').mockResolvedValue({ covers: {}, current_subjects: [{ id: 'NEW-MODULE', title: 'New module' }],
      activity_dates: { 'NEW-INTRO': { date: null, month: 'undated', date_source: 'introduction' },
        'NEW-LESSON': { date: '2026-10-21', month: '2026-10', week_start: '2026-10-19', week_end: '2026-10-25' } } });
    render(<StudentActivityPanel data={null} real={real} kind="commercial" learnerId={learnerId} loading={false} error={null} onRetry={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: /New module/ }));
    const headings = within(screen.getByRole('complementary', { name: 'Module activities' })).getAllByRole('heading', { level: 3 });
    expect(headings[0]).toHaveTextContent('Introduction');
    expect(headings[1]).toHaveTextContent('October 2026');
    expect(weekProgress()).toHaveAttribute('aria-valuenow', '0');
    expect(screen.getByRole('progressbar', { name: 'Subject progress' })).toHaveAttribute('aria-valuenow', '50');
    selectMonthWeek('Introduction');
    expect(weekProgress()).toHaveAttribute('aria-valuenow', '100');
    expect(screen.getByRole('group', { name: 'Welcome activity' })).toBeVisible();
    expect(screen.getByRole('group', { name: 'First lecture activity', hidden: true })).not.toBeVisible();
    expect(within(screen.getByRole('complementary', { name: 'Module activities' })).getByText('First lecture')).toBeVisible();
  });

  it('shows native components in every future month with their completion totals', async () => {
    const real = { modules: ['New programme'], components: [
      { componentId: 'READING', moduleId: 'M1', module: 'New programme', week: 'Week 1', component: 'October reading', type: 'reading' },
      { componentId: 'QUIZ', moduleId: 'M1', module: 'New programme', week: 'Week 5', component: 'November quiz', type: 'quiz' },
      { componentId: 'ASSIGNMENT', moduleId: 'M1', module: 'New programme', week: 'Week 9', component: 'December assignment', type: 'assignment' },
      { componentId: 'VIDEO', moduleId: 'M1', module: 'New programme', week: 'Week 13', component: 'January video', type: 'video' },
    ], componentProgress: [{ componentId: 'READING', kind: 'component' }] } as LearnerDetail;
    vi.spyOn(api, 'subjectRequest').mockResolvedValue({ covers: {}, activity_dates: {
      READING: { date: '2026-10-05', month: '2026-10', week_start: '2026-10-05', week_end: '2026-10-11', date_source: 'builder_week' },
      QUIZ: { date: '2026-11-02', month: '2026-11', week_start: '2026-11-02', week_end: '2026-11-08', date_source: 'builder_week' },
      ASSIGNMENT: { date: '2026-12-07', month: '2026-12', week_start: '2026-12-07', week_end: '2026-12-13', date_source: 'builder_week' },
      VIDEO: { date: '2027-01-04', month: '2027-01', week_start: '2027-01-04', week_end: '2027-01-10', date_source: 'builder_week' },
    } });
    render(<StudentActivityPanel data={null} real={real} kind="commercial" learnerId="245" loading={false} error={null} onRetry={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: /New programme/ }));
    expect(screen.getByText('1 of 4 completed')).toBeVisible();
    expect(screen.queryByRole('region', { name: 'September 2026' })).not.toBeInTheDocument();
    for (const [month, title] of [['October 2026', 'October reading'], ['November 2026', 'November quiz'],
      ['December 2026', 'December assignment'], ['January 2027', 'January video']]) {
      expect(within(screen.getByRole('complementary', { name: 'Module activities' })).getByRole('heading', { name: month })).toBeVisible();
      selectMonthWeek(month);
      expect(screen.getByRole('group', { name: `${title} activity` })).toBeVisible();
    }
    expect(screen.getByRole('progressbar', { name: 'Subject progress' })).toHaveAttribute('aria-valuenow', '25');
  });

  it.each(['original_created_at', 'source_date', 'undated'])('ignores native %s metadata when choosing the delivery month', date_source => {
    const real = { modules: ['New programme'], components: [
      { componentId: 'LIVE', moduleId: 'M1', module: 'New programme', component: 'Live session', sessionDate: '2026-12-04' },
      { componentId: 'READING', moduleId: 'M1', module: 'New programme', component: 'Unscheduled reading' },
    ] } as LearnerDetail;
    const stale = { date: '2026-09-12', month: '2026-09', date_source };
    const [subject] = subjectsFrom(null, real, { covers: {}, activity_dates: { LIVE: stale, READING: stale } });
    expect(subject.activities[0].schedule.month).toBe('2026-12');
    expect(subject.activities[1].schedule.month).toBe('undated');
  });


  it.each(['legacy', 'native'])('waits for metadata even when only %s data has arrived', async source => {
    let finish!: (value: typeof linkedMetadata) => void;
    vi.spyOn(api, 'subjectRequest').mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    render(<StudentActivityPanel data={source === 'legacy' ? data : null} real={source === 'native' ? linkedReal : null}
      kind="commercial" learnerId="132" loading={false} error={null} onRetry={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading subjects');
    expect(screen.queryByRole('button', { name: /New LMS.*Leadership/ })).not.toBeInTheDocument();
    await act(async () => finish(linkedMetadata));
    expect(screen.getByRole('region', { name: 'Your subjects' })).toBeInTheDocument();
  });


  it('shows a metadata retry instead of misleading partial cards', async () => {
    vi.spyOn(api, 'subjectRequest').mockRejectedValueOnce(new Error('Unavailable')).mockResolvedValueOnce(linkedMetadata);
    render(<StudentActivityPanel data={data} real={null} learnerId="132" loading={false} error={null} onRetry={vi.fn()} />);
    await screen.findByRole('alert');
    expect(screen.queryByRole('button', { name: /Leadership/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByRole('button', { name: /Leadership/ });
  });

  it('never keeps a complete previous learner snapshot after switching learner', async () => {
    vi.spyOn(api, 'subjectRequest').mockResolvedValueOnce(linkedMetadata).mockReturnValueOnce(new Promise(() => {}));
    const props = { data, real: linkedReal, kind: 'commercial', error: null, onRetry: vi.fn() };
    const { rerender } = render(<StudentActivityPanel {...props} learnerId="132" loading={false} />);
    await screen.findByRole('button', { name: /New LMS.*Leadership/ });
    rerender(<StudentActivityPanel {...props} learnerId="133" loading />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading subjects');
    expect(screen.queryByText('Anna Rundell')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /New LMS.*Leadership/ })).not.toBeInTheDocument();
  });

  it('refreshes assignment metadata even when a new module has no component ids yet', async () => {
    const initial = { modules: [], components: [] } as unknown as LearnerDetail;
    const updated = { ...initial, modules: ['New module'] };
    const assigned = { covers: {}, current_subjects: [{ id: 'MOD-NEW', title: 'New module' }] };
    const request = vi.spyOn(api, 'subjectRequest').mockResolvedValueOnce({ covers: {}, current_subjects: [] }).mockResolvedValueOnce(assigned);
    const { result, rerender } = renderHook(({ real }) => useSubjectMetadata(null, real, 'commercial', '101'), { initialProps: { real: initial } });
    await waitFor(() => expect(result.current.metadata?.current_subjects).toEqual([]));
    rerender({ real: updated });
    expect(result.current.metadata).toBeUndefined();
    await waitFor(() => expect(result.current.metadata).toEqual(assigned));
    expect(request).toHaveBeenCalledTimes(2);
    expect(subjectsFrom(null, updated, result.current.metadata)).toEqual([
      { id: 'current:MOD-NEW', title: 'New module', source: 'current', activities: [] },
    ]);
  });

  it('keeps linked historical and current completions separate without mutating history', () => {
    const subjects = subjectsFrom(data, linkedReal, linkedMetadata);
    expect(subjects).toHaveLength(2);
    const previous = subjects.find(subject => subject.id === 'legacy:1')!;
    const current = subjects.find(subject => subject.id === 'current:MOD-1')!;
    expect(previous.activities.map(a => [a.id, a.completed])).toEqual([['la:1:10', true], ['la:1:11', false]]);
    expect(current.activities.map(a => [a.id, a.completed])).toEqual([['COMP-10', false], ['COMP-11', true], ['NEW-12', false]]);
    expect(previous.activities[1].legacy).toBe(data.activities[1]);
    expect(data.activities[1].completed).toBe(false);
  });

  it('calculates the primary percentage from the current plan only', () => {
    const summary = buildUnifiedLearningSummary(data, linkedReal, linkedMetadata);
    expect(summary).toMatchObject({
      subjectCount: 2,
      activityCount: 3,
      completedActivityCount: 1,
      percent: 33.33,
      previousLearning: { activityCount: 2, completedActivityCount: 1, percent: 50 },
    });
  });

  it('shows recorded time across all displayed subjects, including later direct time', () => {
    render(<StudentActivityPanel data={{ ...data, actual_total: 1, recorded_otjh_total: 3.5, planned_total: 2 }} loading={false} error={null} onRetry={vi.fn()} />);
    expect(within(screen.getByText('Recorded OTJH').parentElement!).getByText('3h 30m')).toBeInTheDocument();
    expect(within(screen.getByText('Planned OTJH').parentElement!).getByText('2h')).toBeInTheDocument();
  });

  it('uses comparable whole-programme OTJH totals when the audit supplies them', () => {
    render(<StudentActivityPanel data={{
      ...data,
      actual_total: 1,
      recorded_otjh_total: 3.5,
      planned_total: 2,
      audit_lms_actual: 1171.3406,
      audit_tp_planned: 867,
    }} loading={false} error={null} onRetry={vi.fn()} />);
    expect(within(screen.getByText('Recorded OTJH').parentElement!).getByText('1171h 20m')).toBeInTheDocument();
    expect(within(screen.getByText('Planned OTJH').parentElement!).getByText('867h')).toBeInTheDocument();
    expect(screen.getByText(/Programme totals include accepted historical hours/)).toBeInTheDocument();
  });

  it('keeps previous and current courses separate even with identical titles', () => {
    const separate = { ...linkedReal, components: [
      ...linkedReal.components,
      { ...linkedReal.components[0], moduleId: 'OTHER', componentId: 'OTHER-10' },
    ] };
    const subjects = subjectsFrom(data, separate, linkedMetadata);
    expect(subjects).toHaveLength(3);
    expect(subjects.find((s) => s.id === 'current:OTHER')?.activities).toHaveLength(1);
    const wrongScope = { ...linkedMetadata, activity_sources: { 'COMP-10': { module_id: 'OTHER', group_id: 1, activity_id: 10 } } };
    expect(subjectsFrom(data, linkedReal, wrongScope).find(s => s.id === 'legacy:1')?.activities).toHaveLength(2);
    const titleLinked = subjectsFrom(data, linkedReal, { ...linkedMetadata, builder_subjects: {} });
    expect(titleLinked).toHaveLength(2);
    expect(titleLinked[0].activities).toHaveLength(3);
  });

  it('keeps the highest quiz score and a previous pass after a failed retake', () => {
    const history = { ...data, activities: [{ ...data.activities[0], quiz_score: 8, quiz_maximum_score: 10 }] };
    const quizReal = { ...linkedReal, components: [{ ...linkedReal.components[0], isQuiz: true, quizMeta: { quizId: 7 } }],
      quizAttempts: [{ quizId: 7, grade: .9, passed: true }, { quizId: 7, grade: .2, passed: false }] } as LearnerDetail;
    const entry = subjectsFrom(history, quizReal, linkedMetadata)[0].activities[0];
    expect(entry.completed).toBe(true);
    expect(entry.bestScorePercent).toBe(90);
    expect(entry.legacy).toBeUndefined();
    expect(subjectsFrom(history, quizReal, linkedMetadata).find(s => s.source === 'legacy')?.activities[0].legacy).toBe(history.activities[0]);
  });

  it('fetches metadata once without flashing duplicate cards or refetching after Builder renames', async () => {
    let resolve!: (value: typeof linkedMetadata) => void;
    const request = vi.spyOn(api, 'subjectRequest').mockImplementation(() => new Promise((done) => { resolve = done; }));
    render(<StudentActivityPanel data={data} real={linkedReal} kind="commercial" learnerId="132" loading={false} error={null} onRetry={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading subjects');
    expect(screen.queryByRole('button', { name: /New LMS.*Leadership/ })).not.toBeInTheDocument();
    await act(async () => resolve({ ...linkedMetadata, builder_subjects: { 'legacy:1': { id: 'MOD-1', title: 'Renamed Leadership' } } }));
    expect(screen.getAllByRole('button', { name: /Renamed Leadership/ })).toHaveLength(1);
    expect(screen.getByText('1 of 3 completed')).toBeInTheDocument();
    expect(request).toHaveBeenCalledOnce();
  });

  it('does not apply metadata from a previous learner when responses arrive out of order', async () => {
    let first!: (value: typeof linkedMetadata) => void;
    let second!: (value: typeof linkedMetadata) => void;
    const request = vi.spyOn(api, 'subjectRequest')
      .mockImplementationOnce(() => new Promise((resolve) => { first = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { second = resolve; }));
    const props = { data, real: linkedReal, kind: 'commercial', loading: false, error: null, onRetry: vi.fn() };
    const { rerender } = render(<StudentActivityPanel {...props} learnerId="132" />);
    rerender(<StudentActivityPanel {...props} learnerId="133" />);
    await act(async () => second(linkedMetadata));
    await act(async () => first({ ...linkedMetadata, builder_subjects: { 'legacy:1': { id: 'MOD-1', title: 'Old learner title' } } }));
    expect(screen.queryByText('Old learner title')).not.toBeInTheDocument();
    expect(screen.getByText('1 of 3 completed')).toBeInTheDocument();
    expect((request.mock.calls[0][1]?.signal as AbortSignal).aborted).toBe(true);
  });
});

const scheduledData: StudentActivityResponse = {
  ...data, count: 3, unique_activity_count: 3,
  activities: [
    { ...data.activities[0], date: '2026-02-05', month: '2026-02', week_start: '2026-02-02', week_end: '2026-02-08' },
    { ...data.activities[1], date: '2026-02-06', month: '2026-02', week_start: '2026-02-02', week_end: '2026-02-08' },
    { ...data.activities[1], activity_id: 'la:1:12', source_activity_id: 12, activity: 'March lesson', date: '2026-03-02', month: '2026-03', week_start: '2026-03-02', week_end: '2026-03-08' },
  ],
};

const activityMaterial: SubjectMaterial = {
  title: 'Reflection', reading_html: '', media: [{ kind: 'embed', url: 'https://example.org/lesson', title: 'Reflection frame' }],
  quiz: null, has_reading: true, available: true, source_live: true, completed: false,
  persistence_ready: true, can_attempt: true, csrf_token: 'csrf-value', history: [],
  historical: { score: null, maximum_score: null, passed: null, attempt_number: null, status: null, answers: [] },
};
const completeResult: SubjectAttemptResult = { score_percent: null, passed: null, completed: true };

function mockMaterialRequests(material = activityMaterial, save: () => Promise<SubjectAttemptResult> = async () => completeResult) {
  return vi.spyOn(api, 'subjectRequest').mockImplementation(async <T,>(url: string, options?: Parameters<typeof fetch>[1]): Promise<T> => {
    if (url.includes('/subject-covers/')) return { covers: {} } as T;
    if (options?.method !== 'POST') return material as T;
    if (url.endsWith('/attempts/')) return { attempt_id: 'attempt-1', definition: { quiz: material.quiz }, timing: { trackingToken: 'synthetic-token', startedAt: new Date().toISOString(), countingMode: material.quiz ? 'active_quiz' : 'visible_page' } } as T;
    return await save() as T;
  });
}

describe('subject months, weeks and completion', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

  it.each(['commercial', 'apprenticeship'])('opens linked Reading + Quiz together once without changing saved totals (%s)', async kind => {
    const requests = mockMaterialRequests({ ...activityMaterial, reading_html: '<p>Chapter text</p>', quiz: {
      id: '20', body: '', ready: true, message: '', passing_percent: 70,
      questions: [{ id: '1', type: 'single_choice', text: 'Chapter question', options: [{ id: 'a', text: 'Chapter answer' }] }],
    } });
    const paired = { ...data, activities: [
      { ...data.activities[1], activity_id: 'catalogue:1:material:11', catalogue_kind: 'material', category: 'Reading+Quiz' },
      { ...data.activities[1], activity_id: 'catalogue:1:quiz:20', source_activity_id: 20, catalogue_kind: 'quiz', category: 'quiz',
        activity: 'Companion quiz', source_material_activity_id: 'catalogue:1:material:11' },
    ] };
    render(<StudentActivityPanel data={paired} kind={kind} learnerId="132" loading={false} error={null} onRetry={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: /Leadership/ }));
    const sidebar = within(screen.getByRole('complementary', { name: 'Module activities' }));
    expect(sidebar.getAllByRole('button', { name: /Reading \+ Quiz.*Reflection/ })).toHaveLength(1);
    expect(sidebar.queryByRole('button', { name: /Companion quiz/ })).not.toBeInTheDocument();
    expect(await screen.findByText('Chapter text')).toBeVisible();
    expect(screen.getByText('Chapter question')).toBeVisible();
    expect(screen.getByText('Chapter answer')).toBeVisible();
    expect(screen.getAllByText('0 of 2 completed')).toHaveLength(2);
    const reads = requests.mock.calls.filter(([url, options]) => url.includes('/student-activity/') && options?.method !== 'POST');
    expect(reads).toHaveLength(1);
    expect(reads[0][0]).toContain('group_id=1&activity_id=11');
    expect(reads[0][0]).not.toContain('catalogue_kind=quiz');
    expect(requests.mock.calls.filter(([url, options]) => url.endsWith('/attempts/') && options?.method === 'POST')).toHaveLength(1);
    expect(requests.mock.calls.some(([url]) => url.endsWith('/attempt-1/'))).toBe(false);
  });

  it.each(['commercial', 'apprenticeship'])('opens the dated current-week component before unfinished introduction content (%s)', async kind => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-03-03T12:00:00Z'));
    const requests = mockMaterialRequests();
    const current = { ...scheduledData, activities: [
      { ...data.activities[1], activity_id: 'intro', source_activity_id: 99, month: 'undated', date_source: 'introduction', section_title: 'Introduction' },
      ...scheduledData.activities,
    ] };
    render(<StudentActivityPanel data={current} kind={kind} learnerId="132" loading={false} error={null} onRetry={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: /Leadership/ }));
    expect(await screen.findByRole('region', { name: 'March lesson content' })).toBeVisible();
    expect(await screen.findByTitle('Reflection frame')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Open activity' })).not.toBeInTheDocument();
    expect(requests.mock.calls.filter(([url, options]) => url.includes('/student-activity/') && options?.method !== 'POST')).toHaveLength(1);
    expect(requests.mock.calls.find(([url]) => url.includes('/student-activity/'))![0]).toContain('activity_id=12');
    expect(screen.getByText('Current week')).toBeVisible();
    selectMonthWeek('Introduction');
    expect(screen.getByText('Current week')).toBeVisible();
    expect(screen.getByRole('button', { name: /Week 2.*Current/ })).toBeVisible();
    await waitFor(() => expect(requests.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(2));
    expect(requests.mock.calls.some(([url]) => url.endsWith('/attempt-1/'))).toBe(false);
  });

  it('opens completed course content for review without calling any week current', async () => {
    mockMaterialRequests({ ...activityMaterial, completed: true, can_attempt: false });
    const completed = { ...scheduledData, activities: scheduledData.activities.map(entry => ({ ...entry, completed: true })) };
    render(<StudentActivityPanel data={completed} kind="commercial" learnerId="132" loading={false} error={null} onRetry={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: /Leadership/ }));
    expect(await screen.findByTitle('Reflection frame')).toBeVisible();
    expect(screen.queryByText('Current week')).not.toBeInTheDocument();
    expect(screen.queryByText('Current', { exact: true })).not.toBeInTheDocument();
    expect(screen.getByText('Week activities')).toBeVisible();
    expect(screen.getByRole('progressbar', { name: 'Subject progress' })).toHaveAttribute('aria-valuenow', '100');
    selectMonthWeek('March 2026');
    expect(screen.getByRole('region', { name: 'March lesson content' })).toBeVisible();
    expect(screen.queryByText('Current', { exact: true })).not.toBeInTheDocument();
  });

  it('completes a reused activity only in the course where it was submitted', async () => {
    mockMaterialRequests();
    const first = { ...data.activities[1], group_name: 'Course A' };
    const second = { ...first, activity_id: 'la:2:11', group_id: 2, group_name: 'Course B' };
    render(<StudentActivityPanel data={{ ...data, activities: [first, second], count: 2, completed_count: 0, module_count: 2 }} kind="commercial" learnerId="132" loading={false} error={null} onRetry={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: /Course A/ }));
    selectMonthWeek('Undated activities');
    expect(await screen.findByRole('region', { name: 'Reflection content' })).toBeVisible();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Finish' })).toBeEnabled());
    fireEvent.click(await screen.findByRole('button', { name: 'Finish' }));
    await screen.findByText('Activity completed.');
    expect(screen.getByRole('progressbar', { name: 'Subject progress' })).toHaveAttribute('aria-valuenow', '100');
    fireEvent.click(screen.getByRole('button', { name: 'All subjects' }));
    expect(within(screen.getByRole('button', { name: /Course B/ })).getByText('0 of 1 completed')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /Course B/ }));
    expect(screen.getByRole('progressbar', { name: 'Subject progress' })).toHaveAttribute('aria-valuenow', '0');
  });

  it.each(['commercial', 'apprenticeship'])('opens historical quizzes from the shared sidebar without confusing material IDs (%s)', async kind => {
    const requests = mockMaterialRequests({ ...activityMaterial, completed: true, has_reading: false,
      reading_html: '<p>Saved quiz review</p>', can_attempt: false });
    const history: StudentActivityResponse = { ...data, activities: [
      { ...data.activities[0], activity_id: 'catalogue:1:material:10', catalogue_kind: 'material', activity: 'Original reading' },
      { ...data.activities[0], activity_id: 'catalogue:1:quiz:10', catalogue_kind: 'quiz', category: 'quiz', activity: 'Original quiz', can_open_material: false },
      { ...data.activities[1], activity: 'Unavailable material', catalogue_kind: 'material', can_open_material: false },
    ] };
    render(<StudentActivityPanel data={history} kind={kind} learnerId="132" loading={false} error={null} onRetry={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: /Leadership/ }));
    const sidebar = within(screen.getByRole('complementary', { name: 'Module activities' }));
    expect(sidebar.getByRole('button', { name: /Unavailable material/ })).toBeDisabled();
    fireEvent.click(sidebar.getByRole('button', { name: /Original quiz/ }));
    const review = await screen.findByRole('region', { name: 'Original quiz content' });
    expect(await within(review).findByText('Saved quiz review')).toBeVisible();
    expect(screen.getByRole('group', { name: 'Original quiz activity' })).toHaveTextContent('Complete');
    expect(screen.queryByRole('region', { name: 'Original reading content' })).not.toBeInTheDocument();
    const materialRequests = requests.mock.calls.filter(([url]) => url.includes('/student-activity/'));
    expect(materialRequests).toHaveLength(2);
    expect(materialRequests[0][0]).toContain(`/student-activity/${kind}/132/?group_id=1&activity_id=10`);
    expect(materialRequests[1][0]).toContain(`/student-activity/${kind}/132/?group_id=1&activity_id=10&catalogue_kind=quiz`);
    expect(requests.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: /Start quiz|Try quiz again|Submit/ })).not.toBeInTheDocument();
  });

  it('uses the shared week sidebar and preserves opened material when switching weeks', async () => {
    const requests = mockMaterialRequests();
    render(<StudentActivityPanel data={scheduledData} kind="commercial" learnerId="132" loading={false} error={null} onRetry={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: /Leadership/ }));
    expect(screen.getByRole('complementary', { name: 'Module activities' })).toBeVisible();
    expect(screen.queryByRole('button', { name: /^Expand February/ })).not.toBeInTheDocument();
    const frame = await screen.findByTitle('Reflection frame');
    expect(screen.queryByRole('button', { name: 'Open activity' })).not.toBeInTheDocument();
    expect(frame).toHaveAttribute('src', 'https://example.org/lesson');
    selectMonthWeek('March 2026');
    expect(frame).not.toBeVisible();
    expect(screen.getByRole('region', { name: 'March lesson content' })).toBeVisible();
    await waitFor(() => expect(within(screen.getByRole('region', { name: 'March lesson content' })).getByRole('button', { name: 'Finish' })).toBeEnabled());
    selectMonthWeek();
    expect(frame).toBeVisible();
    expect(screen.getByRole('region', { name: 'Reflection content' })).toBeVisible();
    expect(requests.mock.calls.filter(([url]) => url.includes('activity_id=11'))).toHaveLength(1);
    await waitFor(() => expect(requests.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(2));
    expect(requests.mock.calls.some(([url]) => url.endsWith('/attempt-1/'))).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'All subjects' }));
    fireEvent.click(screen.getByRole('button', { name: /Leadership/ }));
    expect(await screen.findByTitle('Reflection frame')).toBeVisible();
  });

  it('keeps course and week progress based on all activities while searching', () => {
    render(<StudentActivityPanel data={scheduledData} loading={false} error={null} onRetry={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Leadership/ }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Search modules or activities' }), { target: { value: 'Reflection' } });
    selectMonthWeek();
    expect(screen.getByRole('progressbar', { name: 'Subject progress' })).toHaveAttribute('aria-valuenow', '33.33');
    expect(weekProgress()).toHaveAttribute('aria-valuenow', '50');
    expect(screen.getByRole('complementary', { name: 'Module activities' })).toHaveTextContent(/2 components\s*\u00b7\s*1 done/);
    expect(screen.getByText(/1 ÷ 3 × 100 = 33.33%/)).toBeInTheDocument();
  });

  it('puts extras last, excludes them from August and updates their progress after Submit', async () => {
    const requests = mockMaterialRequests();
    const courseData: StudentActivityResponse = { ...data, activities: [
      ...Array.from({ length: 52 }, (_, index) => ({ ...data.activities[0],
        activity_id: `la:1:${100 + index}`, source_activity_id: 100 + index,
        date: '2026-08-25', month: '2026-08', week_start: '2026-08-24', week_end: '2026-08-30' })),
      { ...data.activities[1], activity_id: 'la:1:200', source_activity_id: 200,
        activity: 'September lesson', date: '2026-09-01', month: '2026-09' },
      { ...data.activities[1], activity_id: 'la:1:201', source_activity_id: 201, activity: 'Undated lesson' },
      ...Array.from({ length: 10 }, (_, index) => ({ ...data.activities[1],
        activity_id: `la:1:${300 + index}`, source_activity_id: 300 + index,
        activity: index === 0 ? 'Extra reading' : `Extra activity ${index + 1}`,
        month: 'undated', date_source: 'extra_activity', source_date: '2026-08-24',
        section_title: 'Lec13: Financial Accounts' })),
    ] };
    render(<StudentActivityPanel data={courseData} kind="commercial" learnerId="132" loading={false} error={null} onRetry={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: /Leadership/ }));
    const headings = within(screen.getByRole('complementary', { name: 'Module activities' })).getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent);
    expect(headings.at(-1)).toContain('Extra activities');
    expect(screen.queryByRole('group', { name: 'Extra reading activity' })).not.toBeInTheDocument();
    selectMonthWeek('August 2026');
    expect(weekProgress()).toHaveAttribute('aria-valuenow', '100');
    selectMonthWeek('Extra activities');
    expect(weekProgress()).toHaveAttribute('aria-valuenow', '0');
    expect(screen.getByText('52 of 64 completed')).toBeInTheDocument();
    selectMonthWeek('Extra activities');
    fireEvent.change(screen.getByRole('textbox', { name: 'Search modules or activities' }), { target: { value: 'Extra reading' } });
    expect(weekProgress()).toHaveAttribute('aria-valuenow', '0');
    expect(screen.getByRole('region', { name: 'Extra reading content' })).toBeVisible();
    expect(await within(screen.getByRole('region', { name: 'Extra reading content' })).findByTitle('Reflection frame')).toBeVisible();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Finish' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
    await screen.findByText('Activity completed.');
    expect(weekProgress()).toHaveAttribute('aria-valuenow', '10');
    expect(screen.getByRole('complementary', { name: 'Module activities' })).toHaveTextContent(/10 components\s*\u00b7\s*1 done/);
    expect(screen.getByText('53 of 64 completed')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: 'Search modules or activities' }), { target: { value: '' } });
    selectMonthWeek('August 2026');
    expect(weekProgress()).toHaveAttribute('aria-valuenow', '100');
    expect(requests.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(2);
  });

  it('shows Introduction before months without an upload date and preserves scores and completion', async () => {
    mockMaterialRequests();
    const introData: StudentActivityResponse = { ...data, activities: [
      { ...data.activities[0], activity: 'Safeguarding', category: 'reading+quiz', month: 'undated',
        date_source: 'introduction', source_date: '2025-05-27', section_title: 'Introduction', quiz_score: 80, quiz_maximum_score: 100 },
      { ...data.activities[1], month: 'undated', date_source: 'introduction', section_title: 'Introduction' },
      { ...data.activities[1], activity_id: 'la:1:12', source_activity_id: 12, activity: 'October lecture',
        date: '2025-10-21', month: '2025-10', week_start: '2025-10-20', week_end: '2025-10-26' },
      { ...data.activities[1], activity_id: 'la:1:13', source_activity_id: 13, activity: 'Extra task',
        month: 'undated', date_source: 'extra_activity', section_title: 'Additional resources' },
    ] };
    render(<StudentActivityPanel data={introData} kind="commercial" learnerId="132" loading={false} error={null} onRetry={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: /Leadership/ }));
    const headings = within(screen.getByRole('complementary', { name: 'Module activities' })).getAllByRole('heading', { level: 3 });
    expect(headings[0]).toHaveTextContent('Introduction');
    expect(headings[1]).toHaveTextContent('October 2025');
    expect(headings.at(-1)).toHaveTextContent('Extra activities');
    expect(screen.queryByText('May 2025')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Introduction, 2 components/ })).toHaveAttribute('aria-current', 'step');
    expect(weekProgress()).toHaveAttribute('aria-valuenow', '50');
    selectMonthWeek('Introduction');
    fireEvent.click(within(screen.getByRole('complementary', { name: 'Module activities' })).getByRole('button', { name: /Safeguarding/ }));
    expect(screen.getByRole('group', { name: 'Safeguarding activity' })).toBeVisible();
    expect(within(screen.getByRole('group', { name: 'Safeguarding activity' })).getByText('Complete')).toBeVisible();
    expect(screen.getByText(/Best score 80%/)).toBeVisible();
    expect(screen.queryByText(/2025-05-27|Activities awaiting a date/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'October lecture' })).not.toBeInTheDocument();
    fireEvent.click(within(screen.getByRole('complementary', { name: 'Module activities' })).getByRole('button', { name: /Reflection/ }));
    await within(screen.getByRole('region', { name: 'Reflection content' })).findByTitle('Reflection frame');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Finish' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
    await screen.findByText('Activity completed.');
    expect(weekProgress()).toHaveAttribute('aria-valuenow', '100');
    expect(screen.getByRole('progressbar', { name: 'Subject progress' })).toHaveAttribute('aria-valuenow', '50');
    selectMonthWeek('October 2025');
    expect(weekProgress()).toHaveAttribute('aria-valuenow', '0');
    selectMonthWeek('Extra activities');
    expect(weekProgress()).toHaveAttribute('aria-valuenow', '0');
  });

  it('shows lecture details without exposing date-review messages to the learner', () => {
    const activities = scheduledData.activities.map((item) => item.source_activity_id === 12
      ? { ...item, section_title: 'Course templates', date_source: 'original_created_at', date_needs_review: true }
      : { ...item, section_title: 'Lecture 1 - 06/02/2026', date_source: 'section_title', date_needs_review: false });
    render(<StudentActivityPanel data={{ ...scheduledData, activities }} loading={false} error={null} onRetry={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Leadership/ }));
    selectMonthWeek();
    selectMonthWeek('March 2026');
    expect(screen.getByText('Lecture: Course templates')).toBeVisible();
    expect(screen.queryByText(/Date awaiting confirmation|Date needs review|activity dates? needs? confirmation/i)).not.toBeInTheDocument();
    selectMonthWeek();
    expect(within(screen.getByRole('region', { name: /materials$/ })).getByText('Lecture: Lecture 1 - 06/02/2026')).toBeVisible();
    expect(screen.queryByText(/Date awaiting confirmation|Date needs review|activity dates? needs? confirmation/i)).not.toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Subject progress' })).toHaveAttribute('aria-valuenow', '33.33');
  });

  it('updates all progress after Submit succeeds, preserves it on refresh failure and never counts reopening twice', async () => {
    let finish!: (result: SubjectAttemptResult) => void;
    const pending = new Promise<SubjectAttemptResult>((resolve) => { finish = resolve; });
    const requests = mockMaterialRequests(activityMaterial, () => pending);
    vi.spyOn(reads, 'readLearnerJson').mockResolvedValueOnce({ subjectId: 'legacy:1',
      detail: { id: '132', modules: [], components: [], week: [], quizAttempts: [], videoProgress: [], componentProgress: [] },
      activity: scheduledData, metadata: { covers: {} }, schedule: { modules: [], moduleLinks: {}, generatedAt: '' }, sessions: [] })
      .mockRejectedValueOnce(new Error('Refresh unavailable'));
    renderReact(<MemoryRouter initialEntries={['/?subject=legacy%3A1']}><CompactModules kind="commercial" id="132" catalogue={{ learner: { id: '132', kind: 'commercial', name: 'Synthetic learner', programme: '', cohort: '', group: '' },
      summary: { current: { subjects: 0, total: 0, completed: 0, percent: 0 }, previous: { subjects: 1, total: 3, completed: 1, percent: 33.33 }, subjectCount: 1 },
      modules: [{ id: 'legacy:1', title: 'Leadership', source: 'legacy', activityCount: 3, completedActivityCount: 1, progress: 33.33, status: 'In progress', finalTestPassed: false }],
      otjh: { actual: null, planned: null }, upcoming: [], hasMoreUpcoming: false }} loading={false} error="" refresh={vi.fn()} /></MemoryRouter>);
    await screen.findByRole('button', { name: 'All subjects' });
    selectMonthWeek();
    expect(screen.getByRole('region', { name: 'Reflection content' })).toBeVisible();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Finish' })).toBeEnabled());
    const submit = await screen.findByRole('button', { name: 'Finish' });
    const frame = screen.getByTitle('Reflection frame');
    expect(frame.compareDocumentPosition(submit) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'Activity completion' })).getByText('Not complete')).toBeVisible();
    fireEvent.click(submit);
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
    expect(screen.getByRole('progressbar', { name: 'Subject progress' })).toHaveAttribute('aria-valuenow', '33.33');
    await waitFor(() => expect(requests.mock.calls.some(([url]) => url.endsWith('/attempt-1/'))).toBe(true));
    await act(async () => { finish(completeResult); });
    expect(await screen.findByText('Activity completed.')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Activity completion' })).getByText('Complete')).toBeVisible();
    expect(await screen.findByText(/Refresh unavailable/)).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Subject progress' })).toHaveAttribute('aria-valuenow', '66.67');
    expect(weekProgress()).toHaveAttribute('aria-valuenow', '100');
    expect(screen.getByRole('complementary', { name: 'Module activities' })).toHaveTextContent(/2 components\s*\u00b7\s*2 done/);
    const submitted = requests.mock.calls.find(([url]) => url.endsWith('/attempt-1/'))![1]!;
    expect(JSON.parse(submitted.body as string)).toEqual({ answers: {}, reading_confirmed: true, trackingToken: 'synthetic-token', timeTakenSeconds: expect.any(Number) });
    expect(submitted.headers).toMatchObject({ 'X-CSRFToken': 'csrf-value' });
    selectMonthWeek('March 2026');
    selectMonthWeek();
    expect(within(screen.getByRole('region', { name: 'Reflection content' })).getByText('Complete')).toBeVisible();
    expect(within(screen.getByRole('group', { name: 'Reflection activity' })).queryByText('Not complete')).not.toBeInTheDocument();
    expect(frame).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Finish' })).not.toBeInTheDocument();
    expect(requests.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'All subjects' }));
    expect(screen.getByText('2 of 3 completed')).toBeInTheDocument();
  });

  it('keeps progress unchanged on a failed submit and retries the same attempt', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('Could not save')).mockResolvedValueOnce(completeResult);
    const requests = mockMaterialRequests(activityMaterial, save);
    render(<StudentActivityPanel data={scheduledData} kind="commercial" learnerId="132" loading={false} error={null} onRetry={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: /Leadership/ }));
    selectMonthWeek();
    expect(screen.getByRole('region', { name: 'Reflection content' })).toBeVisible();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Finish' })).toBeEnabled());
    fireEvent.click(await screen.findByRole('button', { name: 'Finish' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save');
    expect(screen.getByRole('progressbar', { name: 'Subject progress' })).toHaveAttribute('aria-valuenow', '33.33');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Finish' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
    await screen.findByText('Activity completed.');
    expect(screen.getByRole('progressbar', { name: 'Subject progress' })).toHaveAttribute('aria-valuenow', '66.67');
    expect(requests.mock.calls.filter(([url, options]) => url.endsWith('/attempts/') && options?.method === 'POST')).toHaveLength(1);
  });

  it('keeps staff submission disabled without read-only messages and removes Submit for a completed activity', async () => {
    const requests = mockMaterialRequests({ ...activityMaterial, can_attempt: false });
    const { unmount } = render(<StudentMaterial kind="commercial" learnerId="132" groupId={1} activityId={11} />);
    await screen.findByTitle('Reflection frame');
    const submit = screen.getByRole('button', { name: 'Finish' });
    expect(submit).toBeDisabled();
    expect(screen.queryByText(/Viewing read-only|Only the learner can submit/)).not.toBeInTheDocument();
    expect(submit).not.toHaveAttribute('aria-describedby');
    fireEvent.click(submit);
    expect(requests.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(0);
    unmount();
    requests.mockRestore();
    mockMaterialRequests({ ...activityMaterial, completed: true });
    render(<StudentMaterial kind="commercial" learnerId="132" groupId={1} activityId={11} />);
    await screen.findByText('This activity is complete and included in your progress.');
    expect(screen.queryByRole('button', { name: 'Finish' })).not.toBeInTheDocument();
  });

  it('keeps the completion button visible with a reason when saving is unavailable', async () => {
    const requests = mockMaterialRequests({ ...activityMaterial, persistence_ready: false, can_attempt: false });
    render(<StudentMaterial kind="commercial" learnerId="132" groupId={1} activityId={11} />);
    const submit = await screen.findByRole('button', { name: 'Finish' });
    expect(submit).toBeDisabled();
    expect(submit).toHaveAccessibleDescription(/Saving progress is temporarily unavailable/);
    expect(screen.queryByText(/Viewing read-only/)).not.toBeInTheDocument();
    fireEvent.click(submit);
    expect(requests.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(0);
  });

  it('requires quiz answers and reading confirmation before saving Complete and updating progress', async () => {
    const quiz: SubjectMaterial = { ...activityMaterial, quiz: {
      id: 'q', body: '', ready: true, message: '', passing_percent: 70,
      questions: [{ id: '1', type: 'single_choice', text: 'Pick an answer', options: [{ id: 'a', text: 'Choice A' }] }],
    } };
    const requests = mockMaterialRequests(quiz, async () => ({ score_percent: 80, passed: true, completed: true }));
    render(<StudentActivityPanel data={scheduledData} kind="commercial" learnerId="132" loading={false} error={null} onRetry={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: /Leadership/ }));
    selectMonthWeek();
    expect(screen.getByRole('region', { name: 'Reflection content' })).toBeVisible();
    await waitFor(() => expect(screen.getByLabelText('Choice A')).toBeEnabled());
    const submit = await screen.findByRole('button', { name: 'Submit answers' });
    expect(submit).toBeDisabled();
    fireEvent.click(screen.getByLabelText('Choice A'));
    expect(submit).toBeDisabled();
    fireEvent.click(screen.getByLabelText('I have completed the reading material.'));
    expect(submit).toBeEnabled();
    selectMonthWeek('March 2026');
    expect(submit).not.toBeVisible();
    selectMonthWeek();
    expect(within(screen.getByRole('region', { name: 'Reflection content' })).getByLabelText('Choice A')).toBeChecked();
    expect(within(screen.getByRole('region', { name: 'Reflection content' })).getByLabelText('I have completed the reading material.')).toBeChecked();
    expect(submit).toBeVisible();
    expect(requests.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1);
    fireEvent.click(submit);
    await screen.findByText(/Attempt saved: 80%/);
    expect(within(screen.getByRole('region', { name: 'Activity completion' })).getByText('Complete')).toBeVisible();
    expect(screen.getByRole('progressbar', { name: 'Subject progress' })).toHaveAttribute('aria-valuenow', '66.67');
    const submitted = requests.mock.calls.find(([url]) => url.endsWith('/attempt-1/'))![1]!;
    expect(JSON.parse(submitted.body as string)).toEqual({ answers: { '1': ['a'] }, reading_confirmed: true, trackingToken: 'synthetic-token', timeTakenSeconds: expect.any(Number) });
  });

  it('does not increase completion when a quiz attempt fails', async () => {
    const quiz: SubjectMaterial = { ...activityMaterial, has_reading: false, quiz: {
      id: 'q', body: '', ready: true, message: '', passing_percent: 70,
      questions: [{ id: '1', type: 'single_choice', text: 'Pick an answer', options: [{ id: 'a', text: 'Choice A' }] }],
    } };
    mockMaterialRequests(quiz, async () => ({ score_percent: 0, passed: false, completed: false }));
    render(<StudentActivityPanel data={scheduledData} kind="commercial" learnerId="132" loading={false} error={null} onRetry={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: /Leadership/ }));
    selectMonthWeek();
    expect(screen.getByRole('region', { name: 'Reflection content' })).toBeVisible();
    await waitFor(() => expect(screen.getByLabelText('Choice A')).toBeEnabled());
    await waitFor(() => expect(screen.getByLabelText('Choice A')).toBeEnabled());
    fireEvent.click(screen.getByLabelText('Choice A'));
    fireEvent.click(screen.getByRole('button', { name: 'Submit answers' }));
    await screen.findByText(/Attempt saved: 0%/);
    expect(screen.getByRole('progressbar', { name: 'Subject progress' })).toHaveAttribute('aria-valuenow', '33.33');
  });
});
