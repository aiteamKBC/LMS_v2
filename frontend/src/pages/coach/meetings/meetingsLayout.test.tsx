import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { CoachCalendarEvent } from '../shared/calendarEvents';
import styles from './meetings.module.css';

const { fetchCoachCalendarEvents } = vi.hoisted(() => ({
  fetchCoachCalendarEvents: vi.fn(),
}));

vi.mock('@/components/feature/WorkspaceShell', () => ({
  WorkspaceShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/hooks/useCoachIdentity', () => ({
  useCoachIdentity: () => ({
    email: 'coach@example.com',
    name: 'Coach Example',
    hasCoachAccess: true,
    isViewingAsCoach: false,
    canChooseCoach: false,
    isInitialized: true,
  }),
}));

vi.mock('../shared/calendarEvents', async importOriginal => ({
  ...(await importOriginal<typeof import('../shared/calendarEvents')>()),
  fetchCoachCalendarEvents,
}));

function meeting(index: number, overrides: Partial<CoachCalendarEvent> = {}): CoachCalendarEvent {
  return {
    id: `meeting-${index}`,
    eventKey: `mcr:${index}`,
    title: `Monthly coaching meeting ${index}`,
    type: 'coaching',
    source: 'mcr',
    learner: `Learner ${index}`,
    status: 'not-scheduled',
    targetDate: `2026-09-${String(20 + index).padStart(2, '0')}`,
    durationMinutes: 60,
    platform: 'Microsoft Teams',
    group: `Group ${index}`,
    ...overrides,
  };
}

const layoutMeetings = [
  meeting(1, {
    learner: 'A learner with an exceptionally long name that must remain contained inside the card',
    targetDate: '2026-09-01',
    group: 'A very long group name that should truncate without widening the meeting card',
  }),
  meeting(2, {
    learner: 'Scheduled Learner',
    status: 'scheduled',
    scheduledDate: '2026-09-22',
    scheduledTime: '10:30',
    meetingLink: 'https://teams.example/meeting-2',
  }),
  meeting(3, {
    learner: 'In Progress Learner',
    status: 'in-progress',
    scheduledDate: '2026-09-23',
    scheduledTime: '11:00',
    meetingLink: 'https://teams.example/meeting-3',
    group: undefined,
    cohort: 'A very long cohort name that remains available without overflowing the card',
  }),
  meeting(4, {
    learner: 'Not Scheduled Learner',
    targetDate: '2026-09-30',
  }),
];

async function renderPage(events: CoachCalendarEvent[]) {
  fetchCoachCalendarEvents.mockResolvedValueOnce({
    owner: { name: 'Coach Example', email: 'coach@example.com' },
    events,
  });
  const { default: CoachMeetings } = await import('./page');
  render(
    <MemoryRouter initialEntries={['/coach/meetings']}>
      <CoachMeetings />
    </MemoryRouter>,
  );
  await waitFor(() => expect(fetchCoachCalendarEvents).toHaveBeenCalled());
  return screen.findByTestId('coaching-meeting-grid');
}

function cardFor(learner: string) {
  return screen.getByText(learner).closest('.ui-action-row') as HTMLElement;
}

describe('coach meeting card layout', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-09-14T10:00:00'));
    fetchCoachCalendarEvents.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it.each([1, 2, 3, 4])('keeps %i meeting(s) in the responsive card grid', async count => {
    const grid = await renderPage(layoutMeetings.slice(0, count));

    expect(grid).toHaveClass(styles.meetingGrid);
    expect(grid.children).toHaveLength(count);
    for (const card of Array.from(grid.children)) {
      expect(card).toHaveClass(styles.meetingCard);
      expect(card.querySelector('.ui-action-row__meta')).toBeInTheDocument();
      expect(card.querySelector('.ui-action-row__actions')).toBeInTheDocument();
    }
  });

  it('preserves status badges and the existing action branches without hiding them at narrow widths', async () => {
    await renderPage(layoutMeetings);

    const overdue = cardFor(layoutMeetings[0].learner!);
    expect(within(overdue).getByText('Not Scheduled')).toBeInTheDocument();
    expect(within(overdue).getByText('Overdue')).toBeInTheDocument();
    expect(within(overdue).getByRole('button', { name: 'Calendar' })).toBeInTheDocument();
    expect(within(overdue).getByRole('button', { name: 'Schedule' })).toBeInTheDocument();
    expect(within(overdue).queryByRole('button', { name: 'Join Meeting' })).not.toBeInTheDocument();

    const scheduled = cardFor('Scheduled Learner');
    expect(within(scheduled).getByText('Scheduled')).toBeInTheDocument();
    expect(within(scheduled).getByRole('button', { name: 'Calendar' })).toBeInTheDocument();
    expect(within(scheduled).getByRole('button', { name: 'Join Meeting' })).toBeInTheDocument();
    expect(within(scheduled).getByRole('button', { name: 'Manage' })).toBeInTheDocument();

    const inProgress = cardFor('In Progress Learner');
    expect(within(inProgress).getByText('In Progress')).toBeInTheDocument();
    expect(within(inProgress).getByRole('button', { name: 'Join Meeting' })).toBeInTheDocument();
    expect(within(inProgress).getByRole('button', { name: 'Manage' })).toBeInTheDocument();

    const visibleActionGroup = overdue.querySelector('.ui-calendar-event-action-group') as HTMLElement;
    expect(visibleActionGroup).not.toHaveClass('hidden');
  });

  it('contains long learner and group/cohort labels with accessible full-text tooltips', async () => {
    await renderPage(layoutMeetings);

    expect(screen.getByTitle(layoutMeetings[0].learner!)).toHaveClass('truncate');
    expect(screen.getByTitle(layoutMeetings[0].group!)).toHaveClass('truncate');
    expect(screen.getByTitle(layoutMeetings[2].cohort!)).toHaveClass('truncate');
  });
});
