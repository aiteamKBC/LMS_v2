import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { CoachCalendarEvent } from '../shared/calendarEvents';
import CoachMonthlyCoaching from './page';
import CoachMeetingDetail from '../meeting-detail/page';

const { fetchEvents, scheduleEvent, savePptx, openReview, coach } = vi.hoisted(() => ({
  fetchEvents: vi.fn(),
  scheduleEvent: vi.fn(),
  savePptx: vi.fn(),
  openReview: vi.fn(),
  coach: { email: 'coach@example.com', name: 'Coach Example', isInitialized: true, isViewingAsCoach: false },
}));

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
vi.mock('../progress-reviews/components/ProgressReviewPptxModal', () => ({
  default: (props: { kind?: string; access?: string; target: { learnerName?: string } | null }) => {
    savePptx(props);
    return <div role="dialog">{props.kind} slides for {props.target?.learnerName}</div>;
  },
}));
vi.mock('@/api/reviewInstances', () => ({ openReviewInstanceForEvent: openReview }));

function meeting(index: number, overrides: Partial<CoachCalendarEvent> = {}): CoachCalendarEvent {
  return {
    id: `meeting-${index}`, eventKey: `mcr:${index}`, title: `Monthly coaching meeting ${index}`,
    type: 'coaching', source: 'mcr', learner: `Learner ${index}`, learnerId: String(index),
    learnerType: 'apprenticeship', status: 'not-scheduled', targetDate: '2026-09-20',
    group: 'Alpha', durationMinutes: 60, reviewSource: 'curriculum',
    reviewTemplateId: 'REV-MCM', enrolmentId: `ENR-${index}`, ...overrides,
  };
}

