import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { CoachCalendarEvent } from '../shared/calendarEvents';
import CoachMonthlyCoaching from './page';
import CoachMeetingDetail from '../meeting-detail/page';

const { fetchEvents, coach } = vi.hoisted(() => ({
  fetchEvents: vi.fn(),
  coach: { email: 'coach@example.com', name: 'Coach Example', isInitialized: true, isViewingAsCoach: false },
}));

vi.mock('@/components/feature/WorkspaceShell', () => ({
  WorkspaceShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/hooks/useCoachIdentity', () => ({ useCoachIdentity: () => coach }));
vi.mock('../shared/calendarEvents', async importOriginal => ({
  ...(await importOriginal<typeof import('../shared/calendarEvents')>()),
  fetchCoachCalendarEvents: fetchEvents,
  scheduleCoachCalendarEvent: vi.fn(),
  runCoachCalendarAction: vi.fn(),
}));
vi.mock('../shared/CoachMeetingArtifactsPanel', () => ({ CoachMeetingArtifactsPanel: () => null }));
vi.mock('../shared/ReviewInstanceModal', () => ({ ReviewInstanceModal: () => null }));

function meeting(index: number, overrides: Partial<CoachCalendarEvent> = {}): CoachCalendarEvent {
  return {
    id: `meeting-${index}`, eventKey: `mcr:${index}`, title: `Monthly coaching meeting ${index}`,
    type: 'coaching', source: 'mcr', learner: `Learner ${index}`, learnerId: String(index),
    learnerType: 'apprenticeship', status: 'not-scheduled', targetDate: '2026-09-20',
    group: 'Alpha', durationMinutes: 60, ...overrides,
  };
}

const meetings = [
  meeting(1, { learner: 'Overdue Learner', targetDate: '2026-09-01' }),
  meeting(2, { learner: 'Due Soon Learner', learnerType: 'commercial' }),
  meeting(3, { learner: 'Scheduled Learner', status: 'scheduled', scheduledDate: '2026-09-22', scheduledTime: '10:30', group: 'Beta' }),
  meeting(4, { learner: 'In Progress Learner', status: 'in-progress', scheduledDate: '2026-09-14' }),
  meeting(5, { learner: 'Completed Learner', status: 'completed', scheduledDate: '2026-09-10', group: undefined, cohort: 'Gamma' }),
  meeting(6, { learner: 'Next Month Learner', targetDate: '2026-10-10' }),
  meeting(7, { learner: 'Progress Review Learner', type: 'review', source: 'progress-review' }),
  meeting(8, { learner: 'Live Session Learner', source: 'live-session' }),
];

function RouteState() {
  const location = useLocation();
  return <output data-testid="route">{location.pathname}{location.search}</output>;
}

function mount(path = '/coach/monthly-coaching') {
  return render(<MemoryRouter initialEntries={[path]}>
    <Routes>
      <Route path="/coach/monthly-coaching" element={<CoachMonthlyCoaching />} />
      <Route path="/coach/meetings/:eventKey" element={<CoachMeetingDetail />} />
      <Route path="/coach/meetings" element={<h1>General meetings</h1>} />
    </Routes>
    <RouteState />
  </MemoryRouter>);
}

const statusFilters = () => within(screen.getByRole('navigation', { name: 'Filter coaching meetings by status' }));
const visibleLearners = () => screen.getAllByRole('button', { name: 'View details' })
  .map(button => button.closest('.ui-action-row')!.textContent);

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date('2026-09-14T10:00:00'));
  coach.email = 'coach@example.com';
  fetchEvents.mockReset();
  fetchEvents.mockResolvedValue({ owner: { name: 'Coach Example' }, events: meetings });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('restored monthly coaching list', () => {
  it.each([
    // Preserve the existing month filter: completed meetings have their own tab.
    ['This Month', ['Overdue Learner', 'Due Soon Learner', 'Scheduled Learner', 'In Progress Learner']],
    ['Overdue', ['Overdue Learner']],
    ['Due Soon', ['Due Soon Learner']],
    ['Not Scheduled', ['Overdue Learner', 'Due Soon Learner', 'Next Month Learner']],
    ['Scheduled', ['Scheduled Learner']],
    ['In Progress', ['In Progress Learner']],
    ['Completed', ['Completed Learner']],
    ['All', ['Overdue Learner', 'Due Soon Learner', 'Scheduled Learner', 'In Progress Learner', 'Completed Learner', 'Next Month Learner']],
  ])('restores the %s filter and excludes other meeting types', async (label, expected) => {
    mount();
    await screen.findByText('Scheduled Learner');
    fireEvent.click(statusFilters().getByRole('button', { name: new RegExp(`^${label}\\s*\\d+$`) }));
    expect(visibleLearners()).toHaveLength(expected.length);
    for (const name of expected) expect(screen.getByText(name)).toBeVisible();
    expect(screen.queryByText('Progress Review Learner')).toBeNull();
    expect(screen.queryByText('Live Session Learner')).toBeNull();
  });

  it('combines group or cohort filtering with search', async () => {
    mount('/coach/monthly-coaching?filter=all');
    await screen.findByText('Scheduled Learner');
    fireEvent.click(screen.getByRole('button', { name: /Group\s*All groups/ }));
    fireEvent.click(screen.getByRole('option', { name: 'Group: Beta' }));
    expect(visibleLearners()).toHaveLength(1);
    expect(screen.getByText('Scheduled Learner')).toBeVisible();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'No match' } });
    expect(screen.getByText('No learner matches this search.')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    fireEvent.click(screen.getByRole('button', { name: /Group\s*Group: Beta/ }));
    fireEvent.click(screen.getByRole('option', { name: 'Cohort: Gamma' }));
    expect(visibleLearners()).toHaveLength(1);
    expect(screen.getByText('Completed Learner')).toBeVisible();
  });

  it('switches months and returns to the current month', async () => {
    mount();
    await screen.findByText('Scheduled Learner');
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
    expect(visibleLearners()).toHaveLength(1);
    expect(screen.getByText('Next Month Learner')).toBeVisible();
    expect(screen.getByTestId('route')).toHaveTextContent('month=2026-10');
    fireEvent.click(screen.getByRole('button', { name: 'Today' }));
    expect(screen.getByText('Scheduled Learner')).toBeVisible();
    expect(screen.queryByText('Next Month Learner')).toBeNull();
  });

  it('returns from meeting details to the same MCM filters and page', async () => {
    fetchEvents.mockResolvedValue({ events: Array.from({ length: 12 }, (_, index) => meeting(index + 1)) });
    mount('/coach/monthly-coaching?filter=all&group=group%3Aalpha&q=Learner');
    await screen.findByText('Learner 1');
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(visibleLearners()).toHaveLength(2);
    const returnTo = screen.getByTestId('route').textContent;
    fireEvent.click(screen.getAllByRole('button', { name: 'View details' })[0]);
    const back = await screen.findByRole('link', { name: 'Back to Coaching Meetings' });
    expect(back).toHaveAttribute('href', returnTo);
    fireEvent.click(back);
    await screen.findByRole('button', { name: 'Next page' });
    expect(visibleLearners()).toHaveLength(2);
    expect(screen.getByTestId('route')).toHaveTextContent(returnTo!);
  });

  it('reports API errors without showing a successful empty list', async () => {
    fetchEvents.mockRejectedValue(new Error('Calendar unavailable'));
    mount();
    expect(await screen.findByText('Calendar unavailable')).toBeVisible();
    expect(screen.queryByText('No coaching meetings found.')).toBeNull();
  });

  it('requires coach identity before loading meetings', () => {
    coach.email = '';
    mount();
    expect(screen.getByText('Coach access is required to load coaching meetings.')).toBeVisible();
    expect(fetchEvents).not.toHaveBeenCalled();
  });
});
