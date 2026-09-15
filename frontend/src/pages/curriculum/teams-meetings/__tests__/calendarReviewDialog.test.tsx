import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Swal from 'sweetalert2';
import { reviewCalendar, TeamsReviewCancelled } from '../calendarReview';

const calendar = {
  title: 'Synthetic module', organizerEmail: 'organizer@example.invalid', attendees: ['learner@example.invalid'],
  scheduledOccurrences: [{ sessionNumber: 1, startDateTimeUtc: '2026-09-17T11:00:00Z', durationMinutes: 120 }],
};

beforeEach(() => { vi.stubGlobal('scrollTo', vi.fn()); });
afterEach(() => { Swal.close(); vi.unstubAllGlobals(); });

it('shows the schedule and requires review before confirming', async () => {
  let confirmed = false;
  const pending = reviewCalendar(calendar, 'Europe/London').then(() => { confirmed = true; });
  expect(await screen.findByRole('dialog')).toBeVisible();
  expect(screen.getByRole('table', { name: '1 reviewed sessions' })).toBeVisible();
  expect(screen.getByText(/Thu, 17 Sept 2026, 12:00 PM/)).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Confirm and send' }));
  expect(await screen.findByText('Confirm that you have reviewed this calendar.')).toBeVisible();
  expect(confirmed).toBe(false);
  await userEvent.click(screen.getByRole('checkbox'));
  await userEvent.click(screen.getByRole('button', { name: 'Confirm and send' }));
  await pending;
  await waitFor(() => expect(confirmed).toBe(true));
});

it('returns to editing without confirmation', async () => {
  const pending = reviewCalendar(calendar, 'Europe/London');
  const cancelled = expect(pending).rejects.toBeInstanceOf(TeamsReviewCancelled);
  await userEvent.click(await screen.findByRole('button', { name: 'Back to editing' }));
  await cancelled;
});
