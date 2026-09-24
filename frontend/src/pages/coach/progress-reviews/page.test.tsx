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
    const filters = within(screen.getByRole('navigation', { name: 'Filter progress reviews by status' }));
    expect(filters.getAllByRole('button').map(button => button.textContent)).toEqual([
      'All3', 'Not Scheduled1', 'Scheduled1', 'In Progress0', 'Awaiting Signature0', 'Completed1',
    ]);
    fireEvent.click(filters.getByRole('button', { name: 'Not Scheduled1' }));
    expect(screen.getByText('Needs Schedule')).toBeVisible();
    expect(screen.queryByText('Scheduled Review')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
    expect(await screen.findByText('Next Month Review')).toBeVisible();
    expect(filters.getByRole('button', { name: 'All1' })).toBeVisible();
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

  it('restores Schedule and Reschedule popups for imported Aptem reviews', async () => {
    fetchEvents.mockResolvedValue({ events: [
      review(20, { id: 'imported-review:20', eventKey: 'imported-review:20', learner: 'Imported Unscheduled', status: 'not-scheduled', reviewSource: 'aptem', aptemReviewId: '20', hasReviewForm: true }),
      review(21, { id: 'imported-review:21', eventKey: 'imported-review:21', learner: 'Imported Scheduled', status: 'confirmed', scheduledDate: '2026-09-23', scheduledTime: '11:00', reviewSource: 'aptem', aptemReviewId: '21', hasReviewForm: true }),
    ] });
    mount();
    await screen.findByText('Imported Scheduled');

    fireEvent.click(within(screen.getByText('Imported Unscheduled').closest('tr')!).getByRole('button', { name: 'Schedule' }));
    expect(screen.getByRole('dialog', { name: 'Schedule progress review' })).toBeVisible();
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Schedule progress review' })).getByRole('button', { name: 'Cancel' }));

    fireEvent.click(within(screen.getByText('Imported Scheduled').closest('tr')!).getByRole('button', { name: 'Reschedule' }));
    expect(screen.getByRole('dialog', { name: 'Reschedule progress review' })).toBeVisible();
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Reschedule progress review' })).getByRole('button', { name: 'Cancel' }));

    const scheduledRow = within(screen.getByText('Imported Scheduled').closest('tr')!);
    expect(scheduledRow.getAllByRole('button').map(button => button.textContent)).toEqual([
      'Reschedule', 'View', 'View Form', 'Create Slides',
    ]);
    fireEvent.click(scheduledRow.getByRole('button', { name: 'View' }));
    expect(screen.getByTestId('route')).toHaveTextContent('/coach/progress-reviews/imported-review%3A21');
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
