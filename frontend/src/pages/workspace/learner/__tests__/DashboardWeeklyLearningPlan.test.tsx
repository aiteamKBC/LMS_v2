import { weeklyContractFixture } from '@/test/weeklyContractFixture';
import { act as reactAct, cleanup, fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LearnerComponentEntry, LearnerDetail } from '@/api/learnerDetail';
import type { TrainingPlanDashboard } from '@/api/trainingPlanDashboard';
import type { WeeklyLearningDetail } from '@/api/weeklyLearning';
import { adaptWeeklyLearning, primeWeeklyLearningWeek } from '@/api/weeklyLearning';
import { clearAllCachedResources } from '@/api/cachedRequest';
import { hasComponentContent } from '@/utils/learnerJourney';
import { DashboardWeeklyLearningPlan, WeeklyLearningPlan } from '../WeeklyLearningPlan';

const reads = vi.hoisted(() => ({
  detail: null as unknown, weekly: null as unknown,
  detailCalls: 0, weeklyCalls: 0,
}));

vi.mock('@/hooks/useLearnerDetailParam', () => ({
  useLearnerDetailParam: () => { reads.detailCalls += 1; return { real: reads.detail, loading: false, loadError: null, refresh: vi.fn() }; },
}));
vi.mock('@/hooks/useWeeklyLearning', async importOriginal => ({
  ...await importOriginal<typeof import('@/hooks/useWeeklyLearning')>(),
  useWeeklyLearning: () => { reads.weeklyCalls += 1; return { real: reads.weekly, loading: false, loadError: null, refresh: vi.fn() }; },
}));

const ksb = (code: string) => ({ code, description: `${code} long description`, classification: 'main', weight: 1 });
const row = (moduleId: string, weekId: string, componentId: string, extra: Partial<LearnerComponentEntry>): LearnerComponentEntry => ({
  module: moduleId === 'M1' ? 'Marketing' : 'Finance', week: weekId, component: componentId, expectedOtjh: null,
  moduleId, weekId, componentId, ...extra,
});

/** A full learner-detail payload covering each activity type, state and link rule. */
const full: LearnerDetail = {
  id: '125', name: 'Example learner', email: 'learner@example.test', phone: '', programme: 'MBA', programmeStatus: 'Active',
  cohort: 'C1', group: 'G1', employer: '', organization: '', isActive: true,
  modules: ['Marketing', 'Finance'], week: [],
  components: [
    row('M1', 'W1', 'QUIZ-PASSED', { component: 'Quiz passed', type: 'quiz', isQuiz: true,
      quizMeta: { quizId: 11, questions: 5, duration: 90, timeUnit: 'mins' }, ksbMappings: [ksb('K1'), ksb('S2'), ksb('B3')] }),
    row('M1', 'W1', 'QUIZ-FAILED', { component: 'Quiz retake', type: 'quiz', isQuiz: true,
      quizMeta: { quizId: 12, questions: 5, duration: 2, timeUnit: 'hours' } }),
    row('M1', 'W1', 'VIDEO', { component: 'Watch the intro', type: 'video', videoUrl: 'https://example.test/v', durationMinutes: 12.5,
      expectedOtjh: 0.25, description: '<p>Long description</p>'.repeat(50) }),
    row('M1', 'W1', 'READING', { component: 'Read chapter', type: 'reading', hasReadingContent: true, expectedOtjh: 1.5 }),
    row('M1', 'W1', 'EMPTY', { component: 'Empty placeholder', type: 'activity', description: '<p>&nbsp;</p>' }),
    row('M1', 'W1', 'ASSIGN', { component: 'Write the report', type: 'assignment', assignmentTopics: [], ksbMappings: [ksb('K1')] }),
    row('M1', 'W1', 'REFLECT', { component: 'Reflect', type: 'reflection' }),
    row('M1', 'W1', 'REFLECT-2', { component: 'Reflect again', type: 'reflection' }),
    row('M1', 'W1', 'REFLECT-3', { component: 'Reflect once more', type: 'reflection' }),
    row('M1', 'W2', 'LIVE', { component: 'Live lecture', type: 'live_session', sessionDate: '2026-09-14' }),
    row('M1', 'W2', 'PODCAST', { component: 'Listen', type: 'podcast', description: 'Show notes' }),
    row('M2', 'W9', 'SLIDES', { component: 'Deck', type: 'powerpoint', resourceUrl: '/files/deck.pptx', expectedOtjh: 2 }),
  ],
  quizAttempts: [
    { quizId: 11, componentId: 'QUIZ-PASSED', passed: true, grade: 1, startedAt: '', submittedAt: '' },
    { quizId: 12, componentId: 'QUIZ-FAILED', passed: false, grade: 0.2, startedAt: '', submittedAt: '' },
  ],
  videoProgress: [{ kind: 'video', componentId: 'VIDEO', passed: null, startedAt: null, submittedAt: '', timeTaken: null }],
  componentProgress: [
    { kind: 'component', componentType: 'reading', componentId: 'READING', passed: false, startedAt: null, submittedAt: '', timeTaken: null },
    { kind: 'component', componentType: 'podcast', componentId: 'PODCAST', passed: null, startedAt: null, submittedAt: '', timeTaken: null },
  ],
} as unknown as LearnerDetail;

