import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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
  meeting(3, { learner: 'Scheduled Learner', email: 'scheduled@example.test', programme: 'Level 3 Coaching', enrolmentId: '42', status: 'scheduled', scheduledDate: '2026-09-22', scheduledTime: '10:30', group: 'Beta' }),
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
    expect(screen.getByText('No matching meetings found.')).toBeVisible();
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

  it('restores Schedule and Reschedule popups for imported Aptem meetings', async () => {
    fetchEvents.mockResolvedValue({ events: [
      meeting(20, { id: 'imported-review:20', eventKey: 'imported-review:20', learner: 'Imported Unscheduled', status: 'not-scheduled', reviewSource: 'aptem', aptemReviewId: '20', hasReviewForm: false, reviewTemplateId: undefined }),
      meeting(21, { id: 'imported-review:21', eventKey: 'imported-review:21', learner: 'Imported Scheduled', status: 'confirmed', scheduledDate: '2026-09-23', scheduledTime: '11:00', reviewSource: 'aptem', aptemReviewId: '21', hasReviewForm: false, reviewTemplateId: undefined }),
    ] });
    mount('/coach/monthly-coaching?filter=all');
    await screen.findByText('Imported Scheduled');

    const unscheduledRow = within(screen.getByText('Imported Unscheduled').closest('tr')!);
    expect(unscheduledRow.getByRole('button', { name: 'View Form' })).toBeVisible();
    fireEvent.click(unscheduledRow.getByRole('button', { name: 'Schedule' }));
    expect(screen.getByRole('dialog', { name: 'Schedule meeting' })).toBeVisible();
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Schedule meeting' })).getByRole('button', { name: 'Cancel' }));

    fireEvent.click(within(screen.getByText('Imported Scheduled').closest('tr')!).getByRole('button', { name: 'Reschedule' }));
    expect(within(screen.getByRole('dialog', { name: 'Schedule meeting' })).getByLabelText('Date')).toHaveValue('2026-09-23');
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Schedule meeting' })).getByRole('button', { name: 'Cancel' }));

    const scheduledRow = within(screen.getByText('Imported Scheduled').closest('tr')!);
    // View is an eye icon just before the overflow menu, which stays last.
    expect(scheduledRow.getAllByRole('button').map(button => button.getAttribute('aria-label') || button.textContent)).toEqual([
      'Reschedule', 'View Form', 'View Slides', 'View', 'More actions for Imported Scheduled',
    ]);
    expect(scheduledRow.getByRole('button', { name: 'More actions for Imported Scheduled' })).toBeVisible();
    fireEvent.click(scheduledRow.getByRole('button', { name: 'View Form' }));
    expect(screen.getByTestId('route')).toHaveTextContent('/coach/review-instances/imported-review%3A21');
    expect(openReview).not.toHaveBeenCalled();
  });

  it('opens an imported Aptem View Form directly instead of the learner profile', async () => {
    fetchEvents.mockResolvedValue({ events: [
      meeting(21, { id: 'imported-review:21', eventKey: 'imported-review:21', learner: 'Imported Completed', status: 'completed', scheduledDate: '2026-09-23', reviewSource: 'aptem', aptemReviewId: '21', hasReviewForm: true }),
    ] });
    mount('/coach/monthly-coaching?filter=all');
    const row = within((await screen.findByText('Imported Completed')).closest('tr')!);
    fireEvent.click(row.getByRole('button', { name: 'View Form' }));
    expect(screen.getByTestId('route')).toHaveTextContent('/coach/review-instances/imported-review%3A21');
    expect(screen.getByTestId('route')).not.toHaveTextContent('/coach/learner-case-file');
  });

  it('opens Curriculum questions for a non-terminal imported Aptem meeting', async () => {
    fetchEvents.mockResolvedValue({ events: [
      meeting(22, { id: 'imported-review:22', eventKey: 'imported-review:22', learner: 'Imported Draft', status: 'confirmed', scheduledDate: '2026-09-23', scheduledTime: '11:00', reviewSource: 'aptem', aptemReviewId: '22', hasReviewForm: true, reviewTemplateId: undefined }),
    ] });
    mount('/coach/monthly-coaching?filter=all');
    fireEvent.click(within((await screen.findByText('Imported Draft')).closest('tr')!).getByRole('button', { name: 'View Form' }));
    expect(screen.getByTestId('route')).toHaveTextContent('/coach/review-instances/imported-review%3A22');
    expect(openReview).not.toHaveBeenCalled();
  });

  it('renders the requested table columns and coaching actions', async () => {
    mount();
    await screen.findByText('Scheduled Learner');
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('columnheader').map(header => header.textContent)).toEqual([
      'Learner', 'Programme', 'Date & time', 'Status', 'Schedule', 'Actions',
    ]);
    const cells = within(screen.getByText('Scheduled Learner').closest('tr')!).getAllByRole('cell');
    expect(cells[0]).toHaveTextContent('Scheduled Learnerscheduled@example.test');
    expect(cells[1]).toHaveTextContent('Level 3 Coaching');
    expect(within(screen.getByText('Scheduled Learner').closest('tr')!).getByRole('button', { name: 'View Form' })).toBeVisible();
    expect(within(screen.getByText('Scheduled Learner').closest('tr')!).getByRole('button', { name: 'View Slides' })).toBeVisible();
    expect(within(screen.getByText('Scheduled Learner').closest('tr')!).getByRole('button', { name: 'View' })).toBeVisible();
    expect(within(screen.getByText('Scheduled Learner').closest('tr')!).getByRole('button', { name: 'Reschedule' })).toBeVisible();
    expect(screen.getByText('Scheduled Learner').closest('tr')).toHaveTextContent('10:30 - 11:30');
  });

  it('opens the learner-owned MCM slides read-only from the meeting row', async () => {
    mount();
    await screen.findByText('Scheduled Learner');
    fireEvent.click(within(screen.getByText('Scheduled Learner').closest('tr')!).getByRole('button', { name: 'View Slides' }));
    // The learner creates and edits their MCM slides; the coach only views them.
    expect(await screen.findByRole('dialog')).toHaveTextContent('mcm slides for Scheduled Learner');
    expect(savePptx).toHaveBeenCalledWith(expect.objectContaining({ kind: 'mcm', access: 'viewer' }));
  });

  it('removes scheduling for completed and awaiting-signature meetings', async () => {
    mount();
    await screen.findByText('Scheduled Learner');
    expect(within(screen.getByText('Completed Learner').closest('tr')!).queryByRole('button', { name: /Schedule/ })).toBeNull();
    expect(within(screen.getByText('Awaiting Signature Learner').closest('tr')!).queryByRole('button', { name: /Schedule/ })).toBeNull();
  });

  it('keeps safe completed and awaiting-signature actions without scheduling', async () => {
    mount();
    await screen.findByText('Scheduled Learner');
    for (const learner of ['Completed Learner', 'Awaiting Signature Learner']) {
      const row = within(screen.getByText(learner).closest('tr')!);
      expect(row.getByRole('button', { name: 'View' })).toBeVisible();
      expect(row.getByRole('button', { name: 'View Form' })).toBeVisible();
      expect(row.getByRole('button', { name: 'View Slides' })).toBeVisible();
      expect(row.queryByRole('button', { name: 'Join' })).toBeNull();
    }
  });

  it('disables Schedule for in-progress meetings while keeping the actions available', async () => {
    mount();
    await screen.findByText('Scheduled Learner');
    const row = within(screen.getByText('In Progress Learner').closest('tr')!);
    expect(row.queryByRole('button', { name: /Schedule/ })).toBeNull();
    expect(row.getByRole('button', { name: 'View Form' })).toBeVisible();
    expect(row.getByRole('button', { name: 'View Slides' })).toBeVisible();
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
    fireEvent.click(screen.getAllByRole('button', { name: 'View' })[0]);
    const back = await screen.findByRole('link', { name: 'Back to Coaching Meetings' });
    expect(back).toHaveAttribute('href', returnTo);
    fireEvent.click(back);
    await screen.findByRole('button', { name: 'Next page' });
    expect(visibleLearners()).toHaveLength(2);
    expect(screen.getByTestId('route')).toHaveTextContent(returnTo!);
  });

  it('derives the header, calendar dots and monthly stats from the selected month', async () => {
    mount();
    await screen.findByText('Scheduled Learner');
    expect(screen.getByText('Manage and track your coaching meetings for', { exact: false })).toHaveTextContent('September 2026');
    const calendar = within(screen.getByRole('region', { name: 'Meeting calendar for September 2026' }));
    expect(calendar.getByRole('gridcell', { name: '2026-09-22: Scheduled' })).toBeInTheDocument();
    expect(calendar.getByRole('gridcell', { name: '2026-09-10: Completed' })).toBeInTheDocument();
    expect(calendar.getByRole('gridcell', { name: '2026-09-23' })).toBeInTheDocument();
    const stats = within(screen.getByRole('region', { name: 'This month' }));
    expect(stats.getByText('Total meetings').parentElement?.previousSibling).toHaveTextContent('6');
    expect(stats.getByRole('meter', { name: 'Completed share' })).toHaveAttribute('aria-valuenow', '17');
    expect(stats.getAllByRole('meter').map(meter => meter.getAttribute('aria-label'))).toEqual([
      'Not scheduled share', 'Scheduled share', 'In progress share', 'Awaiting signature share', 'Completed share',
    ]);
    expect(stats.getByRole('meter', { name: 'Not scheduled share' })).toHaveAttribute('aria-valuenow', '33');

    fireEvent.click(calendar.getByRole('button', { name: 'Calendar next month' }));
    expect(await screen.findByText('Next Month Learner')).toBeVisible();
    expect(screen.getByRole('region', { name: 'Meeting calendar for October 2026' })).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'This month' })).getByRole('meter', { name: 'Completed share' })).toHaveAttribute('aria-valuenow', '0');
  });

  it('shows the month empty state while keeping the calendar and zero stats', async () => {
    fetchEvents.mockResolvedValue({ events: [] });
    mount();
    expect(await screen.findByText('No meetings found for this month.')).toBeVisible();
    expect(screen.getByRole('region', { name: 'Meeting calendar for September 2026' })).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'This month' })).getByRole('meter', { name: 'Scheduled share' })).toHaveAttribute('aria-valuenow', '0');
  });

  it('switches to the grid view with the same actions and keeps it in the URL', async () => {
    mount();
    await screen.findByText('Scheduled Learner');
    fireEvent.click(screen.getByRole('button', { name: 'Grid view' }));
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByTestId('route')).toHaveTextContent('view=grid');
    const card = within(screen.getByText('Scheduled Learner').closest('li')!);
    expect(card.getByRole('button', { name: 'Reschedule' })).toBeVisible();
    expect(card.getByRole('button', { name: 'View Slides' })).toBeVisible();
    expect(visibleLearners()).toHaveLength(6);
  });

  it('offers only safe overflow actions and never cancels a Teams meeting', async () => {
    mount();
    await screen.findByText('Scheduled Learner');
    fireEvent.click(screen.getByRole('button', { name: 'More actions for Scheduled Learner' }));
    const menu = within(screen.getByRole('menu', { name: 'Actions for Scheduled Learner' }));
    expect(menu.getByRole('menuitem', { name: /Cancel meeting/ })).toBeDisabled();
    expect(menu.getByRole('menuitem', { name: 'Copy link' })).toBeDisabled();
    fireEvent.click(menu.getByRole('menuitem', { name: 'Edit meeting' }));
    expect(within(screen.getByRole('dialog', { name: 'Schedule meeting' })).getByRole('combobox', { name: 'Learner' })).toHaveValue('mcr:3');
    expect(scheduleEvent).not.toHaveBeenCalled();

    fireEvent.click(within(screen.getByRole('dialog', { name: 'Schedule meeting' })).getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'More actions for Completed Learner' }));
    expect(within(screen.getByRole('menu', { name: 'Actions for Completed Learner' })).getByRole('menuitem', { name: 'Edit meeting' })).toBeDisabled();
  });

  it('reports API errors without showing a successful empty list', async () => {
    fetchEvents.mockRejectedValue(new Error('Calendar unavailable'));
    mount();
    expect(await screen.findByText('Calendar unavailable')).toBeVisible();
    expect(screen.queryByText('No meetings found for this month.')).toBeNull();
  });

  it('requires coach identity before loading meetings', () => {
    coach.email = '';
    mount();
    expect(screen.getByText('Coach access is required to load coaching meetings.')).toBeVisible();
    expect(fetchEvents).not.toHaveBeenCalled();
  });
});
