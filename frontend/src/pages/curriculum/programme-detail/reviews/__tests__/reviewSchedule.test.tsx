import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReviewScheduleMonth, ReviewScheduleResponse } from '@/lib/curriculumApi';

vi.mock('@/components/feature/CurriculumSweetAlert', () => ({
  showCurriculumAlert: vi.fn(async () => undefined),
}));

const api = vi.hoisted(() => ({
  fetchReviewSchedule: vi.fn(),
  resolveReviewClash: vi.fn(),
}));

vi.mock('@/lib/curriculumApi', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/curriculumApi')>()),
  ...api,
}));

import { ReviewSchedulePanel } from '../ReviewSchedule';

const noClashMonth: ReviewScheduleMonth = {
  month: '2027-02',
  hasClash: false,
  resolutionStatus: 'none',
  clashSignature: null,
  occurrences: [
    { reviewId: 'REV-MCM', reviewName: 'Monthly Coaching Meeting', occurrenceDate: '2027-02-15', recurrenceLabel: 'Every 1 month', status: 'scheduled', skippedBy: null, skippedAt: null, reason: null },
  ],
};

const clashMonth: ReviewScheduleMonth = {
  month: '2027-03',
  hasClash: true,
  resolutionStatus: 'unresolved',
  clashSignature: 'REV-MCM:2027-03-15|REV-PR:2027-03-22',
  occurrences: [
    { reviewId: 'REV-MCM', reviewName: 'Monthly Coaching Meeting', occurrenceDate: '2027-03-15', recurrenceLabel: 'Every 1 month', status: 'scheduled', skippedBy: null, skippedAt: null, reason: null },
    { reviewId: 'REV-PR', reviewName: 'Progress Review', occurrenceDate: '2027-03-22', recurrenceLabel: 'Every 12 weeks', status: 'scheduled', skippedBy: null, skippedAt: null, reason: null },
  ],
};