const meetings = [
  meeting(1, { learner: 'Overdue Learner', targetDate: '2026-09-01' }),
  meeting(2, { learner: 'Due Soon Learner', learnerType: 'commercial' }),
  meeting(3, { learner: 'Scheduled Learner', email: 'scheduled@example.com', programme: 'Leadership and Management', enrolmentId: '42', status: 'scheduled', scheduledDate: '2026-09-22', scheduledTime: '10:30', group: 'Beta' }),
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
function rowMenu(learner: string) {
  fireEvent.click(screen.getByRole('button', { name: 'More actions for ' + learner }));
  return within(screen.getByRole('menu', { name: 'Actions for ' + learner }));
}
const visibleLearners = () => Array.from(document.querySelectorAll('.ui-action-row'))
  .map(row => row.textContent);

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date('2026-09-14T10:00:00'));
  coach.email = 'coach@example.com';
  fetchEvents.mockReset();
  scheduleEvent.mockReset();
  savePptx.mockReset();
  openReview.mockReset();
  scheduleEvent.mockResolvedValue({ event: meetings[0] });
  savePptx.mockResolvedValue(undefined);
  openReview.mockResolvedValue({ instanceId: 'REVI-APTEM' });
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

  it('loads past and upcoming meetings across all months', async () => {
    mount();
    await screen.findByText('Scheduled Learner');

    fireEvent.click(screen.getByRole('button', { name: 'All months' }));

    expect(await screen.findByText('Next Month Learner')).toBeVisible();
    expect(screen.getByRole('button', { name: 'All months' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('route')).toHaveTextContent('months=all');
    expect(fetchEvents).toHaveBeenLastCalledWith(expect.any(AbortSignal), {
      includeLiveSessions: false, includeSchedulerQueues: false,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }));
    expect(screen.queryByText('Next Month Learner')).toBeNull();
    expect(screen.getByRole('button', { name: 'All months' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('shows the newest meetings first and keeps the sort control available', async () => {
    mount('/coach/monthly-coaching?months=all');
    await screen.findByText('Next Month Learner');

    const table = screen.getByRole('table');
    const learnerNames = within(table).getAllByRole('row').slice(1).map(row => row.querySelector('strong')?.textContent);
    expect(learnerNames).toEqual([
      'Next Month Learner', 'Scheduled Learner', 'Due Soon Learner',
      'In Progress Learner', 'Awaiting Signature Learner', 'Completed Learner', 'Overdue Learner',
    ]);
    const sort = screen.getByRole('combobox', { name: 'Sort by' });
    expect(sort).toHaveValue('date-desc');
    fireEvent.change(sort, { target: { value: 'date-asc' } });
    expect(within(screen.getByRole('table')).getAllByRole('row')[1]).toHaveTextContent('Overdue Learner');
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

    fireEvent.click(rowMenu('Scheduled Learner').getByRole('menuitem', { name: 'Reschedule' }));
    let dialog = screen.getByRole('dialog', { name: 'Schedule meeting' });
    expect(within(dialog).getByRole('combobox', { name: 'Learner' })).toHaveValue('mcr:3');
    expect(within(dialog).getByLabelText('Date')).toHaveValue('2026-09-22');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    fireEvent.click(rowMenu('Overdue Learner').getByRole('menuitem', { name: 'Schedule' }));
    dialog = screen.getByRole('dialog', { name: 'Schedule meeting' });
    expect(within(dialog).getByRole('combobox', { name: 'Learner' })).toHaveValue('mcr:1');
    expect(within(dialog).getByLabelText('Date')).toHaveValue('2026-09-01');
    expect(screen.getByTestId('route')).toHaveTextContent('/coach/monthly-coaching');
  });

  it('restores Schedule and Reschedule popups for imported Aptem meetings', async () => {
    fetchEvents.mockResolvedValue({ events: [
      meeting(20, { id: 'imported-review:20', eventKey: 'imported-review:20', learner: 'Imported Unscheduled', status: 'not-scheduled', reviewSource: 'aptem', aptemReviewId: '20', hasReviewForm: false, reviewTemplateId: undefined }),
      meeting(21, { id: 'imported-review:21', eventKey: 'imported-review:21', learner: 'Imported Scheduled', status: 'confirmed', scheduledDate: '2026-09-23', scheduledTime: '11:00', reviewSource: 'aptem', aptemReviewId: '21', hasReviewForm: false, reviewTemplateId: undefined }),
    ] });
    mount('/coach/monthly-coaching?filter=all');
    await screen.findByText('Imported Scheduled');

    const unscheduledRow = within(screen.getByText('Imported Unscheduled').closest('tr')!);
    expect(unscheduledRow.getByRole('button', { name: 'View form' })).toBeVisible();
    fireEvent.click(rowMenu('Imported Unscheduled').getByRole('menuitem', { name: 'Schedule' }));
    expect(screen.getByRole('dialog', { name: 'Schedule meeting' })).toBeVisible();
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Schedule meeting' })).getByRole('button', { name: 'Cancel' }));

    fireEvent.click(rowMenu('Imported Scheduled').getByRole('menuitem', { name: 'Reschedule' }));
    expect(within(screen.getByRole('dialog', { name: 'Schedule meeting' })).getByLabelText('Date')).toHaveValue('2026-09-23');
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Schedule meeting' })).getByRole('button', { name: 'Cancel' }));

    const scheduledRow = within(screen.getByText('Imported Scheduled').closest('tr')!);
    expect(scheduledRow.getByRole('button', { name: 'View form' })).toBeVisible();
    expect(rowMenu('Imported Scheduled').getAllByRole('menuitem').map(item => item.textContent)).toEqual([
      'View details', 'View slides', 'Reschedule',
    ]);
    fireEvent.click(scheduledRow.getByRole('button', { name: 'View form' }));
    expect(screen.getByTestId('route')).toHaveTextContent('/coach/review-instances/imported-review%3A21');
    expect(openReview).not.toHaveBeenCalled();
  });

  it('opens an imported Aptem View Form directly instead of the learner profile', async () => {
    fetchEvents.mockResolvedValue({ events: [
      meeting(21, { id: 'imported-review:21', eventKey: 'imported-review:21', learner: 'Imported Completed', status: 'completed', scheduledDate: '2026-09-23', reviewSource: 'aptem', aptemReviewId: '21', hasReviewForm: true }),
    ] });
    mount('/coach/monthly-coaching?filter=all');
    const row = within((await screen.findByText('Imported Completed')).closest('tr')!);
    fireEvent.click(row.getByRole('button', { name: 'View form' }));
    expect(screen.getByTestId('route')).toHaveTextContent('/coach/review-instances/imported-review%3A21');
    expect(screen.getByTestId('route')).not.toHaveTextContent('/coach/learner-case-file');
  });

  it('opens Curriculum questions for a non-terminal imported Aptem meeting', async () => {
    fetchEvents.mockResolvedValue({ events: [
      meeting(22, { id: 'imported-review:22', eventKey: 'imported-review:22', learner: 'Imported Draft', status: 'confirmed', scheduledDate: '2026-09-23', scheduledTime: '11:00', reviewSource: 'aptem', aptemReviewId: '22', hasReviewForm: true, reviewTemplateId: undefined }),
    ] });
    mount('/coach/monthly-coaching?filter=all');
    fireEvent.click(within((await screen.findByText('Imported Draft')).closest('tr')!).getByRole('button', { name: 'View form' }));
    expect(screen.getByTestId('route')).toHaveTextContent('/coach/review-instances/imported-review%3A22');
    expect(openReview).not.toHaveBeenCalled();
  });

  it('renders the requested table columns and coaching actions', async () => {
    mount();
    await screen.findByText('Scheduled Learner');
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('columnheader').map(header => header.textContent)).toEqual([
      'Learner', 'Programme', 'Cohort', 'Date & time', 'Status', 'Actions',
    ]);
    const scheduledRow = within(screen.getByText('Scheduled Learner').closest('tr')!);
    expect(scheduledRow.getByText('scheduled@example.com')).toBeVisible();
    expect(scheduledRow.getByText('Leadership and Management')).toBeVisible();
    expect(scheduledRow.getByRole('button', { name: 'View form' })).toBeVisible();
    const menu = rowMenu('Scheduled Learner');
    expect(menu.getByRole('menuitem', { name: 'View slides' })).toBeVisible();
    expect(menu.getByRole('menuitem', { name: 'View details' })).toBeVisible();
    expect(menu.getByRole('menuitem', { name: 'Reschedule' })).toBeVisible();
    expect(screen.getByText('Scheduled Learner').closest('tr')).toHaveTextContent('10:30 - 11:30');
  });

  it('opens the learner-owned MCM slides read-only from the meeting row', async () => {
    mount();
    await screen.findByText('Scheduled Learner');
    fireEvent.click(rowMenu('Scheduled Learner').getByRole('menuitem', { name: 'View slides' }));
    // The learner creates and edits their MCM slides; the coach only views them.
    expect(await screen.findByRole('dialog')).toHaveTextContent('mcm slides for Scheduled Learner');
    expect(savePptx).toHaveBeenCalledWith(expect.objectContaining({ kind: 'mcm', access: 'viewer' }));
  });

  it('removes scheduling for completed and awaiting-signature meetings', async () => {
    mount();
    await screen.findByText('Scheduled Learner');
    for (const learner of ['Completed Learner', 'Awaiting Signature Learner']) {
      const menu = rowMenu(learner);
      expect(menu.queryByRole('menuitem', { name: /schedule/i })).toBeNull();
      fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    }
  });

  it('keeps safe completed and awaiting-signature actions without scheduling', async () => {
    mount();
    await screen.findByText('Scheduled Learner');
    for (const learner of ['Completed Learner', 'Awaiting Signature Learner']) {
      const row = within(screen.getByText(learner).closest('tr')!);
      expect(row.getByRole('button', { name: 'View form' })).toBeVisible();
      const menu = rowMenu(learner);
      expect(menu.getByRole('menuitem', { name: 'View details' })).toBeVisible();
      expect(menu.getByRole('menuitem', { name: 'View slides' })).toBeVisible();
      expect(menu.queryByRole('menuitem', { name: 'Join' })).toBeNull();
      fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    }
  });

  it('disables Schedule for in-progress meetings while keeping the actions available', async () => {
    mount();
    await screen.findByText('Scheduled Learner');
    const row = within(screen.getByText('In Progress Learner').closest('tr')!);
    expect(row.getByRole('button', { name: 'View form' })).toBeVisible();
    const menu = rowMenu('In Progress Learner');
    expect(menu.queryByRole('menuitem', { name: /schedule/i })).toBeNull();
    expect(menu.getByRole('menuitem', { name: 'View slides' })).toBeVisible();
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

  it('uses the all-month source for each month and excludes unrelated timetable sources', async () => {
    mount();
    await screen.findByText('Scheduled Learner');
    expect(fetchEvents).toHaveBeenCalledWith(expect.any(AbortSignal), {
      includeLiveSessions: false, includeSchedulerQueues: false,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
    await screen.findByText('Next Month Learner');
    expect(fetchEvents).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Progress Review Learner')).toBeNull();
    expect(screen.queryByText('Live Session Learner')).toBeNull();
  });

  it('shows meetings in their booked month across statuses even when the target month differs', async () => {
    fetchEvents.mockResolvedValue({ events: [
      meeting(20, { learner: 'Moved Scheduled', targetDate: '2026-09-20', scheduledDate: '2026-10-04', status: 'scheduled' }),
      meeting(21, { learner: 'October Completed', targetDate: '2026-10-12', status: 'completed' }),
      meeting(22, { learner: 'October Unscheduled', targetDate: '2026-10-15' }),
    ] });
    mount();
    await screen.findByText('0 coaching meetings');
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
    expect(await screen.findByText('Moved Scheduled')).toBeVisible();
    expect(statusFilters().getByRole('button', { name: 'All3' })).toBeVisible();
    expect(statusFilters().getByRole('button', { name: 'Scheduled1' })).toBeVisible();
    expect(statusFilters().getByRole('button', { name: 'Completed1' })).toBeVisible();
    expect(statusFilters().getByRole('button', { name: 'Not Scheduled1' })).toBeVisible();
  });

  it('only shows Join when the shared join rule allows it', async () => {
    fetchEvents.mockResolvedValue({ events: [
      meeting(10, { learner: 'Future Join', status: 'scheduled', scheduledDate: '2026-09-20', meetingLink: 'https://teams.test/future' }),
      meeting(11, { learner: 'Joinable Meeting', status: 'scheduled', scheduledDate: '2026-09-14', meetingLink: 'https://teams.test/today' }),
      meeting(12, { learner: 'Completed Meeting', status: 'completed', scheduledDate: '2026-09-14', meetingLink: 'https://teams.test/completed' }),
    ] });
    mount();
    await screen.findByText('Joinable Meeting');
    const openWindow = vi.spyOn(window, 'open').mockImplementation(() => null);
    fireEvent.click(rowMenu('Joinable Meeting').getByRole('menuitem', { name: 'Join' }));
    expect(openWindow).toHaveBeenCalledWith('https://teams.test/today', '_blank', 'noopener,noreferrer');
    openWindow.mockRestore();
    expect(rowMenu('Future Join').queryByRole('menuitem', { name: 'Join' })).toBeNull();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    fireEvent.click(statusFilters().getByRole('button', { name: 'Completed1' }));
    expect(rowMenu('Completed Meeting').queryByRole('menuitem', { name: 'Join' })).toBeNull();
  });

  it('returns from meeting details to the same MCM filters and page', async () => {
    fetchEvents.mockResolvedValue({ events: Array.from({ length: 12 }, (_, index) => meeting(index + 1)) });
    mount('/coach/monthly-coaching?filter=all&group=group%3Aalpha&q=Learner');
    await screen.findByText('Learner 1');
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(visibleLearners()).toHaveLength(2);
    const returnTo = screen.getByTestId('route').textContent;
    const learner = document.querySelector('.ui-action-row strong')!.textContent!;
    fireEvent.click(rowMenu(learner).getByRole('menuitem', { name: 'View details' }));
    const back = await screen.findByRole('link', { name: 'Back to Coaching Meetings' });
    expect(back).toHaveAttribute('href', returnTo);
    fireEvent.click(back);
    await screen.findByRole('button', { name: 'Next page' });
    expect(visibleLearners()).toHaveLength(2);
    expect(screen.getByTestId('route')).toHaveTextContent(returnTo!);
  });

  it('loads meeting details without optional timetable sources that may fail', async () => {
    fetchEvents.mockImplementation((_signal: AbortSignal, options?: { includeLiveSessions?: boolean; includeSchedulerQueues?: boolean }) => {
      if (options?.includeLiveSessions !== false || options?.includeSchedulerQueues !== false) {
        return Promise.reject(new Error('Request failed with 503'));
      }
      return Promise.resolve({ events: [meetings[2]] });
    });
    mount();
    await screen.findByText('Scheduled Learner');
    fireEvent.click(rowMenu('Scheduled Learner').getByRole('menuitem', { name: 'View details' }));
    expect(await screen.findByRole('link', { name: 'Back to Coaching Meetings' })).toBeVisible();
    expect(screen.queryByText('Unable to load this meeting.')).toBeNull();
    expect(fetchEvents).toHaveBeenLastCalledWith(expect.any(AbortSignal), {
      includeLiveSessions: false, includeSchedulerQueues: false,
    });
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
  it('shows the exact banner copy and a keyboard-scrollable six-column table', async () => {
    mount();
    await screen.findByText('Scheduled Learner');
    expect(screen.getByRole('heading', { name: 'Support. Progress. Succeed.' })).toBeVisible();
    expect(screen.getByText('Meaningful conversations help learners stay on track and reach their goals.')).toBeVisible();
    const banner = screen.getByRole('region', { name: 'Monthly coaching support' });
    expect(banner.querySelector('svg[aria-hidden="true"]')).toBeTruthy();
    expect(banner.querySelector('img[src$="coach-meetings-calendar.webp"]')).toBeTruthy();
    expect(screen.getByRole('region', { name: /Coaching meetings table/ })).toHaveAttribute('tabindex', '0');
    expect(screen.getByText('Scheduled Learner').closest('td')).toBeTruthy();
  });

  it('omits unavailable forms and slides while preserving details and scheduling', async () => {
    fetchEvents.mockResolvedValue({ events: [
      meeting(30, { learner: 'No Form Or Slides', reviewTemplateId: undefined, hasReviewForm: false, enrolmentId: undefined }),
      meeting(31, { learner: 'No Meeting Date', targetDate: undefined, scheduledDate: undefined }),
    ] });
    mount('/coach/monthly-coaching?months=all');
    const row = within((await screen.findByText('No Form Or Slides')).closest('tr')!);
    expect(row.queryByRole('button', { name: 'View form' })).toBeNull();
    const menu = rowMenu('No Form Or Slides');
    expect(menu.getAllByRole('menuitem').map(item => item.textContent)).toEqual(['View details', 'Schedule']);
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(rowMenu('No Meeting Date').queryByRole('menuitem', { name: 'View slides' })).toBeNull();
  });

  it('supports arrow keys, Home, End and Escape and returns focus to the trigger', async () => {
    mount();
    await screen.findByText('Scheduled Learner');
    const trigger = screen.getByRole('button', { name: 'More actions for Scheduled Learner' });
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    const menu = screen.getByRole('menu', { name: 'Actions for Scheduled Learner' });
    expect(within(menu).getByRole('menuitem', { name: 'View details' })).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(within(menu).getByRole('menuitem', { name: 'View slides' })).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'End' });
    expect(within(menu).getByRole('menuitem', { name: 'Reschedule' })).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'Home' });
    expect(within(menu).getByRole('menuitem', { name: 'View details' })).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    expect(within(menu).getByRole('menuitem', { name: 'Reschedule' })).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('portals the menu outside the table and closes on outside clicks, focus, scroll and filter changes', async () => {
    mount();
    await screen.findByText('Scheduled Learner');
    rowMenu('Scheduled Learner');
    expect(screen.getByRole('table').contains(screen.getByRole('menu'))).toBe(false);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
    rowMenu('Scheduled Learner');
    act(() => screen.getByRole('button', { name: 'Schedule meeting' }).focus());
    expect(screen.queryByRole('menu')).toBeNull();
    rowMenu('Scheduled Learner');
    fireEvent.scroll(screen.getByRole('region', { name: /Coaching meetings table/ }));
    expect(screen.queryByRole('menu')).toBeNull();
    rowMenu('Scheduled Learner');
    fireEvent.click(statusFilters().getByRole('button', { name: 'Completed1' }));
    expect(screen.queryByRole('menu')).toBeNull();
  });

});
