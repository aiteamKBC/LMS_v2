import { cleanup, fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { CoachCalendarEvent } from '../shared/calendarEvents';
import CoachProgressReviews from './page';
import { importedBookingDefinition, installDialogTestSupport, personalSupportBooking, scheduledImportedBooking } from '../shared/__tests__/importedBookingFixtures';

const { fetchEvents, openReview, scheduleEvent, fetchForm, book, reschedule, adopt, coach, start, fetchSlots } = vi.hoisted(() => ({
  fetchSlots: vi.fn(),
  start: vi.fn(),
  fetchForm: vi.fn(), book: vi.fn(), reschedule: vi.fn(), adopt: vi.fn(),
  fetchEvents: vi.fn(),
  openReview: vi.fn(),
  scheduleEvent: vi.fn(),
  coach: { email: 'coach@example.com', name: 'Coach Example', isInitialized: true, isViewingAsCoach: false },
}));

vi.mock('@/components/feature/WorkspaceShell', () => ({ WorkspaceShell: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock('@/hooks/useCoachIdentity', () => ({ useCoachIdentity: () => coach }));
vi.mock('./components/ProgressReviewPptxModal', () => ({ default: () => null }));
vi.mock('../shared/ProgressReviewCompletionModal', () => ({ default: () => null }));
vi.mock('../shared/calendarEvents', async importOriginal => ({
  ...(await importOriginal<typeof import('../shared/calendarEvents')>()),
  fetchCoachCalendarEvents: fetchEvents,
  scheduleCoachCalendarEvent: scheduleEvent,
}));
vi.mock('@/api/progressReviews', () => ({
  fetchLatestRun: vi.fn().mockResolvedValue({ exists: false }),
  bulkGenerateProgressReviews: vi.fn(),
}));
vi.mock('@/api/reviewInstances', () => ({ openReviewInstanceForEvent: openReview,
  startMigratedReview: start,
  adoptMigratedReviewBooking: adopt,
  fetchCoachReviewSlots: fetchSlots,
  fetchReviewInstanceForm: fetchForm, bookMigratedReview: book, rescheduleMigratedReview: reschedule, initializeMigratedReview: vi.fn(),
}));

function review(index: number, overrides: Partial<CoachCalendarEvent> = {}): CoachCalendarEvent {
  return {
    id: `review-${index}`, eventKey: `progress-review:${index}`, title: `Progress review ${index}`,
    type: 'review', source: 'progress-review', learner: `Learner ${index}`, learnerId: String(index),
    learnerType: 'apprenticeship', status: 'not-scheduled', targetDate: '2026-09-20',
    programme: 'Final Test', durationMinutes: 60, reviewSource: 'curriculum',
    reviewTemplateId: 'REV-PR', enrolmentId: `ENR-${index}`, ...overrides,
  };
}

const reviews = [
  review(1, { learner: 'Needs Schedule' }),
  review(2, { learner: 'Scheduled Review', status: 'scheduled', scheduledDate: '2026-09-22' }),
  review(3, { learner: 'Completed Review', status: 'completed', scheduledDate: '2026-09-10' }),
  review(4, { learner: 'Next Month Review', targetDate: '2026-10-12' }),
];

function LocationOutput() {
  const location = useLocation();
  return <output data-testid="route">{location.pathname}{location.search}</output>;
}
async function selectBookingTime(value = '09:00') {
  await screen.findByRole('option', { name: value });
  fireEvent.change(screen.getByLabelText('Time'), { target: { value } });
}

it.each([false, true])('offers PSP booking from its Review row (scheduled=%s)', async scheduled => {
  fetchEvents.mockResolvedValue({ owner: { name: 'Coach' }, events: [review(31, {
    id: 'imported-review:31', eventKey: 'imported-review:31', reviewSource: 'aptem', aptemReviewId: '31',
    importedReviewType: 'Personal Support Plan', reviewTemplateId: null, hasReviewForm: false,
    status: scheduled ? 'scheduled' : 'not-scheduled', calendarEventKey: scheduled ? 'imported-review:31' : null,
  })] });
  fetchForm.mockResolvedValue(personalSupportBooking(scheduled));
  (scheduled ? reschedule : book).mockResolvedValue(personalSupportBooking(true));
  mount('/coach/reviews');
  fireEvent.click(await screen.findByRole('button', { name: 'More actions for Learner 31' }));
  fireEvent.click(screen.getByRole('menuitem', { name: scheduled ? 'Reschedule' : 'Schedule' }));
  await selectBookingTime();
  fireEvent.click(await screen.findByRole('button', { name: scheduled ? 'Save new time' : 'Confirm booking' }));
  expect(await screen.findByText(scheduled ? 'Review rescheduled.' : 'Review scheduled.')).toBeVisible();
  expect(scheduleEvent).not.toHaveBeenCalled();
});

it('includes an Aptem PSP summary in the page schedule picker', async () => {
  fetchEvents.mockResolvedValue({ owner: { name: 'Coach' }, events: [review(31, {
    id: 'imported-review:31', eventKey: 'imported-review:31', reviewSource: 'aptem', aptemReviewId: '31',
    importedReviewType: 'Personal Support Plan', reviewTemplateId: null, hasReviewForm: false,
  })] });
  fetchForm.mockResolvedValue(personalSupportBooking());
  mount('/coach/reviews');
  await screen.findByText('Learner 31');
  fireEvent.click(screen.getByRole('button', { name: 'Schedule review' }));
  fireEvent.click(screen.getByRole('button', { name: 'Continue to booking' }));
  await selectBookingTime();
  expect(await screen.findByRole('button', { name: 'Confirm booking' })).toBeEnabled();
  expect(scheduleEvent).not.toHaveBeenCalled();
});

function mount(initialPath = '/coach/progress-reviews') {
  return render(<MemoryRouter initialEntries={[initialPath]}>
    <Routes>
      <Route path="/coach/progress-reviews" element={<CoachProgressReviews key="pr" />} />
      <Route path="/coach/reviews" element={<CoachProgressReviews key="other" category="review" />} />
      <Route path="/coach/reviews/:eventKey" element={<div>Other review details page</div>} />
      <Route path="/coach/progress-reviews/:eventKey" element={<div>Review details page</div>} />
    </Routes>
    <LocationOutput />
  </MemoryRouter>);
}

beforeEach(() => {
  fetchSlots.mockReset().mockResolvedValue(['09:00', '10:00', '14:30', '15:00']);
  start.mockReset();
  adopt.mockReset();
  installDialogTestSupport();
  fetchForm.mockReset().mockResolvedValue(scheduledImportedBooking());
  book.mockReset().mockResolvedValue(scheduledImportedBooking());
  reschedule.mockReset().mockResolvedValue(scheduledImportedBooking());
  scheduleEvent.mockReset();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date('2026-09-14T10:00:00'));
  fetchEvents.mockReset();
  openReview.mockReset();
  openReview.mockResolvedValue({ instanceId: 'REVI-APTEM' });
  fetchEvents.mockResolvedValue({ owner: { name: 'Coach Example' }, events: reviews });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('progress review list navigation and filters', () => {
  it.each(['Progress Review', 'Progress Review (+ Skills Radar)', 'Personal Support Plan'])('starts %s from its row Join action', async type => {
    fetchEvents.mockResolvedValue({ events: [review(31, { eventKey: 'imported-review:31', reviewSource: 'aptem',
      importedReviewType: type, reviewTemplateId: null, status: 'scheduled', scheduledDate: '2026-09-14',
      scheduledTime: '10:00', calendarEventKey: 'legacy-calendar:91', meetingLink: 'https://example.invalid/teams' })] });
    start.mockResolvedValue({ ...scheduledImportedBooking(), localStatus: 'in-progress' });
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    mount(type === 'Personal Support Plan' ? '/coach/reviews' : '/coach/progress-reviews');
    await screen.findByText('Learner 31');
    expect(start).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'More actions for Learner 31' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Join' }));
    expect(open).toHaveBeenCalledWith('https://example.invalid/teams', '_blank', 'noopener,noreferrer');
    await waitFor(() => expect(start).toHaveBeenCalledWith('imported-review:31', expect.objectContaining({ calendarEventKey: 'legacy-calendar:91' })));
    open.mockRestore();
  });
  it.each(['Progress Review', 'Progress Review (+ Skills Radar)'])('keeps %s Reschedule open until the coach saves a new time', async importedReviewType => {
    const scheduled = scheduledImportedBooking();
    scheduled.template.reviewTypeCode = 'aptem_progress_review';
    fetchForm.mockResolvedValue({ ...scheduled, localStatus: 'not-scheduled',
      booking: { ...scheduled.booking!, canAttach: true, canReschedule: false } });
    adopt.mockResolvedValue(scheduled);
    fetchEvents.mockResolvedValue({ events: [review(31, { eventKey: 'imported-review:31',
      reviewSource: 'aptem', aptemReviewId: '31', importedReviewType, status: 'scheduled',
      calendarEventKey: scheduled.booking!.eventKey, scheduledDate: '2026-09-22', scheduledTime: '10:00', reviewTemplateId: null })] });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'More actions for Learner 31' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Reschedule' }));
    const save = await screen.findByRole('button', { name: 'Save new time' });
    expect(screen.getByRole('dialog')).toBeVisible();
    expect(adopt).toHaveBeenCalledOnce();
    await selectBookingTime('14:30');
    fireEvent.click(save);
    await screen.findByText('Review rescheduled.');
    expect(reschedule).toHaveBeenCalledWith('imported-review:31', expect.objectContaining({ scheduledTime: '14:30' }), scheduled.booking);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(book).not.toHaveBeenCalled();
  });
  it.each([
    ['/coach/progress-reviews', 'progress-review'],
    ['/coach/reviews', 'review'],
  ] as const)('shows incomplete identity coverage alongside available reviews on %s', async (path, source) => {
    fetchEvents.mockResolvedValue({ events: [review(2, { source, reviewTypeCode: source === 'review' ? 'career_review' : 'progress_review', learner: 'Available Learner' })],
      reviewGenerationIssues: [
        { learnerId: '40', code: 'review_identity_unavailable' },
        { learnerId: '41', code: 'review_identity_unavailable' },
      ] });
    const first = mount(path);
    await screen.findByText('Some reviews are unavailable');
    expect(screen.getByText(/2 learners need an enrolment record check/)).toBeVisible();
    expect(screen.getByText('Available Learner')).toBeVisible();
    first.unmount();
    fetchEvents.mockImplementation(() => new Promise(() => {}));
    mount(path);
    expect(screen.getByText('Some reviews are unavailable')).toBeVisible();
    expect(screen.getByText('Available Learner')).toBeVisible();
  });

  const mixedReviews = () => [
    review(60, { learner: 'PR Learner', importedReviewType: 'Progress Review', reviewSource: 'aptem' }),
    review(61, { learner: 'Radar Learner', importedReviewType: 'Progress Review (+ Skills Radar)', reviewSource: 'aptem' }),
    review(62, { id: 'imported-review:62', eventKey: 'imported-review:62', learner: 'Other Learner',
      importedReviewType: 'RPL and Experience', reviewSource: 'aptem', aptemReviewId: '62',
      reviewTemplateId: undefined, hasReviewForm: true, status: 'completed', reviewCompletedAt: '2026-09-10' }),
    review(63, { learner: 'MCM Learner', source: 'mcr', importedReviewType: 'Monthly Coaching Meeting', reviewSource: 'aptem' }),
    review(64, { learner: 'Native Other', source: 'review', title: 'Progress Review', reviewTypeCode: 'career_review',
      reviewTypeName: 'Career Review', reviewTemplateId: 'REV-CAREER' }),
  ];

  it('keeps only genuine PR and skills-radar reviews in the PR list and counters', async () => {
    fetchEvents.mockResolvedValue({ events: mixedReviews() });
    mount();
    expect(await screen.findByText('PR Learner')).toBeVisible();
    expect(screen.getByText('Radar Learner')).toBeVisible();
    expect(screen.queryByText('Other Learner')).toBeNull();
    expect(screen.queryByText('MCM Learner')).toBeNull();
    expect(screen.queryByText('Native Other')).toBeNull();
    expect(screen.getByRole('button', { name: 'All2' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Completed0' })).toBeVisible();
  });

  it('lists other imported and Curriculum reviews with original types and intact form links', async () => {
    fetchEvents.mockResolvedValue({ events: mixedReviews() });
    mount('/coach/reviews?month=2026-09&q=Other');
    expect(await screen.findByText('Other Learner')).toBeVisible();
    expect(screen.getByText('Native Other')).toBeVisible();
    expect(screen.getByText('RPL and Experience')).toBeVisible();
    expect(screen.getByText('Career Review')).toBeVisible();
    expect(screen.getByRole('columnheader', { name: 'Review type' })).toBeVisible();
    expect(screen.queryByRole('columnheader', { name: 'Last PR' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Bulk generate slides' })).toBeNull();
    expect(screen.queryByText('PR Learner')).toBeNull();
    expect(screen.queryByText('MCM Learner')).toBeNull();
    expect(screen.getByRole('button', { name: 'All2' })).toBeVisible();
    fireEvent.click(within(screen.getByText('Other Learner').closest('tr')!).getByRole('button', { name: 'View form' }));
    expect(screen.getByTestId('route')).toHaveTextContent('/coach/review-instances/imported-review%3A62');
    expect(openReview).not.toHaveBeenCalled();
  });

  it('keeps PR and Review caches separate and opens other-review details on their own route', async () => {
    fetchEvents.mockResolvedValue({ events: mixedReviews() });
    const first = mount();
    await screen.findByText('PR Learner');
    first.unmount();
    mount('/coach/reviews');
    expect(await screen.findByText('Other Learner')).toBeVisible();
    expect(screen.queryByText('PR Learner')).toBeNull();
    fireEvent.click(screen.getByText('Other Learner'));
    expect(await screen.findByText('Other review details page')).toBeVisible();
    expect(screen.getByTestId('route')).toHaveTextContent('/coach/reviews/imported-review%3A62');
  });

  it('uses the MCM month-scoped filters', async () => {
    mount();
    await screen.findByText('Scheduled Review');
    expect(fetchEvents).toHaveBeenCalledWith(expect.any(AbortSignal), {
      includeLiveSessions: false, includeSchedulerQueues: false,
    });
    const filters = within(screen.getByRole('navigation', { name: 'Filter progress reviews by status' }));
    expect(filters.getAllByRole('button').map(button => button.textContent)).toEqual([
      'All3', 'Not Scheduled1', 'Scheduled1', 'In Progress0', 'Awaiting Signature0', 'Completed1',
    ]);
    fireEvent.click(filters.getByRole('button', { name: 'Not Scheduled1' }));
    expect(screen.getByText('Needs Schedule')).toBeVisible();
    expect(screen.queryByText('Scheduled Review')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
    expect(await screen.findByText('Next Month Review')).toBeVisible();
    expect(fetchEvents).toHaveBeenCalledTimes(1);
    expect(filters.getByRole('button', { name: 'All1' })).toBeVisible();
  });

  it('shows reviews in their booked month across statuses even when the target month differs', async () => {
    fetchEvents.mockResolvedValue({ events: [
      review(20, { learner: 'Moved Scheduled', targetDate: '2026-09-20', scheduledDate: '2026-10-04', status: 'scheduled' }),
      review(21, { learner: 'October Completed', targetDate: '2026-10-12', status: 'completed' }),
      review(22, { learner: 'October Unscheduled', targetDate: '2026-10-15' }),
    ] });
    mount();
    await screen.findByText('0 progress reviews');
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
    expect(await screen.findByText('Moved Scheduled')).toBeVisible();
    const filters = within(screen.getByRole('navigation', { name: 'Filter progress reviews by status' }));
    expect(filters.getByRole('button', { name: 'All3' })).toBeVisible();
    expect(filters.getByRole('button', { name: 'Scheduled1' })).toBeVisible();
    expect(filters.getByRole('button', { name: 'Completed1' })).toBeVisible();
    expect(filters.getByRole('button', { name: 'Not Scheduled1' })).toBeVisible();
  });

  it('shows the latest completed PR with the dashboard age colours before the review date', async () => {
    fetchEvents.mockResolvedValue({ events: [
      review(30, { learner: 'History Learner', learnerId: '30', status: 'completed', scheduledDate: '2026-07-01', reviewCompletedAt: '2026-07-01T15:00:00Z' }),
      review(31, { learner: 'History Learner', learnerId: '30', status: 'scheduled', scheduledDate: '2026-09-22' }),
    ] });
    mount();
    const row = within((await screen.findByText('History Learner')).closest('tr')!);
    const headers = screen.getAllByRole('columnheader').map(header => header.textContent);
    expect(headers.indexOf('Last PR')).toBeLessThan(headers.indexOf('Scheduled for (UK time)'));
    expect(row.getByLabelText('Last PR: 01 Jul 2026; 75 days ago')).toHaveAttribute('data-tone', 'warning');
  });

  it('loads past and upcoming progress reviews across all months', async () => {
    mount();
    await screen.findByText('Scheduled Review');

    fireEvent.click(screen.getByRole('button', { name: 'All months' }));

    expect(await screen.findByText('Next Month Review')).toBeVisible();
    expect(screen.getByRole('button', { name: 'All months' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('route')).toHaveTextContent('months=all');
    expect(fetchEvents).toHaveBeenLastCalledWith(expect.any(AbortSignal), {
      includeLiveSessions: false, includeSchedulerQueues: false,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }));
    expect(screen.queryByText('Next Month Review')).toBeNull();
    expect(screen.getByRole('button', { name: 'All months' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('orders progress reviews from newest to oldest before pagination', async () => {
    mount();
    await screen.findByText('Scheduled Review');
    fireEvent.click(screen.getByRole('button', { name: 'All months' }));

    const rows = within(await screen.findByRole('table')).getAllByRole('row').slice(1);
    expect(rows.map(row => row.textContent)).toEqual([
      expect.stringContaining('Next Month Review'),
      expect.stringContaining('Scheduled Review'),
      expect.stringContaining('Needs Schedule'),
      expect.stringContaining('Completed Review'),
    ]);
  });

  it('keeps the last successful month visible when the coach returns to the page', async () => {
    const first = mount();
    expect(await screen.findByText('Scheduled Review')).toBeVisible();
    first.unmount();

    let finishRefresh!: (value: unknown) => void;
    fetchEvents.mockImplementation(() => new Promise(resolve => { finishRefresh = resolve; }));
    mount();

    expect(screen.getByText('Scheduled Review')).toBeVisible();
    expect(screen.queryByText('Loading progress reviews')).not.toBeInTheDocument();
    finishRefresh({ owner: { name: 'Coach Example' }, events: reviews });
  });

  it('opens View on the progress review detail page without expanding the row', async () => {
    mount();
    await screen.findByText('Scheduled Review');
    fireEvent.click(within(screen.getByText('Scheduled Review').closest('tr')!).getByRole('button', { name: 'More actions for Scheduled Review' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'View details' }));
    expect(await screen.findByText('Review details page')).toBeVisible();
    expect(screen.getByTestId('route')).toHaveTextContent('/coach/progress-reviews/progress-review%3A2');
  });

  it('moves Schedule into the MCM-style actions menu', async () => {
    mount();
    const learner = await screen.findByText('Needs Schedule');
    const table = learner.closest('table')!;
    expect(within(table).queryByRole('columnheader', { name: 'Schedule' })).toBeNull();

    const row = within(learner.closest('tr')!);
    fireEvent.click(row.getByRole('button', { name: 'More actions for Needs Schedule' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Schedule' }));

    expect(screen.getByRole('dialog', { name: 'Schedule progress review' })).toBeVisible();
  });

  it('removes Schedule from progress reviews that cannot be booked', async () => {
    fetchEvents.mockResolvedValue({ events: [
      review(10, { learner: 'In Progress Review', status: 'in-progress', scheduledDate: '2026-09-14' }),
      review(11, { learner: 'Awaiting Review', status: 'awaiting-signature', scheduledDate: '2026-09-14' }),
      review(12, { learner: 'Completed Review', status: 'completed', scheduledDate: '2026-09-14' }),
    ] });
    mount();
    await screen.findByText('In Progress Review');
    for (const learner of ['In Progress Review', 'Awaiting Review', 'Completed Review']) {
      const row = within(screen.getByText(learner).closest('tr')!);
      expect(row.queryByRole('button', { name: /Schedule/ })).toBeNull();
      fireEvent.click(row.getByRole('button', { name: `More actions for ${learner}` }));
      const menu = screen.getByRole('menu', { name: `Actions for ${learner}` });
      expect(within(menu).queryByRole('menuitem', { name: /Schedule/ })).toBeNull();
      fireEvent.keyDown(menu, { key: 'Escape' });
    }
  });

  it('routes imported Aptem reviews to their own booking form', async () => {
    fetchEvents.mockResolvedValue({ events: [
      review(20, { id: 'imported-review:20', eventKey: 'imported-review:20', learner: 'Imported Unscheduled', status: 'not-scheduled', reviewSource: 'aptem', aptemReviewId: '20', hasReviewForm: false, reviewTemplateId: undefined }),
      review(21, { id: 'imported-review:21', eventKey: 'imported-review:21', learner: 'Imported Scheduled', status: 'confirmed', scheduledDate: '2026-09-23', scheduledTime: '11:00', reviewSource: 'aptem', aptemReviewId: '21', hasReviewForm: false, reviewTemplateId: undefined }),
    ] });
    mount();
    await screen.findByText('Imported Scheduled');

    const unscheduledRow = within(screen.getByText('Imported Unscheduled').closest('tr')!);
    expect(unscheduledRow.getByRole('button', { name: 'View form' })).toBeVisible();
    expect(unscheduledRow.queryByRole('button', { name: 'Schedule' })).not.toBeInTheDocument();
    expect(within(screen.getByText('Imported Scheduled').closest('tr')!).queryByRole('button', { name: 'Reschedule' })).not.toBeInTheDocument();

    const scheduledRow = within(screen.getByText('Imported Scheduled').closest('tr')!);
    expect(scheduledRow.getByRole('button', { name: 'View form' })).toBeVisible();
    expect(scheduledRow.getByRole('button', { name: 'More actions for Imported Scheduled' })).toBeVisible();
    fireEvent.click(scheduledRow.getByRole('button', { name: 'View form' }));
    expect(screen.getByTestId('route')).toHaveTextContent('/coach/review-instances/imported-review%3A21');
    expect(openReview).not.toHaveBeenCalled();
  });

  it('opens a Scheduled imported booking in a direct reschedule dialog', async () => {
    fetchEvents.mockResolvedValue({ events: [review(31, { eventKey: 'imported-review:31',
      learner: 'Imported booking', status: 'scheduled', scheduledDate: '2026-09-22',
      reviewSource: 'aptem', calendarEventKey: 'imported-review:31', reviewTemplateId: undefined })] });
    mount();
    await screen.findByText('Imported booking');
    fireEvent.click(screen.getByRole('button', { name: 'More actions for Imported booking' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Reschedule' }));
    await selectBookingTime('10:00');
    fireEvent.click(await screen.findByRole('button', { name: 'Save new time' }));
    expect(await screen.findByText('Review rescheduled.')).toBeVisible();
    expect(screen.getByTestId('route')).toHaveTextContent('/coach/progress-reviews');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(reschedule).toHaveBeenCalledWith('imported-review:31', expect.any(Object), scheduledImportedBooking().booking);
    expect(scheduleEvent).not.toHaveBeenCalled();
  });

  it.each(['Progress Review', 'Progress Review (+ Skills Radar)'])('books an Aptem %s from the row and keeps the updated row in cache', async importedReviewType => {
    fetchForm.mockResolvedValue(importedBookingDefinition());
    fetchEvents.mockResolvedValue({ events: [review(31, { eventKey: 'imported-review:31', learner: 'Imported learner',
      reviewSource: 'aptem', aptemReviewId: '31', importedReviewType }), review(32, { learner: 'Unaffected learner' })] });
    const view = mount();
    await screen.findByText('Imported learner');
    fireEvent.click(screen.getByRole('button', { name: 'More actions for Imported learner' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Schedule' }));
    await selectBookingTime();
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm booking' }));
    await screen.findByText('Review scheduled.');
    expect(within(screen.getByText('Imported learner').closest('tr')!).getByText('Scheduled')).toBeVisible();
    expect(within(screen.getByText('Unaffected learner').closest('tr')!).getByText('Not Scheduled')).toBeVisible();
    expect(book).toHaveBeenCalledWith('imported-review:31', expect.any(Object));
    expect(scheduleEvent).not.toHaveBeenCalled();
    view.unmount();
    fetchEvents.mockImplementation(() => new Promise(() => {}));
    mount();
    expect(within(screen.getByText('Imported learner').closest('tr')!).getByText('Scheduled')).toBeVisible();
  });

  it('opens an imported Aptem View Form directly instead of the learner profile', async () => {
    fetchEvents.mockResolvedValue({ events: [
      review(21, { id: 'imported-review:21', eventKey: 'imported-review:21', learner: 'Imported Completed', status: 'completed', scheduledDate: '2026-09-23', reviewSource: 'aptem', aptemReviewId: '21', hasReviewForm: true }),
    ] });
    mount();
    const row = within((await screen.findByText('Imported Completed')).closest('tr')!);
    fireEvent.click(row.getByRole('button', { name: 'View form' }));
    expect(screen.getByTestId('route')).toHaveTextContent('/coach/review-instances/imported-review%3A21');
    expect(screen.getByTestId('route')).not.toHaveTextContent('/coach/learner-case-file');
  });

  it.each(['Progress Review', 'Progress Review (+ Skills Radar)', 'Personal Support Plan'])(
  'keeps the saved LMS form accessible for completed and reopened %s rows', async importedReviewType => {
    const states = ['completed', 'in-progress', 'awaiting-signature'] as const;
    fetchEvents.mockResolvedValue({ events: [
      ...states.map((status, index) => review(61 + index, {
        id: `imported-review:${61 + index}`, eventKey: `imported-review:${61 + index}`,
        learner: `Saved form ${status}`, reviewSource: 'aptem', aptemReviewId: String(61 + index),
        importedReviewType, reviewTemplateId: null, reviewInstanceId: null,
        hasReviewForm: true, sourceStatus: 'completed', status,
        reviewCompletedAt: status === 'completed' ? '2026-09-10T10:00:00Z' : null,
      })),
      review(64, { learner: 'Source summary only', eventKey: 'imported-review:64',
        reviewSource: 'aptem', aptemReviewId: '64', importedReviewType,
        reviewTemplateId: null, reviewInstanceId: null, hasReviewForm: false, status: 'completed' }),
    ] });
    mount(importedReviewType === 'Personal Support Plan' ? '/coach/reviews' : '/coach/progress-reviews');
    await screen.findByText('Saved form completed');
    for (const [index, status] of states.entries()) {
      const row = within(screen.getByText(`Saved form ${status}`).closest('tr')!);
      expect(row.getByRole('button', { name: 'View form' })).toBeVisible();
      expect(row.getByText(['Completed', 'In Progress', 'Awaiting Signature'][index])).toBeVisible();
      if (status !== 'completed') expect(row.queryByText('10 Sept 2026')).not.toBeInTheDocument();
    }
    expect(within(screen.getByText('Source summary only').closest('tr')!)
      .queryByRole('button', { name: 'View form' })).not.toBeInTheDocument();
    fireEvent.click(within(screen.getByText('Saved form completed').closest('tr')!)
      .getByRole('button', { name: 'View form' }));
    expect(screen.getByTestId('route')).toHaveTextContent('/coach/review-instances/imported-review%3A61');
    expect(openReview).not.toHaveBeenCalled();
  });

  it('opens Curriculum questions for a non-terminal imported Aptem review', async () => {
    fetchEvents.mockResolvedValue({ events: [
      review(22, { id: 'imported-review:22', eventKey: 'imported-review:22', learner: 'Imported Draft', status: 'confirmed', scheduledDate: '2026-09-23', scheduledTime: '11:00', reviewSource: 'aptem', aptemReviewId: '22', hasReviewForm: true, reviewTemplateId: undefined }),
    ] });
    mount();
    fireEvent.click(within((await screen.findByText('Imported Draft')).closest('tr')!).getByRole('button', { name: 'View form' }));
    expect(screen.getByTestId('route')).toHaveTextContent('/coach/review-instances/imported-review%3A22');
    expect(openReview).not.toHaveBeenCalled();
  });

  it('opens the page scheduler and allows choosing the progress review learner', async () => {
    mount();
    await screen.findByText('Needs Schedule');

    fireEvent.click(screen.getByRole('button', { name: 'Schedule review' }));

    const dialog = screen.getByRole('dialog', { name: 'Schedule progress review' });
    const learnerSelect = within(dialog).getByRole('combobox', { name: 'Learner' });
    expect(learnerSelect).toHaveValue('progress-review:1');
    fireEvent.change(learnerSelect, { target: { value: 'progress-review:2' } });
    expect(within(dialog).getByText('Scheduled Review')).toBeVisible();
  });
});


it.each(['/coach/progress-reviews', '/coach/reviews'])('separates row completion from schedule on %s', async path => {
  fetchEvents.mockResolvedValue({ events: [review(80, {
    learner: 'Date Example', status: 'completed', scheduledDate: '2026-09-10', scheduledTime: '23:00',
    reviewCompletedAt: '2026-09-11T07:00:00Z',
    ...(path === '/coach/reviews' ? { reviewSource: 'aptem', aptemReviewId: '80', importedReviewType: 'Personal Support Plan', calendarEventKey: 'imported-review:80' } : {}),
  })] });
  mount(path);
  const row = within((await screen.findByText('Date Example')).closest('tr')!);
  const headers = screen.getAllByRole('columnheader').map(header => header.textContent);
  expect(headers).toContain('Completed on');
  expect(row.getAllByRole('cell')[headers.indexOf('Completed on')]).toHaveTextContent('11 Sept 2026');
  expect(row.getAllByRole('cell')[headers.indexOf('Scheduled for (UK time)')]).toHaveTextContent('10 Sept 2026');
  expect(row.getByText('23:00 - 00:00 (+1 day)')).toBeVisible();
  if (path === '/coach/progress-reviews') expect(row.getByLabelText('Last PR: 11 Sept 2026; 3 days ago')).toBeVisible();
  else expect(headers).toContain('Review type');
});
