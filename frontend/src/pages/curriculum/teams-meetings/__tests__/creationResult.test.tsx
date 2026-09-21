import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Swal from 'sweetalert2';
import { finishTeamsCreation } from '../creationResult';
import { sendScheduleEmailBatch } from '../scheduleEmail';
import type { TeamsMeetingInput, TeamsMeetingResult } from '../../module-builder/moduleAuthoringData';

vi.mock('../scheduleEmail', () => ({ sendScheduleEmailBatch: vi.fn() }));
const input = { title: 'Synthetic module', scheduledOccurrences: [{ sessionNumber: 1, startDateTimeUtc: '2026-09-17T11:00:00Z', durationMinutes: 120 }] } as TeamsMeetingInput;
const result = { created: true, warnings: [], meeting: { liveSessionId: 'LIVE-ONE', settingsApplied: true } } as unknown as TeamsMeetingResult;
const complete = { total: 2, accepted: 2, queued: 0, failed: 0, uncertain: 0, status: 'complete' as const };
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal('scrollTo', vi.fn()); vi.mocked(sendScheduleEmailBatch).mockResolvedValue(complete); });
afterEach(() => { Swal.close(); vi.unstubAllGlobals(); });

it('keeps the saved result open until Done, which makes no further request', async () => {
  let closed = false;
  const pending = finishTeamsCreation(result, input).then(() => { closed = true; });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Done' })).toBeVisible());
  expect(screen.getByText('1 session saved')).toBeVisible();
  expect(screen.getByText('2 of 2 submitted to Microsoft')).toBeVisible();
  expect(Swal.getTimerLeft()).toBeUndefined();
  expect(closed).toBe(false);
  await userEvent.click(screen.getByRole('button', { name: 'Done' }));
  await pending;
  expect(sendScheduleEmailBatch).toHaveBeenCalledTimes(1);
});

it('continues pending batches without requesting retries for failed recipients', async () => {
  vi.mocked(sendScheduleEmailBatch).mockResolvedValueOnce({ ...complete, total: 6, accepted: 4, queued: 2, status: 'pending' });
  const pending = finishTeamsCreation(result, input);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Done' })).toBeVisible());
  expect(sendScheduleEmailBatch).toHaveBeenNthCalledWith(1, 'LIVE-ONE', false);
  expect(sendScheduleEmailBatch).toHaveBeenNthCalledWith(2, 'LIVE-ONE', false);
  await userEvent.click(screen.getByRole('button', { name: 'Done' }));
  await pending;
});

it('keeps calendar success visible on email failure and retries only after an explicit click', async () => {
  vi.mocked(sendScheduleEmailBatch).mockRejectedValueOnce(new Error('Email service is unavailable.'));
  const pending = finishTeamsCreation(result, input);
  await waitFor(() => expect(screen.getByText('Email service is unavailable.')).toBeVisible());
  expect(screen.getByText('1 session saved')).toBeVisible();
  expect(sendScheduleEmailBatch).toHaveBeenCalledTimes(1);
  await userEvent.click(screen.getByRole('button', { name: 'Retry pending emails' }));
  await waitFor(() => expect(screen.getByText('2 of 2 submitted to Microsoft')).toBeVisible());
  expect(sendScheduleEmailBatch).toHaveBeenNthCalledWith(2, 'LIVE-ONE', true);
  await userEvent.click(screen.getByRole('button', { name: 'Done' }));
  await pending;
});

it('does not send summaries for a calendar whose verification is incomplete', async () => {
  const pending = finishTeamsCreation({ ...result, warnings: ['Calendar dates need review.'] }, input);
  await waitFor(() => expect(screen.getByText('Calendar dates need review.')).toBeVisible());
  expect(sendScheduleEmailBatch).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: 'Retry pending emails' })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Done' }));
  await pending;
});

it('does not offer to resend uncertain results and retains component warnings', async () => {
  vi.mocked(sendScheduleEmailBatch).mockResolvedValue({ ...complete, accepted: 1, uncertain: 1, status: 'pending' });
  const pending = finishTeamsCreation(result, input, 'Re-attach the component links.');
  await waitFor(() => expect(screen.getByText('Re-attach the component links.')).toBeVisible());
  expect(screen.getByText('1 of 2 submitted to Microsoft · 1 awaiting verification')).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Retry pending emails' })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Done' }));
  await pending;
});
