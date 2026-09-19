import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import CoachCatchupQueue from './page';

const mocks = vi.hoisted(() => ({ coachFetch: vi.fn(), fetchEvents: vi.fn() }));

vi.mock('@/components/feature/WorkspaceShell', () => ({ WorkspaceShell: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock('@/hooks/useCoachIdentity', () => ({ useCoachIdentity: () => ({ email: 'coach@example.test', name: 'Coach Example', isInitialized: true }) }));
vi.mock('@/lib/coachFetch', () => ({ coachFetch: mocks.coachFetch }));
vi.mock('@/pages/coach/shared/calendarEvents', async original => ({
  ...await original<typeof import('@/pages/coach/shared/calendarEvents')>(),
  fetchCoachCalendarEvents: mocks.fetchEvents,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.fetchEvents.mockResolvedValue({ events: [
    { id: 'catch-up:1', eventKey: 'catch-up:1', source: 'catch-up', status: 'completed', scheduledDate: '2026-09-22', scheduledTime: '10:00', durationMinutes: 60 },
    { id: 'catch-up:2', eventKey: 'catch-up:2', source: 'catch-up', status: 'confirmed', scheduledDate: '2026-09-23', scheduledTime: '13:30', durationMinutes: 30 },
  ] });
  mocks.coachFetch.mockResolvedValue(new Response(JSON.stringify({ items: [
    { id: 'report-1', learner: 'Aya Learner', sessionTitle: 'Data Visualisation', recoveryMethod: 'catch-up', catchupEventKey: 'catch-up:1' },
    { id: 'report-2', learner: 'Ayman Learner', sessionTitle: 'Marketing Environment', recoveryMethod: 'catch-up', catchupEventKey: 'catch-up:2' },
    { id: 'report-3', learner: 'Recording Learner', sessionTitle: 'Recorded Lecture', recoveryMethod: 'recorded', catchupEventKey: null },
  ] })));
});

afterEach(cleanup);

it('shows only the requested catch-up columns and links each absence to its booking', async () => {
  render(<MemoryRouter><CoachCatchupQueue /></MemoryRouter>);

  const table = await screen.findByRole('table');
  expect(within(table).getAllByRole('columnheader').map(header => header.textContent)).toEqual([
    'Learner', 'Missed Lecture', 'Catch-up Booking', 'Completed',
  ]);
  expect(within(table).getByText('Aya Learner')).toBeVisible();
  expect(within(table).getByText('Data Visualisation')).toBeVisible();
  expect(within(table).getByText('22 Sept 2026')).toBeVisible();
  expect(within(table).getByText('10:00 - 11:00')).toBeVisible();
  expect(within(table).queryByText('Recording Learner')).not.toBeInTheDocument();
});

it('marks only a completed catch-up event as completed', async () => {
  render(<MemoryRouter><CoachCatchupQueue /></MemoryRouter>);

  const completedRow = (await screen.findByText('Aya Learner')).closest('tr')!;
  const confirmedRow = screen.getByText('Ayman Learner').closest('tr')!;
  expect(within(completedRow).getByText('Yes')).toBeVisible();
  expect(within(confirmedRow).getByText('No')).toBeVisible();
});
