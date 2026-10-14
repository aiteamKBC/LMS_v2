import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CaseFileOverviewTab } from '@/pages/coach/learner-case-file/tabs/CaseFileOverviewTab';
import { clearCaseFileCache, readCaseFileCache } from './cache/caseFileCache';
import type { CaseFileOverview } from './hooks/useCaseFileOverview';
import { moduleOverviewFixture } from './caseFileOverview.fixture';
import { MemoryRouter } from 'react-router-dom';
import { TrainingPlanDetails } from '@/pages/learner/training-plan-timeline/TrainingPlanDetails';
import { buildUnifiedLearningSummary } from '@/pages/learner/my-learning/learningSummary';
import type { TrainingPlanDashboard } from '@/api/trainingPlanDashboard';

const mocks = vi.hoisted(() => ({ state: {} as { data?: CaseFileOverview; error?: string }, transport: vi.fn(), retry: vi.fn() }));
vi.mock('./hooks/useCaseFileOverview', () => ({ useCaseFileOverview: () => ({ ...mocks.state, retry: mocks.retry }) }));
vi.mock('@/lib/coachFetch', () => ({ coachFetch: mocks.transport }));
vi.mock('@/pages/coach/caseload/lib/format', () => ({ otjhProgressAsOfToday: () => { throw new Error('Overview must not pace hours in React'); } }));

const response: CaseFileOverview = {
  wholeProgrammeProgress: {
    overall: { completed: 3, total: 4, percent: 75 },
    attendance: { present: 1, sessions: 2, percent: 49.12 },
    otjh: { actual: 12, targetToDate: 25, planned: 100, percent: 47.13 },
    ksb: { completed: 1, total: 3, percent: 33.33 },
  },
  programmeProgress: [{ id: 'current:M1', title: 'Synthetic module', percent: 76.54 }],
  moduleOverview: moduleOverviewFixture,
};
const stale = { overall: 1, activitiesCompleted: 1, activitiesTotal: 100, activitiesPercent: 1,
  otjhActual: 999, otjhTarget: 1000, ksb: 2, ksbAvailable: false, attendancePresent: 99, attendanceTotal: 100 };