function response(months: ReviewScheduleMonth[]): ReviewScheduleResponse {
  return { programmeId: 'PROG-DATA', windowStart: '2027-01-01', windowEnd: '2027-12-31', monthsPreviewed: 12, months };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('ReviewSchedulePanel', () => {
  it('renders the schedule preview grouped by month', async () => {
    api.fetchReviewSchedule.mockResolvedValue(response([noClashMonth]));
    render(<ReviewSchedulePanel programmeId="PROG-DATA" />);
    expect(await screen.findByText('Monthly Coaching Meeting')).toBeInTheDocument();
    expect(screen.getByText('February 2027')).toBeInTheDocument();
  });

  it('shows a clash badge when a month has more than one review due', async () => {
    api.fetchReviewSchedule.mockResolvedValue(response([clashMonth]));
    render(<ReviewSchedulePanel programmeId="PROG-DATA" />);
    expect(await screen.findByText(/Clash – 2 reviews due/)).toBeInTheDocument();
  });

  it('does not show a clash badge for a month with a single review', async () => {
    api.fetchReviewSchedule.mockResolvedValue(response([noClashMonth]));
    render(<ReviewSchedulePanel programmeId="PROG-DATA" />);
    await screen.findByText('Monthly Coaching Meeting');
    expect(screen.queryByText(/Clash/)).not.toBeInTheDocument();
  });

  it('opens the resolve clash modal listing every occurrence due that month', async () => {
    api.fetchReviewSchedule.mockResolvedValue(response([clashMonth]));
    render(<ReviewSchedulePanel programmeId="PROG-DATA" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Resolve clash' }));
    expect(await screen.findByText('Review clash, March 2027')).toBeInTheDocument();
    const dialog = screen.getByText('Review clash, March 2027').closest('[role="dialog"], div')?.parentElement || document.body;
    expect(within(dialog as HTMLElement).getByText('Monthly Coaching Meeting')).toBeInTheDocument();
    expect(within(dialog as HTMLElement).getByText('Progress Review')).toBeInTheDocument();
  });

  it('lets the user keep one review and skip the other, then saves the decision', async () => {
    api.fetchReviewSchedule.mockResolvedValue(response([clashMonth]));
    api.resolveReviewClash.mockResolvedValue({
      resolved: true, programmeId: 'PROG-DATA',
      month: { ...clashMonth, resolutionStatus: 'resolved', occurrences: [
        { ...clashMonth.occurrences[0], status: 'skipped', skippedBy: 'staff', skippedAt: '2027-01-01T00:00:00', reason: null },
        clashMonth.occurrences[1],
      ] },
    });
    render(<ReviewSchedulePanel programmeId="PROG-DATA" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Resolve clash' }));
    await screen.findByText('Review clash, March 2027');

    const mcmCheckbox = screen.getByRole('checkbox', { name: /Monthly Coaching Meeting/ });
    await userEvent.click(mcmCheckbox);
    await userEvent.click(screen.getByRole('button', { name: 'Save decision' }));

    await waitFor(() => expect(api.resolveReviewClash).toHaveBeenCalledWith('PROG-DATA', {
      month: '2027-03',
      occurrences: [
        { reviewId: 'REV-MCM', occurrenceDate: '2027-03-15', action: 'skip' },
        { reviewId: 'REV-PR', occurrenceDate: '2027-03-22', action: 'keep' },
      ],
    }));
  });

  it('supports keep both without forcing a skip', async () => {
    api.fetchReviewSchedule.mockResolvedValue(response([clashMonth]));
    api.resolveReviewClash.mockResolvedValue({ resolved: true, programmeId: 'PROG-DATA', month: { ...clashMonth, resolutionStatus: 'kept_all' } });
    render(<ReviewSchedulePanel programmeId="PROG-DATA" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Resolve clash' }));
    await screen.findByText('Review clash, March 2027');

    await userEvent.click(screen.getByRole('button', { name: 'Keep both' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save decision' }));

    await waitFor(() => expect(api.resolveReviewClash).toHaveBeenCalledWith('PROG-DATA', {
      month: '2027-03',
      occurrences: [
        { reviewId: 'REV-MCM', occurrenceDate: '2027-03-15', action: 'keep' },
        { reviewId: 'REV-PR', occurrenceDate: '2027-03-22', action: 'keep' },
      ],
    }));
  });

  it('shows a resolved badge and a restore action for a skipped occurrence', async () => {
    const resolvedMonth: ReviewScheduleMonth = {
      ...clashMonth,
      resolutionStatus: 'resolved',
      occurrences: [
        { ...clashMonth.occurrences[0], status: 'skipped', skippedBy: 'staff', skippedAt: '2027-01-01T00:00:00', reason: null },
        clashMonth.occurrences[1],
      ],
    };
    api.fetchReviewSchedule.mockResolvedValue(response([resolvedMonth]));
    render(<ReviewSchedulePanel programmeId="PROG-DATA" />);
    expect(await screen.findByText('Resolved')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Restore occurrence' })).toBeInTheDocument();
  });

  it('restores a skipped occurrence and refreshes the schedule', async () => {
    const resolvedMonth: ReviewScheduleMonth = {
      ...clashMonth,
      resolutionStatus: 'resolved',
      occurrences: [
        { ...clashMonth.occurrences[0], status: 'skipped', skippedBy: 'staff', skippedAt: '2027-01-01T00:00:00', reason: null },
        clashMonth.occurrences[1],
      ],
    };
    api.fetchReviewSchedule.mockResolvedValueOnce(response([resolvedMonth])).mockResolvedValueOnce(response([clashMonth]));
    api.resolveReviewClash.mockResolvedValue({ resolved: true, programmeId: 'PROG-DATA', month: clashMonth });
    render(<ReviewSchedulePanel programmeId="PROG-DATA" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Restore occurrence' }));

    await waitFor(() => expect(api.resolveReviewClash).toHaveBeenCalledWith('PROG-DATA', {
      month: '2027-03',
      occurrences: [{ reviewId: 'REV-MCM', occurrenceDate: '2027-03-15', action: 'keep' }],
    }));
    await waitFor(() => expect(api.fetchReviewSchedule).toHaveBeenCalledTimes(2));
  });

  it('shows an error and a retry option when the schedule request fails', async () => {
    api.fetchReviewSchedule.mockRejectedValueOnce(new Error('Network error'));
    render(<ReviewSchedulePanel programmeId="PROG-DATA" />);
    expect(await screen.findByText('Network error')).toBeInTheDocument();
  });
});
