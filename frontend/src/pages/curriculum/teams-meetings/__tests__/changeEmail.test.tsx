import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Swal from 'sweetalert2';
import { reviewCalendar } from '../calendarReview';
import { finishTeamsUpdate } from '../creationResult';
import { submitAddedPeopleEmails, submitChangeEmails } from '../scheduleEmail';

// The update/cancellation change email is the author's choice, made in the
// review before anything is sent, and off unless they tick it.

vi.mock('../scheduleEmail', async original => ({
  ...(await original<typeof import('../scheduleEmail')>()),
  submitChangeEmails: vi.fn(),
  submitAddedPeopleEmails: vi.fn(),
}));

const calendar = {
  title: 'Synthetic module', organizerEmail: 'organizer@example.invalid', attendees: ['learner@example.invalid'],
  scheduledOccurrences: [{ sessionNumber: 1, startDateTimeUtc: '2026-09-17T11:00:00Z', durationMinutes: 120 }],
};
const complete = { total: 3, accepted: 3, queued: 0, failed: 0, uncertain: 0, status: 'complete' as const };

beforeEach(() => {
  vi.clearAllMocks(); vi.stubGlobal('scrollTo', vi.fn());
  vi.mocked(submitChangeEmails).mockResolvedValue(complete);
  vi.mocked(submitAddedPeopleEmails).mockResolvedValue({ ...complete, total: 1, accepted: 1 });
});

async function resultOpen() {
  await waitFor(() => expect(screen.getByRole('button', { name: 'Done' })).toBeVisible());
}
afterEach(() => { Swal.close(); vi.unstubAllGlobals(); });

async function confirmReview() {
  await userEvent.click(screen.getByRole('checkbox', { name: /I checked the dates/ }));
  await userEvent.click(screen.getByRole('button', { name: 'Save and send' }));
}

it('does not offer an optional change email and sends it for an update', async () => {
  const pending = reviewCalendar({ ...calendar, notifyOnUpdate: true }, 'Europe/London');
  expect(screen.queryByRole('checkbox', { name: /Email attendees and organisers/ })).toBeNull();
  await confirmReview();
  await expect(pending).resolves.toEqual({ notifyAttendees: true });
});

it('keeps the review free of a change email checkbox', async () => {
  const pending = reviewCalendar({ ...calendar, notifyOnUpdate: true }, 'Europe/London');
  expect(screen.queryByRole('checkbox', { name: /Email attendees and organisers/ })).toBeNull();
  await confirmReview();
  await expect(pending).resolves.toEqual({ notifyAttendees: true });
});

it('does not offer the change email where there is no change to describe', async () => {
  const pending = reviewCalendar(calendar, 'Europe/London');
  await screen.findByRole('checkbox', { name: /I checked the dates/ });
  expect(screen.queryByRole('checkbox', { name: /Email attendees and organisers/ })).toBeNull();
  await confirmReview();
  await expect(pending).resolves.toEqual({ notifyAttendees: false });
});

it('sends nothing after a save that changed nothing everyone has to be told', async () => {
  const pending = finishTeamsUpdate({ updated: true, meeting: { liveSessionId: 'LIVE-ONE' }, changeNotice: 'signed', notifyAttendees: false }, calendar);
  await resultOpen();
  expect(screen.getByText('Not sent — nothing changed that everyone invited has to be told')).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Done' }));
  await pending;
  expect(submitChangeEmails).not.toHaveBeenCalled();
});

it('sends the signed change notice when the calendar moved', async () => {
  const pending = finishTeamsUpdate({ updated: true, meeting: { liveSessionId: 'LIVE-ONE' }, changeNotice: 'signed', notifyAttendees: true }, calendar);
  await resultOpen();
  expect(screen.getByText('3 of 3 submitted to Microsoft')).toBeVisible();
  expect(submitChangeEmails).toHaveBeenCalledWith('LIVE-ONE', 'signed', expect.objectContaining({ retryFailed: false }));
  await userEvent.click(screen.getByRole('button', { name: 'Done' }));
  await pending;
  expect(submitChangeEmails).toHaveBeenCalledTimes(1);
});

it('says so when the author asked but no session date moved', async () => {
  const pending = finishTeamsUpdate({ updated: true, meeting: { liveSessionId: 'LIVE-ONE' }, changeNotice: '', notifyAttendees: true }, calendar);
  await resultOpen();
  expect(screen.getByText('Not sent — no session date changed')).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Done' }));
  await pending;
  expect(submitChangeEmails).not.toHaveBeenCalled();
});

it('sends the full schedule to the people an update added, without a change email nobody asked for', async () => {
  const pending = finishTeamsUpdate({ updated: true, meeting: {}, changeNotice: '', notifyAttendees: false },
    { ...calendar, liveSessionId: 'LIVE-ONE', addedPeople: ['new.presenter@example.invalid'] });
  await resultOpen();
  expect(submitAddedPeopleEmails).toHaveBeenCalledWith('LIVE-ONE', ['new.presenter@example.invalid'], expect.objectContaining({ retryFailed: false }));
  expect(submitChangeEmails).not.toHaveBeenCalled();
  expect(screen.getByText('Schedule emails to 1 added person')).toBeVisible();
  expect(screen.getByText('1 of 1 submitted to Microsoft')).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Done' }));
  await pending;
});

it('says so when everyone added had already been sent the schedule', async () => {
  vi.mocked(submitAddedPeopleEmails).mockResolvedValue({ total: 0, accepted: 0, queued: 0, failed: 0, uncertain: 0, status: 'complete' });
  const pending = finishTeamsUpdate({ updated: true, meeting: { liveSessionId: 'LIVE-ONE' } },
    { ...calendar, addedPeople: ['back.again@example.invalid'] });
  await resultOpen();
  expect(screen.getByText('Already sent to everyone added')).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Done' }));
  await pending;
});