beforeEach(() => {
  clearCaseFileCache();
  mocks.state = { data: response };
  mocks.retry.mockReset();
  mocks.transport.mockReset().mockResolvedValue(new Response(JSON.stringify(response)));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('renders learner module rings and counts while preserving the programme row percentage', () => {
  render(<CaseFileOverviewTab snapshot={stale} hasActivitySnapshot />);
  const chart = within(screen.getByRole('region', { name: 'Module progress' }));
  for (const name of ['Attendance: 0%', 'Activities: 35.09%', 'Hours: 5.9%', 'KSBs: 100%']) {
    expect(chart.getByRole('img', { name })).toBeInTheDocument();
  }
  for (const count of ['0 / 12', '20 / 57', '4.9 / 83', '15 / 15']) expect(chart.getByText(count)).toBeInTheDocument();
  expect(screen.queryByRole('region', { name: 'Whole programme progress' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Synthetic module: 76.54% overall progress' })).toBeInTheDocument();
  expect(screen.queryByText('999 / 1,000 hours')).not.toBeInTheDocument();
});

it('switches all four measures by module id, including modules absent from the programme rows', () => {
  render(<CaseFileOverviewTab snapshot={stale} />);
  fireEvent.change(screen.getByRole('combobox', { name: 'Select module' }), { target: { value: 'current:M2' } });
  for (const name of ['Attendance: 50%', 'Activities: 25%', 'Hours: 35%', 'KSBs: 60%']) {
    expect(screen.getByRole('img', { name })).toBeInTheDocument();
  }
  expect(screen.getByText('3.5 / 10')).toBeInTheDocument();
  expect(screen.queryByText('4.9 / 83')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Synthetic module: 76.54% overall progress' }));
  expect(screen.getByRole('combobox')).toHaveValue('current:M1');
  expect(screen.getByText('4.9 / 83')).toBeInTheDocument();
});

it('keeps unavailable module measures distinct from zero and handles an empty plan', () => {
  mocks.state = { data: { ...response, moduleOverview: { ...moduleOverviewFixture, moduleProgress: undefined } } };
  const { rerender } = render(<CaseFileOverviewTab snapshot={stale} />);
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'current:M2' } });
  for (const name of ['Attendance: N/A', 'Hours: N/A', 'KSBs: N/A']) expect(screen.getByRole('img', { name })).toBeInTheDocument();
  mocks.state = { data: { ...response, moduleOverview: { ...moduleOverviewFixture, modules: [],
    learning: { detail: { modules: [], components: [], quizAttempts: [] }, activity: null, metadata: { covers: {} } },
  } } };
  rerender(<CaseFileOverviewTab snapshot={stale} />);
  expect(screen.getByRole('combobox')).toBeDisabled();
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
});

it('matches the learner picker and every ring for historical, current and empty modules', () => {
  const overview = structuredClone(moduleOverviewFixture);
  overview.learning.activity = {
    progress_basis: 'catalogue_activities',
    subjects: [{ id: 50, name: 'Historical safeguarding' }, { id: 51, name: 'Historical planning' }],
    activities: [50, 51].map(groupId => ({
      activity_id: `material:${groupId}`, source_activity_id: groupId, group_id: groupId, group_name: null,
      activity: 'Historical lesson', category: 'reading', completed: groupId === 50,
      date: null, status: null, actual: 0, planned: 0, planned_hours_mapped: false, hours_mapped: false,
      quiz_score: null, quiz_maximum_score: null,
    })),
  };
  overview.learning.metadata.current_subjects = [{ id: 'M3', title: 'Empty assigned module' }];
  overview.learning.detail.components.push(overview.learning.detail.components[0]);
  overview.learning.detail.retiredQuizComponents = [{
    moduleId: 'M1', module: 'Synthetic module', week: 'Week 1', component: 'Retained quiz',
    componentId: 'Q1', expectedOtjh: null, isQuiz: true,
    quizMeta: { quizId: 7, questions: null, duration: null, timeUnit: null },
  }];
  overview.learning.detail.quizAttempts = [true, false].map(passed => ({
    quizId: 7, passed, grade: passed ? 1 : 0, startedAt: '', submittedAt: '',
  }));
  const data: TrainingPlanDashboard = {
    ...overview, months: {}, contractStatus: 'not-available', reviews: [], coach: { name: '', bookingUrl: null }, generatedAt: '',
    modules: overview.modules.map(module => ({ ...module, description: '', tutor_name: '', coach_name: '' })),
    sessions: overview.sessions.map(session => ({ ...session, joinUrl: null })),
  };
  const learning = overview.learning;
  const subjects = buildUnifiedLearningSummary(learning.activity, learning.detail, learning.metadata).subjects;
  render(<MemoryRouter><TrainingPlanDetails subjects={subjects} data={data} kind="commercial" learnerId="201"
    onRefresh={() => {}} onRetryContract={() => {}} cardsOnly overviewOnly showOtjChart={false} /></MemoryRouter>);
  const options = () => within(screen.getByRole('combobox', { name: 'Select module' })).getAllByRole('option')
    .map(option => ({ value: (option as HTMLOptionElement).value, title: option.textContent }));
  const learnerOptions = options();
  expect(learnerOptions.map(option => option.title)).toEqual([
    'Synthetic module', 'Second module', 'Empty assigned module', 'Historical planning', 'Historical safeguarding',
  ]);
  const rings = () => within(screen.getByRole('region', { name: 'Module progress' })).getAllByRole('img')
    .map(img => ({ name: img.getAttribute('aria-label'), text: img.parentElement?.textContent }));
  const learnerRings = learnerOptions.map(option => {
    fireEvent.change(screen.getByRole('combobox', { name: 'Select module' }), { target: { value: option.value } });
    return rings();
  });
  cleanup();
  mocks.state = { data: { ...response, moduleOverview: overview } };
  render(<CaseFileOverviewTab snapshot={stale} />);
  expect(options()).toEqual(learnerOptions);
  learnerOptions.forEach((option, index) => {
    fireEvent.change(screen.getByRole('combobox', { name: 'Select module' }), { target: { value: option.value } });
    expect(rings()).toEqual(learnerRings[index]);
  });
  fireEvent.change(screen.getByRole('combobox', { name: 'Select module' }), { target: { value: 'current:M1' } });
  expect(screen.getByText('21 / 58')).toBeInTheDocument();
});

it('shows loading and retryable errors without displaying stale module values', () => {
  mocks.state = {};
  const { rerender } = render(<CaseFileOverviewTab snapshot={stale} />);
  expect(screen.getByRole('status', { name: 'Loading overview' })).toBeInTheDocument();
  mocks.state = { error: 'Module source unavailable' };
  rerender(<CaseFileOverviewTab snapshot={stale} />);
  expect(screen.getByRole('alert')).toHaveTextContent('Module source unavailable');
  fireEvent.click(screen.getByRole('button', { name: 'Retry overview' }));
  expect(mocks.retry).toHaveBeenCalledOnce();
});

it('shares pending requests, hits immediate revisits and refreshes Overview after 60 seconds', async () => {
  let now = 1000;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  const read = () => readCaseFileCache('coach-A', '101', 'overview', '/overview');
  await Promise.all([read(), read()]);
  now += 59_999;
  await read();
  expect(mocks.transport).toHaveBeenCalledTimes(1);
  now += 1;
  mocks.transport.mockResolvedValue(new Response(JSON.stringify(response)));
  await read();
  expect(mocks.transport).toHaveBeenCalledTimes(2);
});

it('keeps stable tabs cached and separates coaches and learners', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(1000);
  mocks.transport.mockImplementation(async () => new Response('{}'));
  await readCaseFileCache('coach-A', '101', 'profile', '/profile');
  vi.spyOn(Date, 'now').mockReturnValue(100_000);
  await readCaseFileCache('coach-A', '101', 'profile', '/profile');
  expect(mocks.transport).toHaveBeenCalledTimes(1);
  await readCaseFileCache('coach-B', '101', 'overview', '/overview');
  await readCaseFileCache('coach-A', '102', 'overview', '/overview');
  expect(mocks.transport).toHaveBeenCalledTimes(3);
});
