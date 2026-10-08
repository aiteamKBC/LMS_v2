import { StrictMode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { clearAllCachedResources } from '@/api/cachedRequest';
import { caseFileSectionRead } from './api/caseFileApi';
import { CaseFileSessionProvider } from './hooks/CaseFileSession';
import { CaseFileMonthlyFocusTab } from '@/pages/coach/learner-case-file/tabs/CaseFileMonthlyFocusTab';

const { transport } = vi.hoisted(() => ({ transport: vi.fn() }));
vi.mock('@/lib/coachFetch', () => ({ coachFetch: transport }));
vi.mock('@/hooks/useCoachViewAs', () => ({ useCoachViewAs: () => null }));
const payload = (month: string) => ({ month, summary: { requiredHours: 50, achievedHours: 10, differenceHours: -123, ksbCount: 2 },
  reviews: [{ id: 'review', type: 'mcr', title: `Review ${month}`, date: `${month}-02`, time: null, durationMinutes: 60, status: 'scheduled' }],
  assignments: [{ id: 'assignment', title: `Assignment ${month}`, date: `${month}-03`, status: 'completed' }],
  lectures: [{ id: 'lecture', title: `Lecture ${month}`, date: `${month}-04`, time: '09:00', durationMinutes: 120, tutor: 'Synthetic tutor' }],
});
beforeEach(() => {
  clearAllCachedResources(); transport.mockReset();
  transport.mockImplementation(async (url: string) => new Response(JSON.stringify(payload(new URL(url, 'http://example.test').searchParams.get('month')!))));
});
afterEach(() => vi.restoreAllMocks());
it.each(['apprenticeship', 'commercial'] as const)('loads one month request under StrictMode and reuses fresh months for %s', async kind => {
  render(<StrictMode><MemoryRouter initialEntries={['/?month=2026-12']}><CaseFileSessionProvider learnerId="101" coach="coach@example.test">
    <CaseFileMonthlyFocusTab kind={kind} learnerId="201" startDate="2026-01-01" endDate="2027-12-31" />
  </CaseFileSessionProvider></MemoryRouter></StrictMode>);
  await screen.findByText('Assignment 2026-12');
  expect(transport.mock.calls.map(call => call[0])).toEqual(['/coach_api/coach/case-file/101/monthly-focus?month=2026-12']);
  const summary = within(screen.getByRole('region', { name: 'Progress this month' }));
  // Deliberately different from 10 - 50: render the backend's final value.
  expect(summary.getByText('-123 hrs')).toBeInTheDocument();
  expect(screen.getByText('Lecture 2026-12')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
  await screen.findByText('Assignment 2027-01');
  expect(transport.mock.calls.at(-1)?.[0]).toBe('/coach_api/coach/case-file/101/monthly-focus?month=2027-01');
  expect(transport).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole('button', { name: 'Previous month' }));
  await screen.findByText('Assignment 2026-12');
  await act(async () => {});
  expect(transport).toHaveBeenCalledTimes(2);
});
it('expires month snapshots after 60 seconds and isolates coaches, learners and months', async () => {
  let now = 1000;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  const read = () => caseFileSectionRead('coach-A', '101', 'monthly-focus', { month: '2026-11' });
  await read(); await read(); expect(transport).toHaveBeenCalledTimes(1);
  now += 60_001;
  await read(); expect(transport).toHaveBeenCalledTimes(2);
  await caseFileSectionRead('coach-B', '101', 'monthly-focus', { month: '2026-11' });
  await caseFileSectionRead('coach-A', '102', 'monthly-focus', { month: '2026-11' });
  await caseFileSectionRead('coach-A', '101', 'monthly-focus', { month: '2026-12' });
  expect(transport).toHaveBeenCalledTimes(5);
});
it('retries failures without caching them', async () => {
  transport.mockImplementationOnce(async () => new Response(JSON.stringify({ detail: 'Synthetic failure' }), { status: 503 }));
  render(<MemoryRouter initialEntries={['/?month=2026-11']}><CaseFileSessionProvider learnerId="101" coach="coach@example.test">
    <CaseFileMonthlyFocusTab kind="commercial" learnerId="201" />
  </CaseFileSessionProvider></MemoryRouter>);
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: 'Retry monthly focus' }));
  await screen.findByText('Assignment 2026-11');
  expect(transport).toHaveBeenCalledTimes(2);
});
