import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CaseFileSessionProvider } from './hooks/CaseFileSessionProvider';
import { CaseFileWeeklyLearningTab } from '@/pages/coach/learner-case-file/tabs/CaseFileWeeklyLearningTab';
import { clearCaseFileCache } from './cache/caseFileCache';
import { caseFileSectionRead } from './api/caseFileApi';
import type { WeeklyLearningResponse } from './hooks/useCaseFileWeeklyLearning';

const transport = vi.hoisted(() => vi.fn());
vi.mock('@/lib/coachFetch', () => ({ coachFetch: transport }));
vi.mock('@/hooks/useCoachViewAs', () => ({ useCoachViewAs: () => null }));
const weeks = [1, 2, 3].map(number => ({ id: `M1:${number}`, moduleId: 'M1', moduleTitle: 'Synthetic module',
  weekId: `W${number}`, weekNumber: number, slotNumber: number, title: `Week ${number}`, startDate: `2026-10-${number === 1 ? '05' : '12'}`,
  endDate: `2026-10-${number === 1 ? '11' : '18'}`, status: number === 1 ? 'current' as const : 'upcoming' as const,
  progress: 50, kind: 'live-session' as const, attended: null, sessionState: 'upcoming' as const, holidayNote: '', holidays: [] }));
const payload = (id = 'M1:1'): WeeklyLearningResponse => ({ weeks, selectedWeek: { ...weeks.find(week => week.id === id)!,
  summary: { completedActivities: 1, totalActivities: 2, progress: 50, ksbCount: 2, achievedKsbCount: 1, otjhHours: 1, plannedOtjhHours: 2, untimedActivities: 0 },
  liveSession: { id: `session-${id}`, title: `Live ${id}`, date: '2026-10-05', startTime: '09:00', endTime: '11:00', start: '2026-10-05T08:00:00Z', durationMinutes: 120, status: 'scheduled', attended: null, joinUrl: 'https://example.test/teams' },
  activities: [{ id: `reading-${id}`, title: `Reading ${id}`, type: 'reading', completed: true, isQuiz: false, status: 'completed', expectedHours: 1, durationMinutes: 60, quizDuration: null, quizTimeUnit: null, ksbCodes: ['K1'] },
    { id: `quiz-${id}`, title: `Quiz ${id}`, type: 'quiz', completed: false, isQuiz: true, status: 'in-progress', expectedHours: 1, durationMinutes: null, quizDuration: 60, quizTimeUnit: 'mins', ksbCodes: ['S1'] }] } });
beforeEach(() => {
  clearCaseFileCache();
  transport.mockReset().mockImplementation(async (url: string) => new Response(JSON.stringify(payload(new URL(url, 'https://example.test').searchParams.get('week') || undefined))));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it.each(['commercial', 'apprenticeship'] as const)('prefetches only adjacent weeks for %s and renders cached navigation immediately', async kind => {
  let resolveInitial!: (response: Response) => void;
  transport.mockImplementationOnce(() => new Promise<Response>(resolve => { resolveInitial = resolve; }));
  render(<StrictMode><MemoryRouter><CaseFileSessionProvider learnerId="101" coach="coach@example.test">
    <CaseFileWeeklyLearningTab kind={kind} learnerId="201" />
  </CaseFileSessionProvider></MemoryRouter></StrictMode>);
  // No prefetch until the initial selected-week request succeeds.
  expect(transport.mock.calls.map(call => call[0])).toEqual(['/coach_api/coach/case-file/101/weekly-learning']);
  await act(async () => resolveInitial(new Response(JSON.stringify(payload()))));
  await screen.findByText('Reading M1:1');
  await waitFor(() => expect(transport).toHaveBeenCalledTimes(2));
  await act(async () => {});
  expect(transport.mock.calls[1][0]).toBe('/coach_api/coach/case-file/101/weekly-learning?week=M1%3A2');
  expect(within(screen.getByRole('table')).getByText('In progress')).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: /Start|Continue|Join/ })).not.toBeInTheDocument();
  const nextRequests = () => transport.mock.calls.filter(call => String(call[0]).includes('week=M1%3A2'));
  fireEvent.click(screen.getByRole('button', { name: /Week 2/ }));
  expect(screen.getByText('Reading M1:2')).toBeInTheDocument();
  expect(screen.queryByText(/Loading this week/)).not.toBeInTheDocument();
  expect(nextRequests()).toHaveLength(1);
  await waitFor(() => expect(transport).toHaveBeenCalledTimes(3));
  expect(transport.mock.calls[2][0]).toBe('/coach_api/coach/case-file/101/weekly-learning?week=M1%3A3');
  await act(async () => {});
  fireEvent.click(screen.getByRole('button', { name: /Week 3/ }));
  expect(screen.getByText('Reading M1:3')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Week 1/ }));
  expect(screen.getByText('Reading M1:1')).toBeInTheDocument();
  await act(async () => {});
  expect(transport).toHaveBeenCalledTimes(3);
});

it('expires dynamic completion/attendance data and isolates coach and learner caches', async () => {
  let now = 1000;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  const read = () => caseFileSectionRead('coach-A', '101', 'weekly-learning', { week: 'M1:1' });
  await read(); await read();
  expect(transport).toHaveBeenCalledTimes(1);
  now += 60_000; await read();
  expect(transport).toHaveBeenCalledTimes(2);
  await caseFileSectionRead('coach-B', '101', 'weekly-learning', { week: 'M1:1' });
  await caseFileSectionRead('coach-A', '102', 'weekly-learning', { week: 'M1:1' });
  expect(transport).toHaveBeenCalledTimes(4);
});