/** The server's projection (weekly_learning._weekly_component), applied to the same rows. */
function compact(detail: LearnerDetail): WeeklyLearningDetail {
  return {
    id: detail.id, programme: detail.programme, cohort: detail.cohort, group: detail.group,
    modules: detail.modules,
    week: detail.week.map(({ module, week, moduleId, weekId }) => ({ module, week, moduleId, weekId })),
    components: detail.components.map(c => {
      const projected: LearnerComponentEntry = {
        module: c.module, week: c.week, component: c.component, expectedOtjh: c.expectedOtjh,
        componentId: c.componentId, moduleId: c.moduleId, weekId: c.weekId, type: c.type, isQuiz: !!c.isQuiz,
        quizMeta: c.quizMeta, durationMinutes: c.durationMinutes,
        ksbMappings: (c.ksbMappings || []).map(m => ({ code: m.code, description: null, classification: m.classification, weight: m.weight })),
        videoUrl: c.videoUrl, contentAvailable: hasComponentContent({ ...c, title: c.component }),
        ...((c.type || '').trim().toLowerCase().replace(/[\s-]+/g, '_') === 'live_session'
          ? { sessionDate: c.sessionDate, sessionDateTimeUtc: c.sessionDateTimeUtc } : {}),
      };
      return Object.fromEntries(Object.entries(projected).filter(([key, value]) =>
        value !== undefined && (value !== null || ['module', 'week', 'component', 'expectedOtjh'].includes(key)))) as unknown as LearnerComponentEntry;
    }),
    quizAttempts: detail.quizAttempts,
    videoProgress: (detail.videoProgress || []).map(({ kind, componentId, passed }) => ({ kind, componentId, passed })),
    componentProgress: (detail.componentProgress || []).map(({ kind, componentId, passed }) => ({ kind, componentId, passed })),
  };
}

const slot = (slotNumber: number, date: string, weekId: string, weekTitle: string) => ({
  slotNumber, date, day: 'Monday', type: 'live-session', sessionNumber: slotNumber, holidays: [], weekId, weekTitle,
});
const schedule = {
  modules: [
    { id: 'M1', title: 'Marketing', description: '', start_date: '2026-09-07', end_date: '2026-09-20', tutor_name: '', coach_name: '',
      programme_name: 'MBA', cohort_name: 'C1', group_name: 'G1',
      curriculumSlots: [slot(1, '2026-09-07', 'W1', 'Plan week 1'), slot(2, '2026-09-14', 'W2', 'Plan week 2')] },
    { id: 'M2', title: 'Finance', description: '', start_date: '2026-10-05', end_date: '2026-10-11', tutor_name: '', coach_name: '',
      programme_name: 'MBA', cohort_name: 'C1', group_name: 'G1', curriculumSlots: [slot(1, '2026-10-05', 'W9', 'Finance week')] },
  ],
  moduleLinks: {},
  moduleActivityHours: { M1: { components: { VIDEO: 0.2, READING: 1 }, quizzes: { 11: 1.5 } } },
  sessions: [{ id: 'S1', moduleId: 'M1', title: 'Live lecture', start: '2026-09-07T09:00:00Z', end: '2026-09-07T10:00:00Z',
    minutes: 60, status: 'scheduled', joinUrl: 'https://teams.microsoft.com/l/meetup-join/example', attended: true }],
} as unknown as TrainingPlanDashboard;

