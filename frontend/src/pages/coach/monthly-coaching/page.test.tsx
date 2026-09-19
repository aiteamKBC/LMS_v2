import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { CoachCalendarEvent } from '../shared/calendarEvents';
import CoachMonthlyCoaching from './page';
import CoachMeetingDetail from '../meeting-detail/page';

const { fetchEvents, scheduleEvent, savePptx, coach } = vi.hoisted(() => ({
  fetchEvents: vi.fn(),
  scheduleEvent: vi.fn(),
  savePptx: vi.fn(),
  coach: { email: 'coach@example.com', name: 'Coach Example', isInitialized: true, isViewingAsCoach: false },
}));

vi.mock('@/pages/coach/progress-reviews/lib/progressReviewPptx', () => ({ saveProgressReviewPptx: savePptx }));

vi.mock('@/components/feature/WorkspaceShell', () => ({
  WorkspaceShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/hooks/useCoachIdentity', () => ({ useCoachIdentity: () => coach }));
vi.mock('../shared/calendarEvents', async importOriginal => ({
  ...(await importOriginal<typeof import('../shared/calendarEvents')>()),
  fetchCoachCalendarEvents: fetchEvents,
  scheduleCoachCalendarEvent: scheduleEvent,
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
  meeting(9, { learner: 'Awaiting Signature Learner', status: 'awaiting-signature', scheduledDate: '2026-09-11' }),
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
    </Routes>
    <RouteState />
  </MemoryRouter>);
}

const statusFilters = () => within(screen.getByRole('navigation', { name: 'Filter coaching meetings by status' }));
const visibleLearners = () => Array.from(document.querySelectorAll('.ui-action-row'))
  .map(row => row.textContent);

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date('2026-09-14T10:00:00'));
  coach.email = 'coach@example.com';
  fetchEvents.mockReset();
  scheduleEvent.mockReset();
  savePptx.mockReset();
  savePptx.mockResolvedValue(undefined);
  scheduleEvent.mockResolvedValue({ event: meetings[0] });
  fetchEvents.mockResolvedValue({ owner: { name: 'Coach Example' }, events: meetings });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('restored monthly coaching list', () => {
  it.each([
    ['Not Scheduled', ['Overdue Learner', 'Due Soon Learner']],
    ['Scheduled', ['Scheduled Learner']],
    ['In Progress', ['In Progress Learner']],
    ['Completed', ['Completed Learner']],
    ['All', ['Overdue Learner', 'Due Soon Learner', 'Scheduled Learner', 'In Progress Learner', 'Completed Learner', 'Awaiting Signature Learner']],
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
    fireEvent.change(screen.getByRole('combobox', { name: 'Search coaching meetings by learner' }), { target: { value: 'No match' } });
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
    expect(await screen.findByText('Next Month Learner')).toBeVisible();
    expect(visibleLearners()).toHaveLength(1);
    expect(screen.getByTestId('route')).toHaveTextContent('month=2026-10');
    fireEvent.click(screen.getByRole('button', { name: 'Today' }));
    expect(await screen.findByText('Scheduled Learner')).toBeVisible();
    expect(screen.queryByText('Next Month Learner')).toBeNull();
  });

  it('offers learner name suggestions while typing', async () => {
    mount();
    await screen.findByText('Scheduled Learner');
    const search = screen.getByRole('combobox', { name: 'Search coaching meetings by learner' });
    expect(search).toHaveAttribute('list');
    expect(screen.getByDisplayValue('')).toBe(search);
    expect(document.querySelector('datalist option[value="Scheduled Learner"]')).toBeInTheDocument();
  });

  it('opens booking details in a modal and schedules without navigating to the calendar', async () => {
    mount();
    await screen.findByText('Scheduled Learner');
    fireEvent.click(screen.getByRole('button', { name: 'Schedule meeting' }));
    expect(screen.getByRole('dialog', { name: 'Schedule meeting' })).toBeInTheDocument();
    expect(screen.getByText('Microsoft Teams booking')).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Schedule meeting' })).getByRole('button', { name: 'Schedule meeting' }));
    expect(scheduleEvent).toHaveBeenCalledWith(expect.objectContaining({ learner: 'Overdue Learner' }), {
      date: '2026-09-01', time: '09:00', durationMinutes: 60,
    });
    expect(screen.getByTestId('route')).toHaveTextContent('/coach/monthly-coaching');
  });

  it('opens the selected row in the booking modal for Schedule and Reschedule', async () => {
    mount();
    await screen.findByText('Scheduled Learner');

    fireEvent.click(within(screen.getByText('Scheduled Learner').closest('tr')!).getByRole('button', { name: 'Reschedule' }));
    let dialog = screen.getByRole('dialog', { name: 'Schedule meeting' });
    expect(within(dialog).getByRole('combobox', { name: 'Learner' })).toHaveValue('mcr:3');
    expect(within(dialog).getByLabelText('Date')).toHaveValue('2026-09-22');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    fireEvent.click(within(screen.getByText('Overdue Learner').closest('tr')!).getByRole('button', { name: 'Schedule' }));
    dialog = screen.getByRole('dialog', { name: 'Schedule meeting' });
    expect(within(dialog).getByRole('combobox', { name: 'Learner' })).toHaveValue('mcr:1');
    expect(within(dialog).getByLabelText('Date')).toHaveValue('2026-09-01');
    expect(screen.getByTestId('route')).toHaveTextContent('/coach/monthly-coaching');
  });

  it('renders the requested table columns and coaching actions', async () => {
    mount();
    await screen.findByText('Scheduled Learner');
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('columnheader').map(header => header.textContent)).toEqual([
      'Learner', 'Cohort', 'Date & time', 'Status', 'Schedule', 'Actions',
    ]);
    expect(within(screen.getByText('Scheduled Learner').closest('tr')!).getByRole('button', { name: 'Form' })).toBeVisible();
    expect(within(screen.getByText('Scheduled Learner').closest('tr')!).getByRole('button', { name: 'Create Slides' })).toBeVisible();
    expect(within(screen.getByText('Scheduled Learner').closest('tr')!).getByRole('button', { name: 'View' })).toBeVisible();
    expect(within(screen.getByText('Scheduled Learner').closest('tr')!).getByRole('button', { name: 'Reschedule' })).toBeVisible();
    expect(screen.getByText('Scheduled Learner').closest('tr')).toHaveTextContent('10:30 - 11:30');
    fireEvent.click(within(screen.getByText('Scheduled Learner').closest('tr')!).getByRole('button', { name: 'Create Slides' }));
    await waitFor(() => expect(savePptx).toHaveBeenCalledWith(
      expect.objectContaining({ learnerName: 'Scheduled Learner' }),
      'Monthly Coaching Agenda',
    ));
  });

  it('removes scheduling for completed and awaiting-signature meetings', async () => {
    mount();
    await screen.findByText('Scheduled Learner');
    expect(within(screen.getByText('Completed Learner').closest('tr')!).queryByRole('button', { name: /Schedule/ })).toBeNull();
    expect(within(screen.getByText('Awaiting Signature Learner').closest('tr')!).queryByRole('button', { name: /Schedule/ })).toBeNull();
  });

  it('shows only View for completed and awaiting-signature meetings', async () => {
    mount();
    await screen.findByText('Scheduled Learner');
    for (const learner of ['Completed Learner', 'Awaiting Signature Learner']) {
      const row = within(screen.getByText(learner).closest('tr')!);
      expect(row.getByRole('button', { name: 'View' })).toBeVisible();
      expect(row.queryByRole('button', { name: 'Form' })).toBeNull();
      expect(row.queryByRole('button', { name: 'Create Slides' })).toBeNull();
      expect(row.queryByRole('button', { name: 'Join' })).toBeNull();
    }
  });

  it('disables Schedule for in-progress meetings while keeping the actions available', async () => {
    mount();
    await screen.findByText('Scheduled Learner');
    const row = within(screen.getByText('In Progress Learner').closest('tr')!);
    expect(row.queryByRole('button', { name: /Schedule/ })).toBeNull();
    expect(row.getByRole('button', { name: 'Form' })).toBeVisible();
    expect(row.getByRole('button', { name: 'Create Slides' })).toBeVisible();
  });

  it('shows only selected-month status counts and supports awaiting signature', async () => {
    mount();
    await screen.findByText('Scheduled Learner');
    expect(statusFilters().getByRole('button', { name: 'Awaiting Signature1' })).toBeVisible();
    fireEvent.click(statusFilters().getByRole('button', { name: 'Awaiting Signature1' }));
    expect(screen.getByText('Awaiting Signature Learner')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
    expect(await screen.findByText('Next Month Learner')).toBeVisible();
    expect(statusFilters().getByRole('button', { name: 'Awaiting Signature0' })).toBeVisible();
  });

  it('requests only the selected month and excludes unrelated timetable sources', async () => {
    mount();
    await screen.findByText('Scheduled Learner');
    expect(fetchEvents).toHaveBeenCalledWith(expect.any(AbortSignal), {
      start: '2026-09-01', end: '2026-09-30', includeLiveSessions: false, includeSchedulerQueues: false,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
    await screen.findByText('Next Month Learner');
    expect(fetchEvents).toHaveBeenLastCalledWith(expect.any(AbortSignal), {
      start: '2026-10-01', end: '2026-10-31', includeLiveSessions: false, includeSchedulerQueues: false,
    });
  });

  it('only shows Join when the shared join rule allows it', async () => {
    fetchEvents.mockResolvedValue({ events: [
      meeting(10, { learner: 'Future Join', status: 'scheduled', scheduledDate: '2026-09-20', meetingLink: 'https://teams.test/future' }),
      meeting(11, { learner: 'Joinable Meeting', status: 'scheduled', scheduledDate: '2026-09-14', meetingLink: 'https://teams.test/today' }),
      meeting(12, { learner: 'Completed Meeting', status: 'completed', scheduledDate: '2026-09-14', meetingLink: 'https://teams.test/completed' }),
    ] });
    mount();
    await screen.findByText('Joinable Meeting');
    expect(screen.getByRole('button', { name: 'Join' })).toBeVisible();
    expect(within(screen.getByText('Future Join').closest('.ui-action-row')!).queryByRole('button', { name: 'Join' })).toBeNull();
    fireEvent.click(statusFilters().getByRole('button', { name: 'Completed1' }));
    expect(within(screen.getByText('Completed Meeting').closest('.ui-action-row')!).queryByRole('button', { name: 'Join' })).toBeNull();
  });

  it('returns from meeting details to the same MCM filters and page', async () => {
    fetchEvents.mockResolvedValue({ events: Array.from({ length: 12 }, (_, index) => meeting(index + 1)) });
    mount('/coach/monthly-coaching?filter=all&group=group%3Aalpha&q=Learner');
    await screen.findByText('Learner 1');
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(visibleLearners()).toHaveLength(2);
    const returnTo = screen.getByTestId('route').textContent;
    fireEvent.click(screen.getAllByRole('button', { name: 'Form' })[0]);
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
