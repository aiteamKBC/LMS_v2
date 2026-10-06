import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CalendarActionDialog, type CalendarActionTarget } from '../CalendarActionDialog';
import { calendarAction } from '../calendarActions';
import type { ActionReview } from '../calendarActions';
import { submitChangeEmails } from '../scheduleEmail';

vi.mock('../calendarActions', () => ({ calendarAction: vi.fn() }));
vi.mock('../scheduleEmail', () => ({ submitChangeEmails: vi.fn() }));
const target: CalendarActionTarget = { liveId: 'LIVE-1', moduleId: 'MODULE-1', title: 'Synthetic module',
  action: 'cancel', scope: 'occurrence', timeZone: 'GMT Standard Time',
  occurrences: [{ session_number: 2, scheduled_start: '2099-11-05T12:00:00Z', scheduled_end: '2099-11-05T14:00:00Z', status: 'scheduled' }] };
const review: ActionReview = { reviewToken: 'signed-review', title: 'Synthetic module', organizer: 'owner@example.invalid',
  timeZone: 'Europe/London', action: 'cancel', scope: 'occurrence', notificationRequired: true, calendarRequests: 1,
  sessions: [{ sessionNumber: 2, startDateTimeUtc: target.occurrences[0].scheduled_start, endDateTimeUtc: target.occurrences[0].scheduled_end, joinUrl: 'https://example.invalid' }] };
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(submitChangeEmails).mockResolvedValue({ total: 1, accepted: 1, queued: 0, failed: 0, uncertain: 0, status: 'complete' });
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Unexpected network'); }));
});
afterEach(() => vi.unstubAllGlobals());

it('only sends after explicit confirmation, never on the review checkbox', async () => {
  const user = userEvent.setup();
  const changed = vi.fn(async () => undefined);
  vi.mocked(calendarAction).mockResolvedValueOnce(review).mockResolvedValueOnce({ status: 'done', message: 'Cancelled', completed: 1, total: 1 });
  render(<CalendarActionDialog target={target} onClose={vi.fn()} onChanged={changed} />);
  expect(calendarAction).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Review changes' }));
  expect(await screen.findByRole('button', { name: 'Confirm cancellation' })).toBeDisabled();
  expect(screen.getByText(/12:00 PM/)).toBeInTheDocument();
  await user.click(screen.getByRole('checkbox', { name: /I checked/ }));
  expect(calendarAction).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole('button', { name: 'Confirm cancellation' }));
  expect(screen.getByText('Cancelled', { selector: 'span' })).toBeInTheDocument();
  expect(vi.mocked(calendarAction).mock.calls[1]).toEqual(['LIVE-1', {
    stage: 'confirm', reviewToken: 'signed-review', acknowledgeNotifications: true,
  }]);
  expect(changed).toHaveBeenCalledOnce();
});

