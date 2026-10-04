import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { CoachCalendarEvent } from '../shared/calendarEvents';
import CoachCatchupQueue from './page';

const { bookEvent, fetchEvents, coachFetchMock } = vi.hoisted(() => ({
  bookEvent: vi.fn(),
  fetchEvents: vi.fn(),
  coachFetchMock: vi.fn(),
}));

vi.mock('@/components/feature/WorkspaceShell', () => ({
  WorkspaceShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/hooks/useCoachIdentity', () => ({
  useCoachIdentity: () => ({ email: 'coach@example.com', name: 'Coach Example', isInitialized: true }),
}));
vi.mock('@/lib/coachFetch', () => ({ coachFetch: coachFetchMock }));
vi.mock('../shared/calendarEvents', async importOriginal => ({
  ...(await importOriginal<typeof import('../shared/calendarEvents')>()),
  bookCoachCalendarEvent: bookEvent,
  fetchCoachCalendarEvents: fetchEvents,
}));

function catchup(id: string, overrides: Partial<CoachCalendarEvent> = {}): CoachCalendarEvent {
  return {
    id,
    eventKey: `catch-up:${id}`,
    title: 'Catch-up Session',
    type: 'coaching',
    source: 'catch-up',
    learner: `Learner ${id}`,
    status: 'scheduled',
    scheduledDate: '2026-09-26',
    scheduledTime: '09:30',
    durationMinutes: 30,
    ...overrides,
  };
}

beforeEach(() => {
  // The queue now opens on the current month; pin it to the fixtures' month.
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date('2026-09-14T10:00:00'));
  fetchEvents.mockReset();
  coachFetchMock.mockReset();
  bookEvent.mockReset();
  fetchEvents.mockResolvedValue({ events: [
    catchup('scheduled', { meetingLink: 'https://teams.test/scheduled' }),
    catchup('progress', { status: 'in-progress' }),
    catchup('completed', { status: 'completed' }),
    catchup('cancelled', { status: 'cancelled' }),
    catchup('template', { status: 'not-scheduled' }),
    catchup('review', { source: 'progress-review' }),
    catchup('october', { status: 'completed', scheduledDate: '2026-10-05' }),
  ] });
  coachFetchMock.mockResolvedValue(new Response(JSON.stringify({ items: [{
    id: 'absence-1',
    learnerId: 'scheduled',
    learner: 'Learner scheduled',
    recoveryMethod: 'catch-up',
    catchupEventKey: 'catch-up:scheduled',
    sessionTitle: 'Aya Module — Session 11',
  }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  bookEvent.mockResolvedValue({ event: catchup('new') });
});

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('coach catch-up queue', () => {
  it('shows booked calendar catch-ups, enriches linked lectures, and excludes cancelled or unbooked events', async () => {
    render(<CoachCatchupQueue />);

    expect(await screen.findByText('Learner scheduled')).toBeVisible();
    expect(screen.getByText('Learner progress')).toBeVisible();
    expect(screen.getByText('Learner completed')).toBeVisible();
    expect(screen.queryByText('Learner cancelled')).toBeNull();
    expect(screen.queryByText('Learner template')).toBeNull();
    expect(screen.queryByText('Learner review')).toBeNull();
    expect(screen.getByText('Aya Module')).toBeVisible();
    expect(screen.getByText('Session 11')).toBeVisible();
    expect(screen.getAllByText('Not linked')).toHaveLength(2);
    expect(screen.getByRole('link', { name: 'Open meeting' })).toHaveAttribute('href', 'https://teams.test/scheduled');
  });

  it('keeps calendar bookings visible when missed-lecture enrichment fails', async () => {
    coachFetchMock.mockResolvedValue(new Response(JSON.stringify({ detail: 'Unavailable' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    }));

    render(<CoachCatchupQueue />);

    expect(await screen.findByText('Learner scheduled')).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent('Calendar bookings are still shown.');
  });

  it('filters the queue by month and status with MCM tabs, calendar and stats', async () => {
    render(<CoachCatchupQueue />);
    expect(await screen.findByText('Learner scheduled')).toBeVisible();
    expect(screen.queryByText('Learner october')).toBeNull();

    const tabs = within(screen.getByRole('navigation', { name: 'Filter catch-up sessions by status' }));
    expect(tabs.getAllByRole('button').map(button => button.textContent)).toEqual(['All3', 'Scheduled1', 'In Progress1', 'Completed1']);
    const stats = within(screen.getByRole('region', { name: 'This month' }));
    expect(stats.getAllByRole('meter').map(meter => meter.getAttribute('aria-label'))).toEqual(['Scheduled share', 'In progress share', 'Completed share']);
    expect(stats.getByRole('meter', { name: 'Scheduled share' })).toHaveAttribute('aria-valuenow', '33');
    expect(screen.getByRole('region', { name: 'Meeting calendar for September 2026' })).toBeInTheDocument();

    fireEvent.click(tabs.getByRole('button', { name: 'Completed1' }));
    expect(screen.getByText('Learner completed')).toBeVisible();
    expect(screen.queryByText('Learner scheduled')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
    expect(screen.getByText('Learner october')).toBeVisible();
    expect(screen.queryByText('Learner completed')).toBeNull();
    expect(tabs.getByRole('button', { name: 'All1' })).toHaveAttribute('aria-pressed', 'true');
    expect(fetchEvents).toHaveBeenCalledTimes(1);
  });

  it('schedules a selected missed lecture and links the booking to its absence report', async () => {
    coachFetchMock.mockResolvedValue(new Response(JSON.stringify({ items: [{
      id: 'absence-2', learnerId: 'scheduled', learner: 'Learner scheduled', programme: 'Data Analyst L4',
      recoveryMethod: '', catchupEventKey: null, sessionTitle: 'Missed workshop', sessionDate: '2026-09-20', status: 'pending',
    }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    render(<CoachCatchupQueue />);

    const schedule = await screen.findByRole('button', { name: 'Schedule meeting' });
    expect(schedule).toBeEnabled();
    fireEvent.click(schedule);

    const dialog = screen.getByRole('dialog', { name: 'Schedule meeting' });
    expect(within(dialog).getByLabelText('Missed lecture')).toHaveTextContent('Missed workshop');
    fireEvent.change(within(dialog).getByLabelText('Start time'), { target: { value: '11:30' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Schedule meeting' }));

    await waitFor(() => expect(bookEvent).toHaveBeenCalledWith(expect.objectContaining({
      learnerId: 'scheduled', sessionType: 'catch-up', absenceReportId: 'absence-2',
      scheduledDate: '2026-09-20', scheduledTime: '11:30',
    })));
    expect(screen.queryByRole('dialog', { name: 'Schedule meeting' })).toBeNull();
  });
});
