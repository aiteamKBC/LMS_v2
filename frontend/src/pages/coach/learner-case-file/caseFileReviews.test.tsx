import { StrictMode } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { clearAllCachedResources } from '@/api/cachedRequest';
import { CaseFileSessionProvider } from '@/features/coach/case-file/hooks/CaseFileSession';
import { useCaseFileReviews, type ReviewsData } from './useCaseFileReviews';
import { ReviewsTab } from './tabs/ReviewsTab';

const mocks = vi.hoisted(() => ({ transport: vi.fn(), coach: 'coach@example.test' }));
vi.mock('@/lib/coachFetch', () => ({ coachFetch: mocks.transport }));
vi.mock('@/hooks/useCoachIdentity', () => ({ useCoachIdentity: () => ({ email: mocks.coach }) }));
const row: ReviewsData['reviews'][number] = { id: 'imported-review:4964', type: 'progress-review', title: 'Progress Review',
  plannedDate: '2026-09-01', scheduledDate: '2026-10-01', scheduledTime: '09:30', completedDate: '2026-10-02',
  status: 'completed', reviewer: 'Synthetic Coach' };
const payload: ReviewsData = { summary: { total: 19, progressReviews: 7, monthlyCoachingMeetings: 12, completed: 5, upcoming: 14 }, reviews: [row,
  { ...row, id: 'mcm-2', type: 'mcr', title: 'Monthly Coaching Meeting', status: 'scheduled', completedDate: null },
  { ...row, id: 'career-3', type: 'review', title: 'Career Review', status: 'not-scheduled', scheduledDate: null }] };
function Harness({ requested = true }: { requested?: boolean }) {
  const state = useCaseFileReviews('101', true, requested);
  return requested ? <ReviewsTab reviewsState={state} /> : <p>Other tab</p>;
}
function Destination() { const location = useLocation(); return <p data-testid="destination">{location.pathname}</p>; }
const wrapper = ({ children }: { children: React.ReactNode }) => <MemoryRouter initialEntries={['/coach/learner-case-file?id=101&tab=reviews']}>
  <CaseFileSessionProvider learnerId="101" coach={mocks.coach}><Routes>
    <Route path="/coach/learner-case-file" element={children} />
    <Route path="/coach/reviews/:eventKey" element={<Destination />} />
  </Routes></CaseFileSessionProvider></MemoryRouter>;
beforeEach(() => {
  clearAllCachedResources(); mocks.coach = 'coach@example.test'; mocks.transport.mockReset();
  mocks.transport.mockImplementation(async (url: string, init?: RequestInit) => {
    expect(init?.method || 'GET').toBe('GET');
    expect(url).toMatch(/^\/coach_api\/coach\/case-file\/(101|102)\/reviews$/);
    return new Response(JSON.stringify(payload), { status: 200 });
  });
});
afterEach(() => vi.restoreAllMocks());

it('loads only on first tab open, reuses a fresh revisit and takes summaries from the backend under StrictMode', async () => {
  const { rerender } = render(<StrictMode><Harness requested={false} /></StrictMode>, { wrapper });
  expect(mocks.transport).not.toHaveBeenCalled();
  rerender(<StrictMode><Harness /></StrictMode>);
  await screen.findAllByRole('cell', { name: 'Synthetic Coach' });
  await waitFor(() => expect(screen.getByLabelText('Review summary')).toHaveTextContent('19Total Reviews'));
  expect(mocks.transport).toHaveBeenCalledTimes(1);
  expect(mocks.transport.mock.calls[0][0]).toBe('/coach_api/coach/case-file/101/reviews');
  rerender(<StrictMode><Harness requested={false} /></StrictMode>);
  rerender(<StrictMode><Harness /></StrictMode>);
  await screen.findByRole('table');
  expect(mocks.transport).toHaveBeenCalledTimes(1);
});

