import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CoachCalendarEvent } from './calendarEvents';
import { CoachNextReviewBookingDialog } from './CoachNextReviewBookingDialog';
import { installDialogTestSupport } from './__tests__/importedBookingFixtures';

const schedule = vi.hoisted(() => vi.fn());
vi.mock('./calendarEvents', async importOriginal => ({
  ...await importOriginal<typeof import('./calendarEvents')>(),
  scheduleCoachCalendarEvent: schedule,
}));

const next = {
  id: 'next-mcm-3', eventKey: 'next-mcm-3', source: 'mcr', status: 'not-scheduled',
  reviewTypeCode: 'mcm', targetDate: '2026-12-10', title: 'MCM 3', learner: 'Example Learner',
} as CoachCalendarEvent;

beforeEach(() => { installDialogTestSupport(); schedule.mockResolvedValue({ event: next }); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it('books the selected next meeting in a dialog without leaving the review', async () => {
  const onBooked = vi.fn();
  render(<CoachNextReviewBookingDialog event={next} onClose={vi.fn()} onBooked={onBooked} />);
  expect(screen.getByRole('dialog', { name: 'Book next Monthly Coaching Meeting' })).toBeVisible();
  fireEvent.change(screen.getByLabelText('Time · UK time'), { target: { value: '10:30' } });
  fireEvent.click(screen.getByRole('button', { name: 'Confirm booking' }));
  await waitFor(() => expect(schedule).toHaveBeenCalledWith(next, {
    date: '2026-12-10', time: '10:30', durationMinutes: 60,
  }));
  expect(onBooked).toHaveBeenCalledWith(next, undefined);
});