it('keeps week navigation available and retries a failed selected-week request', async () => {
  transport.mockImplementation(async (url: string) => String(url).includes('week=M1%3A2')
    ? new Response(JSON.stringify({ detail: 'Unavailable' }), { status: 503 })
    : new Response(JSON.stringify(payload())));
  render(<MemoryRouter><CaseFileSessionProvider learnerId="101" coach="coach@example.test"><CaseFileWeeklyLearningTab kind="commercial" learnerId="201" /></CaseFileSessionProvider></MemoryRouter>);
  await screen.findByText('Reading M1:1');
  await act(async () => {});
  transport.mockResolvedValueOnce(new Response(JSON.stringify({ detail: 'Unavailable' }), { status: 503 }));
  fireEvent.click(screen.getByRole('button', { name: /Week 2/ }));
  await screen.findByRole('alert');
  expect(screen.queryByText('Reading M1:1')).not.toBeInTheDocument();
  transport.mockImplementation(async (url: string) => new Response(JSON.stringify(payload(new URL(url, 'https://example.test').searchParams.get('week') || undefined))));
  fireEvent.click(screen.getByRole('button', { name: 'Retry weekly learning' }));
  await screen.findByText('Reading M1:2');
  await act(async () => {});
  await waitFor(() => expect(transport).toHaveBeenCalledTimes(5));
});

it('uses the canonical upcoming session state despite stale absent attendance', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-07T12:00:00Z'));
  const response = payload();
  response.weeks[0] = { ...response.weeks[0], startDate: '2026-10-09', status: 'upcoming', attended: null };
  response.selectedWeek = { ...response.selectedWeek!, ...response.weeks[0], liveSession: {
    ...response.selectedWeek!.liveSession!, start: '2026-10-09T08:00:00Z', date: '2026-10-09',
    status: 'scheduled', sessionState: 'upcoming', attended: false, joinUrl: null,
  } };
  transport.mockResolvedValue(new Response(JSON.stringify(response)));
  render(<MemoryRouter><CaseFileSessionProvider learnerId="101" coach="coach@example.test"><CaseFileWeeklyLearningTab kind="commercial" learnerId="201" /></CaseFileSessionProvider></MemoryRouter>);
  await screen.findByText('A join link has not been added yet.');
  expect(screen.queryByText('This session has ended.')).not.toBeInTheDocument();
  expect(screen.getByRole('img', { name: 'Week 1 session: upcoming' })).toBeInTheDocument();
});


it('joins an in-flight prefetch when its week is clicked', async () => {
  let resolveNext!: (response: Response) => void;
  transport.mockImplementation((url: string) => String(url).includes('week=M1%3A2')
    ? new Promise<Response>(resolve => { resolveNext = resolve; })
    : Promise.resolve(new Response(JSON.stringify(payload()))));
  render(<StrictMode><MemoryRouter><CaseFileSessionProvider learnerId="101" coach="coach@example.test"><CaseFileWeeklyLearningTab kind="commercial" learnerId="201" /></CaseFileSessionProvider></MemoryRouter></StrictMode>);
  await screen.findByText('Reading M1:1');
  await waitFor(() => expect(transport).toHaveBeenCalledTimes(2));
  fireEvent.click(screen.getByRole('button', { name: /Week 2/ }));
  expect(transport).toHaveBeenCalledTimes(2);
  await act(async () => resolveNext(new Response(JSON.stringify({ ...payload('M1:2'), weeks: weeks.slice(0, 2) }))));
  expect(screen.getByText('Reading M1:2')).toBeInTheDocument();
  expect(transport).toHaveBeenCalledTimes(2);
});

it('refetches an expired prefetched week on navigation', async () => {
  let now = 1000;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  render(<MemoryRouter><CaseFileSessionProvider learnerId="101" coach="coach@example.test"><CaseFileWeeklyLearningTab kind="commercial" learnerId="201" /></CaseFileSessionProvider></MemoryRouter>);
  await screen.findByText('Reading M1:1');
  await waitFor(() => expect(transport).toHaveBeenCalledTimes(2));
  await act(async () => {});
  now += 60_000;
  fireEvent.click(screen.getByRole('button', { name: /Week 2/ }));
  expect(screen.getByText(/Loading this week/)).toBeInTheDocument();
  await screen.findByText('Reading M1:2');
  expect(transport.mock.calls.filter(call => String(call[0]).includes('week=M1%3A2'))).toHaveLength(2);
});

it('does not prefetch an unsupported placeholder or skip it to fetch farther weeks', async () => {
  const response = payload();
  response.weeks = [weeks[0], { ...weeks[1], weekId: undefined, totalActivities: 0, sessionState: 'unscheduled' }, weeks[2]];
  transport.mockResolvedValue(new Response(JSON.stringify(response)));
  render(<MemoryRouter><CaseFileSessionProvider learnerId="101" coach="coach@example.test"><CaseFileWeeklyLearningTab kind="commercial" learnerId="201" /></CaseFileSessionProvider></MemoryRouter>);
  await screen.findByText('Reading M1:1');
  await act(async () => {});
  expect(transport).toHaveBeenCalledTimes(1);
});