function renderBoth() {
  reads.detail = full;
  const source = { ...compact(full), schedule };
  for (const module of schedule.modules) for (const slot of module.curriculumSlots ?? []) {
    const response = weeklyContractFixture({ ...source, selectedWeekId: `slot:${module.id}:${slot.slotNumber}` });
    primeWeeklyLearningWeek('commercial', '125', adaptWeeklyLearning(response, '125'));
  }
  reads.weekly = adaptWeeklyLearning(weeklyContractFixture(source), '125');
  const before = render(<MemoryRouter><WeeklyLearningPlan kind="commercial" learnerId="125" schedule={schedule} scheduleLoading={false} /></MemoryRouter>);
  const after = render(<MemoryRouter><DashboardWeeklyLearningPlan kind="commercial" learnerId="125" schedule={schedule} scheduleLoading={false} /></MemoryRouter>);
  return { before: before.container, after: after.container };
}

/** Normalize React IDs and the existing lazy cache's unstyled visibility wrapper.
 * Every rendered class, attribute, text node, link and control still compares.
 */
const markup = (container: HTMLElement) => {
  const clone = container.cloneNode(true) as HTMLElement;
  const wrapper = clone.querySelector('section[aria-labelledby="weekly-activities-heading"] > div > div:not([class])');
  if (wrapper && !wrapper.hasAttribute('hidden')) wrapper.replaceWith(...wrapper.childNodes);
  return clone.innerHTML.replace(/_r_[0-9a-z]+_/g, 'id');
};