it('retries only the added-people emails that did not go through', async () => {
  vi.mocked(submitAddedPeopleEmails).mockRejectedValueOnce(new Error('Schedule email status could not be confirmed.'));
  const pending = finishTeamsUpdate({ updated: true, meeting: { liveSessionId: 'LIVE-ONE' }, changeNotice: 'signed', notifyAttendees: true },
    { ...calendar, addedPeople: ['new.learner@example.invalid'] });
  await resultOpen();
  await userEvent.click(screen.getByRole('button', { name: 'Retry pending emails' }));
  await waitFor(() => expect(submitAddedPeopleEmails).toHaveBeenCalledTimes(2));
  expect(vi.mocked(submitAddedPeopleEmails).mock.calls[1][2]).toMatchObject({ retryFailed: true });
  // The change email already went out in full, so the retry does not resend it.
  expect(submitChangeEmails).toHaveBeenCalledTimes(1);
  await resultOpen();
  await userEvent.click(screen.getByRole('button', { name: 'Done' }));
  await pending;
});

it('puts the change notice, and nothing else, in the email request', async () => {
  const { sendScheduleEmailBatch: real } = await vi.importActual<typeof import('../scheduleEmail')>('../scheduleEmail');
  const transport = vi.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ csrfToken: 'synthetic-csrf' }) })
    .mockResolvedValueOnce({ ok: true, json: async () => complete });
  vi.stubGlobal('fetch', transport);
  await real('LIVE-ONE', false, 'signed-notice');
  expect(JSON.parse(transport.mock.calls[1][1].body)).toEqual({ retryFailed: false, changeNotice: 'signed-notice' });
});

it('names the added people, and nothing else, in their email request', async () => {
  const { sendScheduleEmailBatch: real } = await vi.importActual<typeof import('../scheduleEmail')>('../scheduleEmail');
  // Answered by address: the CSRF token may already be held from an earlier request.
  const transport = vi.fn(async (url: string) => ({ ok: true, json: async () => (String(url).includes('schedule-email') ? complete : { csrfToken: 'synthetic-csrf' }) }));
  vi.stubGlobal('fetch', transport);
  await real('LIVE-ONE', false, '', ['new.presenter@example.invalid']);
  const sent = transport.mock.calls.find(([url]) => String(url).includes('schedule-email')) as unknown as [string, { body: string }];
  expect(JSON.parse(sent[1].body)).toEqual({ retryFailed: false, addedPeople: ['new.presenter@example.invalid'] });
});

it('shows the change email the server already sent with the update, and sends nothing from the browser', async () => {
  const pending = finishTeamsUpdate({ updated: true, meeting: { liveSessionId: 'LIVE-ONE' }, changeNotice: 'signed', notifyAttendees: true,
    scheduleEmail: { ...complete, total: 5, accepted: 5 } }, calendar);
  await resultOpen();
  expect(screen.getByText('5 of 5 submitted to Microsoft')).toBeVisible();
  expect(submitChangeEmails).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Done' }));
  await pending;
  expect(submitChangeEmails).not.toHaveBeenCalled();
});

it('reaches only the people the server found were added, with what it already sent', async () => {
  const pending = finishTeamsUpdate({ updated: true, meeting: { liveSessionId: 'LIVE-ONE' },
    addedPeople: ['new@example.invalid'], addedEmail: { ...complete, total: 1, accepted: 1 } }, calendar);
  await resultOpen();
  expect(screen.getByText('Schedule emails to 1 added person')).toBeVisible();
  expect(screen.getByText('1 of 1 submitted to Microsoft')).toBeVisible();
  // Quiet for everyone already invited: no change email, no browser send.
  expect(submitChangeEmails).not.toHaveBeenCalled();
  expect(submitAddedPeopleEmails).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Done' }));
  await pending;
});

it('reports a server email failure beside the saved calendar and retries only when asked', async () => {
  const pending = finishTeamsUpdate({ updated: true, meeting: { liveSessionId: 'LIVE-ONE' }, changeNotice: 'signed', notifyAttendees: true,
    scheduleEmail: { error: 'Schedule emails are not configured.', code: 'schedule_email_not_configured' } }, calendar);
  await waitFor(() => expect(screen.getByText('Schedule emails are not configured.')).toBeVisible());
  expect(submitChangeEmails).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Retry pending emails' }));
  await waitFor(() => expect(screen.getByText('3 of 3 submitted to Microsoft')).toBeVisible());
  expect(submitChangeEmails).toHaveBeenCalledWith('LIVE-ONE', 'signed', expect.objectContaining({ retryFailed: true }));
  await userEvent.click(screen.getByRole('button', { name: 'Done' }));
  await pending;
});

it('finishes from the browser what the server left queued', async () => {
  const pending = finishTeamsUpdate({ updated: true, meeting: { liveSessionId: 'LIVE-ONE' }, changeNotice: 'signed', notifyAttendees: true,
    scheduleEmail: { ...complete, total: 6, accepted: 4, queued: 2, status: 'pending' } }, calendar);
  await resultOpen();
  expect(submitChangeEmails).toHaveBeenCalledTimes(1);
  expect(submitChangeEmails).toHaveBeenCalledWith('LIVE-ONE', 'signed', expect.objectContaining({ retryFailed: false }));
  await userEvent.click(screen.getByRole('button', { name: 'Done' }));
  await pending;
});
