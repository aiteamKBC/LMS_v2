import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { CoachCalendarEvent } from '../shared/calendarEvents';
import CoachCatchupQueue from './page';

const { fetchEvents, coachFetchMock } = vi.hoisted(() => ({
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
  fetchEvents.mockReset();
  coachFetchMock.mockReset();
  fetchEvents.mockResolvedValue({ events: [
    catchup('scheduled', { meetingLink: 'https://teams.test/scheduled' }),
    catchup('progress', { status: 'in-progress' }),
    catchup('completed', { status: 'completed' }),
    catchup('cancelled', { status: 'cancelled' }),
    catchup('template', { status: 'not-scheduled' }),
    catchup('review', { source: 'progress-review' }),
  ] });
  coachFetchMock.mockResolvedValue(new Response(JSON.stringify({ items: [{
    id: 'absence-1',
    learner: 'Learner scheduled',
    recoveryMethod: 'catch-up',
    catchupEventKey: 'catch-up:scheduled',
    sessionTitle: 'Aya Module — Session 11',
  }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
});

afterEach(cleanup);

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
});
