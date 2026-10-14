import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CaseFileOverviewTab } from '@/pages/coach/learner-case-file/tabs/CaseFileOverviewTab';
import { CaseFileContext, type CaseFileSession } from './hooks/caseFileSessionContext';
import { caseFileSectionRead } from './api/caseFileApi';
import { clearCaseFileCache } from './cache/caseFileCache';
import type { CaseFileOverview, ModuleOverviewIndex } from './hooks/useCaseFileOverview';
import { moduleOverviewFixture } from './caseFileOverview.fixture';
import { buildUnifiedLearningSummary } from '@/pages/learner/my-learning/learningSummary';

const transport = vi.hoisted(() => vi.fn());
vi.mock('@/lib/coachFetch', () => ({ coachFetch: transport }));
const index: ModuleOverviewIndex = {
  modules: moduleOverviewFixture.modules, moduleLinks: {},
  subjects: [{ id: 'current:M1', title: 'Synthetic module', completed: 20, total: 57 },
    { id: 'current:M2', title: 'Second module', completed: 1, total: 4 }]
    .map(row => ({ ...row, source: 'current', moduleIds: [], dates: [], sessionTitles: [] })),
};
const overview: CaseFileOverview = {
  wholeProgrammeProgress: { overall: { completed: 21, total: 61, percent: 34.43 },
    attendance: { present: 2, sessions: 16, percent: 12.5 },
    otjh: { actual: 8.4, planned: 93, targetToDate: 50, percent: 16.8 },
    ksb: { completed: 18, total: 20, percent: 90 } },
  programmeProgress: [{ id: 'current:M1', title: 'Synthetic module', percent: 35.09 },
    { id: 'current:M2', title: 'Second module', percent: 25 }],
  moduleIndex: index,
};
const snapshot = { overall: 0, otjhActual: 0, otjhTarget: 0, ksb: null, attendancePresent: 0, attendanceTotal: 0 };
const measures = (id: string) => ({ id, actual: [], actualAvailable: true,
  moduleProgress: { [id.slice(8)]: moduleOverviewFixture.moduleProgress![id.slice(8)] } });
const session = (learnerId = '101', coach = 'coach-A'): CaseFileSession => ({
  learnerId, detail: vi.fn(),
  read: (section, params, options) => caseFileSectionRead(coach, learnerId, section, params, options),
});
const moduleFrom = (url: string) => new URL(url, 'https://example.test').searchParams.get('moduleId');
const renderPage = (value = session()) => render(<CaseFileContext.Provider value={value}>
  <CaseFileOverviewTab snapshot={snapshot} />
</CaseFileContext.Provider>);

beforeEach(() => {
  clearCaseFileCache();
  transport.mockReset().mockImplementation(async (url: string) => new Response(JSON.stringify(
    moduleFrom(url) ? measures(moduleFrom(url)!) : overview)));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('loads the compact index once, requests only the selected module, and caches each selection', async () => {
  renderPage();
  expect(await screen.findByRole('img', { name: 'Hours: 5.9%' })).toBeInTheDocument();
  expect(transport.mock.calls.map(([url]) => moduleFrom(url))).toEqual([null, 'current:M1']);
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'current:M2' } });
  expect(screen.queryByRole('img', { name: 'Hours: 5.9%' })).not.toBeInTheDocument();
  expect(await screen.findByRole('img', { name: 'Hours: 35%' })).toBeInTheDocument();
  expect(screen.getByRole('img', { name: 'Activities: 25%' })).toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'Programme module progress' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Synthetic module: 35.09% overall progress' }));
  expect(await screen.findByRole('img', { name: 'Hours: 5.9%' })).toBeInTheDocument();
  expect(transport.mock.calls.map(([url]) => moduleFrom(url))).toEqual([null, 'current:M1', 'current:M2']);
});

it('ignores a late module response after selection changes', async () => {
  let finish!: (response: Response) => void;
  transport.mockImplementation((url: string) => moduleFrom(url) === 'current:M1'
    ? new Promise<Response>(resolve => { finish = resolve; })
    : Promise.resolve(new Response(JSON.stringify(moduleFrom(url) ? measures('current:M2') : overview))));
  renderPage();
  await screen.findByRole('status', { name: 'Loading module progress' });
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'current:M2' } });
  await screen.findByRole('img', { name: 'Hours: 35%' });
  await act(async () => finish(new Response(JSON.stringify(measures('current:M1')))));
  expect(screen.getByRole('combobox')).toHaveValue('current:M2');
  expect(screen.queryByRole('img', { name: 'Hours: 5.9%' })).not.toBeInTheDocument();
});