it('filters all normalized types and statuses locally without inferring titles or changing summary', async () => {
  render(<Harness />, { wrapper }); await screen.findByRole('table');
  for (const [label, title] of [['Progress Review', 'Progress Review'], ['Monthly Coaching Meeting', 'Monthly Coaching Meeting'], ['Review', 'Career Review']]) {
    fireEvent.click(within(screen.getByLabelText('Review type filters')).getByRole('button', { name: label }));
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(2);
    expect(screen.getByRole('cell', { name: title })).toBeVisible();
  }
  fireEvent.click(screen.getByRole('button', { name: 'All' }));
  fireEvent.click(screen.getByRole('button', { name: 'Completed' }));
  expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(2);
  fireEvent.click(screen.getByRole('button', { name: 'Upcoming' }));
  expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(3);
  expect(screen.getByLabelText('Review summary')).toHaveTextContent('19Total Reviews');
  expect(mocks.transport).toHaveBeenCalledTimes(1);
});

it('renders only View in every Actions cell and navigates by stable ID without detail, form or mutation requests', async () => {
  render(<Harness />, { wrapper }); await screen.findByRole('table');
  const table = within(screen.getByRole('table'));
  expect(table.queryByText('View Form')).not.toBeInTheDocument();
  expect(table.getAllByRole('columnheader').map(cell => cell.textContent)).toEqual([
    'Review Type', 'Planned Date', 'Scheduled Date & Time', 'Completed Date', 'Status', 'Reviewer', 'Actions',
  ]);
  for (const row of table.getAllByRole('row').slice(1)) {
    const actions = within(row).getAllByRole('cell').at(-1)!;
    expect(actions.textContent).toBe('View');
    expect(within(actions).getAllByRole('button')).toHaveLength(1);
  }
  fireEvent.click(table.getAllByRole('button', { name: 'View' })[0]);
  expect(await screen.findByTestId('destination')).toHaveTextContent('/coach/reviews/imported-review%3A4964');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(mocks.transport).toHaveBeenCalledTimes(1);
  expect(mocks.transport.mock.calls.every(([url, init]) => url.endsWith('/reviews') && (!init?.method || init.method === 'GET'))).toBe(true);
});

it('navigates identical-looking reviews independently using the backend IDs', async () => {
  mocks.transport.mockResolvedValueOnce(new Response(JSON.stringify({ ...payload, reviews: [row, { ...row, id: 'imported-review:4965' }] })));
  render(<Harness />, { wrapper }); await screen.findByRole('table');
  fireEvent.click(screen.getAllByRole('button', { name: 'View' })[1]);
  expect(await screen.findByTestId('destination')).toHaveTextContent('/coach/reviews/imported-review%3A4965');
  expect(mocks.transport).toHaveBeenCalledTimes(1);
});

it('expires list caches after 60 seconds and isolates coach and learner identities', async () => {
  let now = Date.now(); vi.spyOn(Date, 'now').mockImplementation(() => now);
  const { result, unmount } = renderHook(() => useCaseFileReviews('101'), { wrapper });
  await waitFor(() => expect(result.current.data).not.toBeNull());
  expect(mocks.transport).toHaveBeenCalledTimes(1);
  now += 60_001;
  unmount();
  const second = renderHook(() => useCaseFileReviews('101'), { wrapper });
  await waitFor(() => expect(second.result.current.data).not.toBeNull()); expect(mocks.transport).toHaveBeenCalledTimes(2);
  second.unmount(); mocks.coach = 'other@example.test';
  const third = renderHook(() => useCaseFileReviews('101'), { wrapper });
  await waitFor(() => expect(third.result.current.data).not.toBeNull()); expect(mocks.transport).toHaveBeenCalledTimes(3);
  third.unmount();
  const fourth = renderHook(() => useCaseFileReviews('102'));
  await waitFor(() => expect(fourth.result.current.data).not.toBeNull()); expect(mocks.transport).toHaveBeenCalledTimes(4);
  expect(mocks.transport.mock.calls.at(-1)?.[0]).toBe('/coach_api/coach/case-file/102/reviews');
});
