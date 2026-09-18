import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { CoachCalendarEvent } from '../shared/calendarEvents';

const { fetchCoachCalendarEvents } = vi.hoisted(() => ({ fetchCoachCalendarEvents: vi.fn() }));

vi.mock('@/components/feature/WorkspaceShell', () => ({
  WorkspaceShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/hooks/useCoachIdentity', () => ({
  useCoachIdentity: () => ({ email: 'coach@example.com', name: 'Coach Example', isViewingAsCoach: false, isInitialized: true }),
}));
vi.mock('@/pages/workspace/coach/DashboardMeetingActions', () => ({
  DashboardMeetingActions: () => <><td><button>Reschedule</button></td><td><button>Send Reminder</button></td><td><button>Generate Presentation</button></td><td><button>View Form</button></td></>,
}));
vi.mock('../shared/calendarEvents', async importOriginal => ({
  ...(await importOriginal<typeof import('../shared/calendarEvents')>()),
  fetchCoachCalendarEvents,
}));

function meeting(index: number, overrides: Partial<CoachCalendarEvent> = {}): CoachCalendarEvent {
  return {
    id: `meeting-${index}`, eventKey: `mcr:${index}`, title: `Monthly coaching meeting ${index}`,
    type: 'coaching', source: 'mcr', learner: `Learner ${index}`, status: 'scheduled',
    scheduledDate: `2026-09-${String(14 + index).padStart(2, '0')}`, scheduledTime: '10:30', durationMinutes: 60,
    ...overrides,
  };
}

const meetings = [
  meeting(1, { learner: 'Weekly Learner', scheduledDate: '2026-09-15' }),
  meeting(2, { learner: 'Review Learner', source: 'progress-review', type: 'review', scheduledDate: '2026-09-17' }),
  meeting(3, { learner: 'Upcoming Learner', scheduledDate: '2026-09-23' }),
  meeting(4, { learner: 'Live Session Learner', source: 'live-session', scheduledDate: '2026-09-16' }),
];

function RouteState() {
  const location = useLocation();
  return <output data-testid="route">{location.pathname}</output>;
}

async function renderPage() {
  fetchCoachCalendarEvents.mockResolvedValueOnce({ owner: { name: 'Coach Example' }, events: meetings });
  const { default: CoachMeetings } = await import('./page');
  render(<MemoryRouter initialEntries={['/coach/meetings']}><CoachMeetings /><RouteState /></MemoryRouter>);
  await waitFor(() => expect(fetchCoachCalendarEvents).toHaveBeenCalledOnce());
}

describe('coach meetings schedule layout', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-09-16T10:00:00'));
    fetchCoachCalendarEvents.mockReset();
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it('splits current-week and later meetings while excluding non-meeting calendar events', async () => {
    await renderPage();
    const week = screen.getByRole('region', { name: "This Week's Schedule" });
    const upcoming = screen.getByRole('region', { name: 'Upcoming Meetings' });
    expect(within(week).getByText('Weekly Learner')).toBeInTheDocument();
    expect(within(week).getByText('Review Learner')).toBeInTheDocument();
    expect(within(week).getByText('Progress Review')).toBeInTheDocument();
    expect(within(upcoming).getByText('Upcoming Learner')).toBeInTheDocument();
    expect(screen.queryByText('Live Session Learner')).not.toBeInTheDocument();
  });

  it('keeps the extra meeting actions visible in the weekly schedule', async () => {
    await renderPage();
    const row = screen.getByText('Weekly Learner').closest('tr')!;
    for (const action of ['Reschedule', 'Send Reminder', 'Generate Presentation', 'View Form', 'View Learner']) {
      expect(within(row).getByRole('button', { name: action })).toBeInTheDocument();
    }
  });

  it('filters both schedule tables and opens the full coach calendar', async () => {
    await renderPage();
    fireEvent.change(screen.getByPlaceholderText('Search learners or meeting types...'), { target: { value: 'Upcoming' } });
    expect(screen.queryByText('Weekly Learner')).not.toBeInTheDocument();
    expect(screen.getByText('Upcoming Learner')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /View full calendar/i }));
    expect(screen.getByTestId('route')).toHaveTextContent('/coach/timetable');
  });
});