it('shows that a cancellation is in progress while Microsoft is processing it', async () => {
  const user = userEvent.setup();
  let resolveConfirm!: (value: { status: 'uncertain'; message: string }) => void;
  const confirm = new Promise<{ status: 'uncertain'; message: string }>(resolve => { resolveConfirm = resolve; });
  vi.mocked(calendarAction).mockResolvedValueOnce(review).mockReturnValueOnce(confirm);
  render(<CalendarActionDialog target={target} onClose={vi.fn()} onChanged={vi.fn(async () => undefined)} />);

  await user.click(screen.getByRole('button', { name: 'Review changes' }));
  await user.click(await screen.findByRole('checkbox', { name: /I checked/ }));
  await user.click(screen.getByRole('button', { name: 'Confirm cancellation' }));

  expect(await screen.findByText('Cancellation in progress')).toBeInTheDocument();
  expect(screen.getByText(/Microsoft is processing the cancellation/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled();

  resolveConfirm({ status: 'uncertain', message: 'Microsoft is still processing the cancellation.' });
  expect(await screen.findByText('Cancellation awaiting confirmation')).toBeInTheDocument();
  expect(screen.getByText(/Use “Check action status” to refresh safely/)).toBeInTheDocument();
});

it('closing the dialog never cancels anything', async () => {
  const onClose = vi.fn();
  render(<CalendarActionDialog target={target} onClose={onClose} onChanged={vi.fn()} />);
  fireEvent.click(screen.getByText('Close', { selector: 'button' }));
  expect(onClose).toHaveBeenCalledOnce();
  expect(calendarAction).not.toHaveBeenCalled();
});

it('reconciles an earlier uncertain action before reviewing another cancellation', async () => {
  const user = userEvent.setup();
  const changed = vi.fn(async () => undefined);
  vi.mocked(calendarAction).mockRejectedValueOnce(new Error('A previous action needs a status check before another change can be made.'))
    .mockResolvedValueOnce({ status: 'done', message: 'Previous cancellation confirmed.' })
    .mockResolvedValueOnce(review);
  render(<CalendarActionDialog target={target} onClose={vi.fn()} onChanged={changed} />);
  await user.click(screen.getByRole('button', { name: 'Review changes' }));
  expect(await screen.findByRole('checkbox', { name: /I checked/ })).toBeInTheDocument();
  expect(changed).toHaveBeenCalledOnce();
  expect(vi.mocked(calendarAction).mock.calls).toEqual([
    ['LIVE-1', { stage: 'review', action: 'cancel', scope: 'occurrence', sessionNumber: 2, comment: '' }],
    ['LIVE-1', { stage: 'status' }],
    ['LIVE-1', { stage: 'review', action: 'cancel', scope: 'occurrence', sessionNumber: 2, comment: '' }],
  ]);
});

it('offers an explicit previous-action check when Microsoft is still uncertain', async () => {
  const user = userEvent.setup();
  vi.mocked(calendarAction).mockRejectedValueOnce(new Error('A previous action needs a status check before another change can be made.'))
    .mockResolvedValueOnce({ status: 'uncertain', message: 'Some changes are not confirmed.' })
    .mockResolvedValueOnce({ status: 'done', message: 'Previous cancellation confirmed.' })
    .mockResolvedValueOnce(review);
  render(<CalendarActionDialog target={target} onClose={vi.fn()} onChanged={vi.fn(async () => undefined)} />);
  await user.click(screen.getByRole('button', { name: 'Review changes' }));
  expect(await screen.findByRole('button', { name: 'Check previous action status' })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Check previous action status' }));
  expect(await screen.findByRole('checkbox', { name: /I checked/ })).toBeInTheDocument();
});

it('checks status after connection loss without repeating confirmation', async () => {
  const user = userEvent.setup();
  vi.mocked(calendarAction).mockResolvedValueOnce(review).mockRejectedValueOnce(new Error('Connection lost'))
    .mockResolvedValueOnce({ status: 'done', message: 'Recovered' });
  render(<CalendarActionDialog target={target} onClose={vi.fn()} onChanged={vi.fn()} />);
  await user.click(screen.getByRole('button', { name: 'Review changes' }));
  await user.click(await screen.findByRole('checkbox', { name: /I checked/ }));
  await user.click(screen.getByRole('button', { name: 'Confirm cancellation' }));
  await screen.findByText('Connection lost');
  expect(screen.queryByRole('button', { name: 'Confirm cancellation' })).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Check action status' }));
  expect(await screen.findByText('Recovered')).toBeInTheDocument();
  expect(vi.mocked(calendarAction).mock.calls[2]).toEqual(['LIVE-1', { stage: 'status' }]);
});

it('shows the cancelled session and still sends its LMS email if refresh fails', async () => {
  const user = userEvent.setup();
  const changed = vi.fn(async () => { throw new Error('Refresh failed'); });
  vi.mocked(calendarAction).mockResolvedValueOnce(review).mockResolvedValueOnce({
    status: 'done', message: 'Cancelled', completed: 1, total: 1, changeNotice: 'signed-cancellation',
    scheduleEmail: { total: 1, accepted: 1, queued: 0, failed: 0, uncertain: 0, status: 'complete' },
  });
  render(<CalendarActionDialog target={target} onClose={vi.fn()} onChanged={changed} />);
  await user.click(screen.getByRole('button', { name: 'Review changes' }));
  await user.click(await screen.findByRole('checkbox', { name: /I checked/ }));
  await user.click(screen.getByRole('button', { name: 'Confirm cancellation' }));
  expect(await screen.findByText('Cancelled in the LMS:', { selector: 'strong' })).toBeInTheDocument();
  expect(screen.getByText('Cancelled', { selector: 'span' })).toBeInTheDocument();
  expect(screen.getByText(/Refresh failed/)).toBeInTheDocument();
  expect(submitChangeEmails).not.toHaveBeenCalled();
});

it('converts the edited London clock to UTC before review', async () => {
  vi.mocked(calendarAction).mockResolvedValue(review);
  render(<CalendarActionDialog target={{ ...target, action: 'reschedule' }} onClose={vi.fn()} onChanged={vi.fn()} />);
  fireEvent.change(screen.getByLabelText('Session 2 date and time'), { target: { value: '2099-07-09T12:00' } });
  fireEvent.click(screen.getByRole('button', { name: 'Review changes' }));
  await screen.findByRole('checkbox', { name: /I checked/ });
  expect(vi.mocked(calendarAction).mock.calls[0][1].changes).toEqual([{ sessionNumber: 2, startDateTimeUtc: '2099-07-09T11:00:00.000Z', durationMinutes: 120 }]);
});

it('does not offer an optional email choice for a reschedule', async () => {
  const user = userEvent.setup();
  vi.mocked(calendarAction).mockResolvedValueOnce({ ...review, action: 'reschedule', notificationRequired: false })
    .mockResolvedValueOnce({ status: 'done', message: 'Moved', completed: 1, total: 1 });
  render(<CalendarActionDialog target={{ ...target, action: 'reschedule' }} onClose={vi.fn()} onChanged={vi.fn(async () => undefined)} />);
  await user.click(screen.getByRole('button', { name: 'Review changes' }));
  expect(screen.queryByText(/Email attendees and organisers/)).toBeNull();
  await user.click(await screen.findByRole('checkbox', { name: /I checked/ }));
  await user.click(screen.getByRole('button', { name: 'Save and send update' }));
  expect(vi.mocked(calendarAction).mock.calls[1]).toEqual(['LIVE-1', {
    stage: 'confirm', reviewToken: 'signed-review', acknowledgeNotifications: true,
  }]);
});
