import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { coachFetch } from '@/lib/coachFetch';
import { CoachMonthlyLogLearners } from './CoachMonthlyLogLearners';
import { CoachLearnerLogs } from './CoachLearnerLogs';

const identity = vi.hoisted(() => ({ account: 1, viewAs: '' }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ auth: { account: { id: identity.account } } }) }));
vi.mock('@/lib/coachViewAs', () => ({ coachViewAs: () => identity.viewAs ? { email: identity.viewAs } : null }));
vi.mock('@/lib/coachFetch', () => ({ coachFetch: vi.fn() }));
vi.mock('@/features/monthly-logs/page', () => ({ MonthlyLog: () => <div>Opened month detail</div> }));

const year = new Date().getFullYear();
const learners = [{ id: 7, name: 'Synthetic learner', programme: 'Programme' }, { id: 8, name: 'Other learner', programme: 'Other programme' }];
function response(path: string) {
  if (path.endsWith('/learners')) return { learners };
  if (/\/\d{4}-\d{2}$/.test(path)) return { summary: {}, detail: {} };
  const requestedYear = Number(new URL(path, 'http://localhost').searchParams.get('year'));
  return { learner: learners[0], year: requestedYear, years: [year - 1, year],
    summary: { coachSignatures: { completed: 0, total: 12 }, acceptedOtjhHours: 12, trainingPlanHours: 24 },
    months: Array.from({ length: 12 }, (_, index) => ({ month: `${requestedYear}-${String(index + 1).padStart(2, '0')}`,
      activities: 1, acceptedOtjhHours: 1, targetHours: 2, isOpen: false, learnerSigned: false, coachSigned: false })) };
}
function Workspace() {
  const { id, month } = useParams();
  return month && id ? <CoachLearnerLogs key={`${id}-${month}`} id={id} month={month} />
    : <CoachMonthlyLogLearners selectedLearnerId={id} renderSelected={learner => <CoachLearnerLogs key={learner.id} id={String(learner.id)} />} />;
}
function mount(path = '/coach/monthly-logs', client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  const element = () => <StrictMode><QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}><Routes>
    <Route path="/coach/monthly-logs/:id?/:month?" element={<Workspace />} />
  </Routes></MemoryRouter></QueryClientProvider></StrictMode>;
  return { ...render(element()), element, client };
}
beforeEach(() => {
  identity.account = 1; identity.viewAs = '';
  vi.mocked(coachFetch).mockReset().mockImplementation(async path => new Response(JSON.stringify(response(String(path)))));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('opens with one list read; selection, year, cached revisit and tabs have bounded request counts', async () => {
  const view = mount();
  await screen.findByRole('link', { name: /Synthetic learner/ });
  expect(coachFetch).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('link', { name: /Synthetic learner/ }));
  await screen.findByRole('table');
  expect(coachFetch).toHaveBeenCalledTimes(2);
  expect(coachFetch).toHaveBeenLastCalledWith(`/coach_api/coach/monthly-logs/7?year=${year}`);
  expect(screen.getAllByRole('row')).toHaveLength(13);
  fireEvent.click(screen.getByRole('button', { name: /Awaiting signature/ }));
  fireEvent.click(screen.getByRole('button', { name: /All months/ }));
  view.rerender(view.element());
  expect(coachFetch).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole('button', { name: /Awaiting signature/ }));
  fireEvent.change(screen.getByLabelText('Filter by year'), { target: { value: String(year - 1) } });
  await waitFor(() => expect(coachFetch).toHaveBeenCalledTimes(3));
  await screen.findByText(`January ${year - 1}`);
  expect(screen.getByRole('button', { name: /Awaiting signature/ })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.change(screen.getByLabelText('Filter by year'), { target: { value: String(year) } });
  await screen.findByText(`January ${year}`);
  expect(coachFetch).toHaveBeenCalledTimes(3);
  fireEvent.click(screen.getByRole('link', { name: /Review month: January/ }));
  await screen.findByText('Opened month detail');
  expect(coachFetch).toHaveBeenCalledTimes(4);
  expect(coachFetch).toHaveBeenLastCalledWith(`/coach_api/coach/monthly-logs/7/${year}-01`);
  view.client.clear();
});

it('deduplicates pending StrictMode remounts and does not poll', async () => {
  let finish!: (value: Response) => void;
  vi.mocked(coachFetch).mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const view = mount();
  expect(coachFetch).toHaveBeenCalledTimes(1);
  view.rerender(view.element());
  await act(async () => { finish(new Response(JSON.stringify({ learners }))); });
  await screen.findByRole('link', { name: /Synthetic learner/ });
  vi.useFakeTimers();
  await act(async () => { await vi.advanceTimersByTimeAsync(21_000); });
  vi.useRealTimers();
  expect(coachFetch).toHaveBeenCalledTimes(1);
  view.client.clear();
});

it('isolates the selected learner cache by account and view-as identity', async () => {
  const view = mount('/coach/monthly-logs/7');
  await screen.findByRole('table');
  expect(coachFetch).toHaveBeenCalledTimes(2);
  identity.viewAs = 'other@example.invalid';
  view.rerender(view.element());
  await screen.findByRole('table');
  await waitFor(() => expect(coachFetch).toHaveBeenCalledTimes(4));
  identity.account = 2;
  view.rerender(view.element());
  await waitFor(() => expect(coachFetch).toHaveBeenCalledTimes(6));
  view.client.clear();
});


it('switches learners without reloading the list and reuses fresh learner data', async () => {
  const view = mount('/coach/monthly-logs/7');
  await screen.findByRole('table');
  fireEvent.click(screen.getByRole('link', { name: /Other learner/ }));
  await waitFor(() => expect(coachFetch).toHaveBeenCalledTimes(3));
  await screen.findByRole('table');
  expect(coachFetch).toHaveBeenLastCalledWith(`/coach_api/coach/monthly-logs/8?year=${year}`);
  fireEvent.click(screen.getByRole('link', { name: /Synthetic learner/ }));
  await screen.findByRole('table');
  expect(coachFetch).toHaveBeenCalledTimes(3);
  view.client.clear();
});

it('refreshes after 60 seconds on a new visit', async () => {
  const view = mount('/coach/monthly-logs/7');
  await screen.findByRole('table');
  expect(coachFetch).toHaveBeenCalledTimes(2);
  view.unmount();
  const now = Date.now();
  vi.spyOn(Date, 'now').mockReturnValue(now + 60_001);
  mount('/coach/monthly-logs/7', view.client);
  await waitFor(() => expect(coachFetch).toHaveBeenCalledTimes(4));
  await screen.findByRole('table');
  view.client.clear();
});
