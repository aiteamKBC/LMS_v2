import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { CoachCalendarEvent } from '../shared/calendarEvents';
import CoachProgressReviews from './page';

const { fetchEvents, openReview, coach } = vi.hoisted(() => ({
  fetchEvents: vi.fn(),
  openReview: vi.fn(),
  coach: { email: 'coach@example.com', name: 'Coach Example', isInitialized: true, isViewingAsCoach: false },
}));

vi.mock('@/components/feature/WorkspaceShell', () => ({ WorkspaceShell: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock('@/hooks/useCoachIdentity', () => ({ useCoachIdentity: () => coach }));
vi.mock('./components/ProgressReviewPptxModal', () => ({ default: () => null }));
vi.mock('../shared/ProgressReviewCompletionModal', () => ({ default: () => null }));
vi.mock('../shared/calendarEvents', async importOriginal => ({
  ...(await importOriginal<typeof import('../shared/calendarEvents')>()),
  fetchCoachCalendarEvents: fetchEvents,
}));
vi.mock('@/api/progressReviews', () => ({
  fetchLatestRun: vi.fn().mockResolvedValue({ exists: false }),
  bulkGenerateProgressReviews: vi.fn(),
}));
vi.mock('@/api/reviewInstances', () => ({ openReviewInstanceForEvent: openReview }));

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

function mount() {
  return render(<MemoryRouter initialEntries={['/coach/progress-reviews']}>
    <Routes>
      <Route path="/coach/progress-reviews" element={<CoachProgressReviews />} />
      <Route path="/coach/progress-reviews/:eventKey" element={<div>Review details page</div>} />
    </Routes>
    <LocationOutput />
  </MemoryRouter>);
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date('2026-09-14T10:00:00'));
  fetchEvents.mockReset();
  openReview.mockReset();
  openReview.mockResolvedValue({ instanceId: 'REVI-APTEM' });
  fetchEvents.mockResolvedValue({ owner: { name: 'Coach Example' }, events: reviews });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('progress review list navigation and filters', () => {
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
    fireEvent.click(within(screen.getByText('Scheduled Review').closest('tr')!).getByRole('button', { name: 'View' }));
    expect(await screen.findByText('Review details page')).toBeVisible();
    expect(screen.getByTestId('route')).toHaveTextContent('/coach/progress-reviews/progress-review%3A2');
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
      expect(within(screen.getByText(learner).closest('tr')!).queryByRole('button', { name: /Schedule/ })).toBeNull();
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
    expect(unscheduledRow.getByRole('button', { name: 'View Form' })).toBeVisible();
    expect(unscheduledRow.queryByRole('button', { name: 'Schedule' })).not.toBeInTheDocument();
    expect(within(screen.getByText('Imported Scheduled').closest('tr')!).queryByRole('button', { name: 'Reschedule' })).not.toBeInTheDocument();

    const scheduledRow = within(screen.getByText('Imported Scheduled').closest('tr')!);
    expect(scheduledRow.getAllByRole('button').map(button => button.textContent)).toEqual([
      'View', 'View Form', 'Create Slides',
    ]);
    fireEvent.click(scheduledRow.getByRole('button', { name: 'View Form' }));
    expect(screen.getByTestId('route')).toHaveTextContent('/coach/review-instances/imported-review%3A21');
    expect(openReview).not.toHaveBeenCalled();
  });

  it('opens an imported Aptem View Form directly instead of the learner profile', async () => {
    fetchEvents.mockResolvedValue({ events: [
      review(21, { id: 'imported-review:21', eventKey: 'imported-review:21', learner: 'Imported Completed', status: 'completed', scheduledDate: '2026-09-23', reviewSource: 'aptem', aptemReviewId: '21', hasReviewForm: true }),
    ] });
    mount();
    const row = within((await screen.findByText('Imported Completed')).closest('tr')!);
    fireEvent.click(row.getByRole('button', { name: 'View Form' }));
    expect(screen.getByTestId('route')).toHaveTextContent('/coach/review-instances/imported-review%3A21');
    expect(screen.getByTestId('route')).not.toHaveTextContent('/coach/learner-case-file');
  });

  it('opens Curriculum questions for a non-terminal imported Aptem review', async () => {
    fetchEvents.mockResolvedValue({ events: [
      review(22, { id: 'imported-review:22', eventKey: 'imported-review:22', learner: 'Imported Draft', status: 'confirmed', scheduledDate: '2026-09-23', scheduledTime: '11:00', reviewSource: 'aptem', aptemReviewId: '22', hasReviewForm: true, reviewTemplateId: undefined }),
    ] });
    mount();
    fireEvent.click(within((await screen.findByText('Imported Draft')).closest('tr')!).getByRole('button', { name: 'View Form' }));
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