function act(container: HTMLElement, step: (scope: ReturnType<typeof within>) => void) { step(within(container)); }

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-08T12:00:00Z'));
  reads.detailCalls = 0;
  reads.weeklyCalls = 0;
});
afterEach(() => { cleanup(); clearAllCachedResources(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('Dashboard Weekly Learning compact read', () => {
  it('loads only one selected week and preserves search while switching and revisiting', async () => {
    const source = compact(full);
    const activities = (week: string) => source.components.filter(c => c.weekId === week).map(c =>
      Object.fromEntries(Object.entries(c).filter(([key]) => !['module', 'week', 'moduleId', 'weekId'].includes(key))));
    reads.weekly = { ...source, schedule, selectedModuleId: 'M1', selectedWeekId: 'slot:M1:1',
      components: activities('W1'),
      weekSummaries: [{ moduleId: 'M1', weekId: 'W1', slotNumber: 1, progress: { total: 9, completed: 1, percent: 100 / 9 } },
        { moduleId: 'M1', weekId: 'W2', slotNumber: 2, progress: { total: 2, completed: 1, percent: 50 } }] };
    delete (reads.weekly as WeeklyLearningDetail).modules;
    delete (reads.weekly as WeeklyLearningDetail).week;
    primeWeeklyLearningWeek('commercial', '125', reads.weekly as WeeklyLearningDetail);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(weeklyContractFixture({ weekId: 'slot:M1:2', moduleId: 'M1',
      components: activities('W2'), quizAttempts: source.quizAttempts,
      videoProgress: source.videoProgress, componentProgress: source.componentProgress, schedule: { sessions: [] } })))));
    const view = render(<MemoryRouter><DashboardWeeklyLearningPlan kind="commercial" learnerId="125" schedule={null} scheduleLoading={false} /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('Quiz passed')).toBeInTheDocument());
    expect(fetch).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('textbox', { name: 'Search activities' }), { target: { value: 'Listen' } });
    fireEvent.click(screen.getByRole('button', { name: /Plan week 2/ }));
    await waitFor(() => expect(screen.getByText('Listen')).toBeInTheDocument());
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('textbox', { name: 'Search activities' })).toHaveValue('Listen');
    fireEvent.click(screen.getByRole('button', { name: /Plan week 1/ }));
    fireEvent.click(screen.getByRole('button', { name: /Plan week 2/ }));
    expect(screen.getByText('Listen')).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(1);
    reads.weekly = { ...(reads.weekly as WeeklyLearningDetail), id: '126' };
    primeWeeklyLearningWeek('commercial', '126', reads.weekly as WeeklyLearningDetail);
    view.rerender(<MemoryRouter><DashboardWeeklyLearningPlan kind="commercial" learnerId="126" schedule={null} scheduleLoading={false} /></MemoryRouter>);
    expect(screen.getByRole('textbox', { name: 'Search activities' })).toHaveValue('');
    expect(screen.getByText('Quiz passed')).toBeInTheDocument();
    expect(screen.queryByText('Listen')).not.toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('renders exactly what the learner-detail panel renders for the current week', async () => {
    const { before, after } = renderBoth();
    await reactAct(async () => {});
    expect(markup(after)).toBe(markup(before));
    const table = within(after).getByRole('table');
    expect(within(table).getByText('Quiz passed').closest('tr')).toHaveTextContent('Completed');
    expect(within(table).getByText('Quiz retake').closest('tr')).toHaveTextContent('In progress');
    expect(within(table).getByText('Read chapter').closest('tr')).toHaveTextContent('Not started');
    expect(within(table).getByText('Empty placeholder').closest('tr')).toHaveTextContent('Not available');
    expect(within(table).getByText('Quiz passed').closest('tr')!.querySelector('a'))
      .toHaveAttribute('href', '/learner/quiz/commercial/125/11?week=Plan%20week%201');
    expect(within(table).getByText('Watch the intro').closest('tr')!.querySelector('a'))
      .toHaveAttribute('href', '/learner/video/commercial/125/VIDEO?week=Plan%20week%201');
    expect(within(table).getByText('Write the report').closest('tr')!.querySelector('a'))
      .toHaveAttribute('href', '/learner/component/commercial/125/ASSIGN?week=Plan%20week%201');
  });

  it('stays identical through week selection, filtering, paging and module switching', async () => {
    const { before, after } = renderBoth();
    await reactAct(async () => {});
    const steps: ((scope: ReturnType<typeof within>) => void)[] = [
      scope => fireEvent.click(scope.getByRole('button', { name: /Plan week 2/ })),
      scope => fireEvent.click(scope.getByRole('button', { name: /Plan week 1/ })),
      scope => fireEvent.change(scope.getByRole('combobox', { name: 'Filter activities by status' }), { target: { value: 'completed' } }),
      scope => fireEvent.change(scope.getByRole('combobox', { name: 'Filter activities by status' }), { target: { value: 'all' } }),
      scope => fireEvent.click(scope.getByRole('button', { name: 'Next activities page' })),
      scope => fireEvent.change(scope.getByRole('combobox', { name: 'Module' }), { target: { value: 'M2' } }),
    ];
    for (const step of steps) {
      await reactAct(async () => { act(before, step); act(after, step); });
      expect(markup(after)).toBe(markup(before));
    }
    expect(within(after).getByText('Deck')).toBeInTheDocument();
  });

  it('reads only the compact source on the Dashboard', () => {
    reads.weekly = { ...compact(full), schedule };
    render(<MemoryRouter><DashboardWeeklyLearningPlan kind="commercial" learnerId="125" schedule={schedule} scheduleLoading={false} /></MemoryRouter>);
    expect(reads.weeklyCalls).toBeGreaterThan(0);
    expect(reads.detailCalls).toBe(0);
    expect(screen.getByRole('table')).toBeInTheDocument();
  });

  it('drops descriptions and KSB text from the compact payload', () => {
    const payload = JSON.stringify(weeklyContractFixture({ ...compact(full), schedule }));
    expect(payload).not.toContain('Long description');
    expect(payload).not.toContain('long description');
    expect(payload.length).toBeLessThan(JSON.stringify(full).length);
  });
});