it('retries only the failed module while the programme and picker remain available', async () => {
  transport.mockImplementation(async (url: string) => new Response(JSON.stringify(moduleFrom(url)
    ? { detail: 'Module temporarily unavailable' } : overview), { status: moduleFrom(url) ? 503 : 200 }));
  renderPage();
  expect(await screen.findByRole('alert')).toHaveTextContent('Module temporarily unavailable');
  expect(screen.getByRole('combobox')).not.toBeDisabled();
  expect(screen.getByRole('button', { name: 'Second module: 25% overall progress' })).toBeInTheDocument();
  expect(screen.queryByRole('img', { name: /^Hours:/ })).not.toBeInTheDocument();
  transport.mockImplementation(async (url: string) => new Response(JSON.stringify(measures(moduleFrom(url)!))));
  fireEvent.click(screen.getByRole('button', { name: 'Retry module' }));
  await screen.findByRole('img', { name: 'Hours: 5.9%' });
  expect(transport.mock.calls.filter(([url]) => !moduleFrom(url))).toHaveLength(1);
});

it('does not request a module for an empty plan', async () => {
  transport.mockResolvedValue(new Response(JSON.stringify({ ...overview, programmeProgress: [],
    moduleIndex: { ...index, modules: [], subjects: [] } })));
  renderPage();
  expect(await screen.findByRole('combobox')).toBeDisabled();
  expect(transport).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
});

it('separates module cache entries by coach and learner and forwards the selection parameter', async () => {
  for (const [coach, learner] of [['coach-A', '101'], ['coach-B', '101'], ['coach-A', '102']]) {
    await caseFileSectionRead(coach, learner, 'overview', { moduleId: 'current:M1' });
  }
  expect(transport).toHaveBeenCalledTimes(3);
  expect(transport.mock.calls.every(([url]) => moduleFrom(url) === 'current:M1')).toBe(true);
  await caseFileSectionRead('coach-A', '101', 'overview', { moduleId: 'current:M1' });
  expect(transport).toHaveBeenCalledTimes(3);
});

it('preserves the learner activity counts supplied by the canonical index', async () => {
  const learning = moduleOverviewFixture.learning;
  const subjects = buildUnifiedLearningSummary(learning.activity, learning.detail, learning.metadata).subjects;
  expect(index.subjects.map(row => [row.id, row.completed, row.total]).sort()).toEqual(subjects.map(row =>
    [row.id, row.activities.filter(activity => activity.completed).length, row.activities.length]).sort());
  renderPage();
  await screen.findByRole('img', { name: 'Activities: 35.09%' });
  expect(within(screen.getByRole('region', { name: 'Module progress' })).getByText('20 / 57')).toBeInTheDocument();
});

it('rejects a mismatched module response without displaying its values', async () => {
  transport.mockImplementation(async (url: string) => new Response(JSON.stringify(moduleFrom(url) ? measures('current:M2') : overview)));
  renderPage();
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('did not match the selected module'));
  expect(screen.queryByRole('img', { name: /^Hours:/ })).not.toBeInTheDocument();
});

it('clears module values immediately when the learner session changes', async () => {
  const { rerender } = renderPage();
  await screen.findByRole('img', { name: 'Hours: 5.9%' });
  let finish!: (response: Response) => void;
  transport.mockImplementation((url: string) => !moduleFrom(url)
    ? new Promise<Response>(resolve => { finish = resolve; })
    : Promise.resolve(new Response(JSON.stringify(measures(moduleFrom(url)!)))));
  rerender(<CaseFileContext.Provider value={session('102')}><CaseFileOverviewTab snapshot={snapshot} /></CaseFileContext.Provider>);
  expect(screen.getByRole('status', { name: 'Loading overview' })).toBeInTheDocument();
  expect(screen.queryByRole('img', { name: /^Hours:/ })).not.toBeInTheDocument();
  await act(async () => finish(new Response(JSON.stringify({ ...overview, moduleIndex: { ...index, subjects: [] } }))));
  expect(screen.getByRole('combobox')).toBeDisabled();
  expect(transport.mock.calls.filter(([url]) => url.includes('/102/') && moduleFrom(url))).toHaveLength(0);
});
