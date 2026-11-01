import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { coachFetch } from '@/lib/coachFetch';
import {
  checkImportedCalendarUpdate,
  connectImportedCalendar,
  confirmImportedCalendarUpdate,
  fetchImportedCalendarConnection,
  previewImportedCalendarUpdate,
  type ImportedCalendarPreview,
  type ImportedCalendarUpdateResult,
} from '@/lib/curriculumApi';
import { ImportedCalendarUpdatePanel } from '../ImportedCalendarUpdatePanel';

vi.mock('@/lib/curriculumApi', () => ({
  previewImportedCalendarUpdate: vi.fn(),
  confirmImportedCalendarUpdate: vi.fn(),
  checkImportedCalendarUpdate: vi.fn(),
  connectImportedCalendar: vi.fn(),
  fetchImportedCalendarConnection: vi.fn(),
}));
vi.mock('@/lib/coachFetch', () => ({ coachFetch: vi.fn() }));

const liveSessionId = 'LIVE-EXISTING';
const review = (): ImportedCalendarPreview => ({
  status: 'ready', message: 'One planned date can extend this existing series.',
  previewToken: 'signed-review.for-original-series', operationId: 'OP-REVIEW',
  currentEndDate: '2026-12-18', proposedEndDate: '2026-12-25', timeZone: 'Europe/London',
  addedSessions: [{ start: '2026-12-25T12:00:00Z', end: '2026-12-25T14:00:00Z' }],
  organizer: { name: 'Existing organiser', email: 'organiser@example.invalid' },
  existingInviteeCount: 12, joinUrl: 'https://example.invalid/original-teams-link',
  calendarChangeRequired: true, notificationScope: 'Microsoft will notify the existing invitees.',
});
const confirmed = (): ImportedCalendarUpdateResult => ({
  status: 'confirmed', message: 'Original series extended and verified.',
  operationId: 'OP-CONFIRMED', addedSessions: 1, importedSessions: 1,
});

function pending<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

function openPanel(disabled = false) {
  const onUpdated = vi.fn(async () => undefined);
  return {
    onUpdated,
    ...render(<ImportedCalendarUpdatePanel liveSessionId={liveSessionId} disabled={disabled} onUpdated={onUpdated} />),
  };
}

async function prepareConfirmation() {
  await userEvent.click(screen.getByRole('button', { name: 'Review Teams calendar update' }));
  await userEvent.click(await screen.findByRole('checkbox', { name: /I checked the dates/ }));
}

beforeEach(() => {
  vi.mocked(previewImportedCalendarUpdate).mockReset().mockResolvedValue(review());
  vi.mocked(confirmImportedCalendarUpdate).mockReset().mockResolvedValue(confirmed());
  vi.mocked(checkImportedCalendarUpdate).mockReset().mockResolvedValue(confirmed());
  vi.mocked(connectImportedCalendar).mockReset().mockResolvedValue({
    authorizationUrl: 'https://login.microsoftonline.com/example/oauth2/v2.0/authorize',
    callbackOrigin: 'https://lms.example.invalid',
  });
  vi.mocked(fetchImportedCalendarConnection).mockReset().mockResolvedValue({ connected: true, calendarKind: 'group' });
  vi.mocked(coachFetch).mockReset().mockRejectedValue(new Error('Unexpected authenticated request'));
  // Every panel call is mocked. Contract cases replace this boundary with a
  // synthetic response; an accidental real request always fails the test.
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Unexpected network request'); }));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('updating an imported calendar through review', () => {
  it('reads a preview only when asked and shows the existing link and proposed dates without sending', async () => {
    const { onUpdated } = openPanel();
    expect(previewImportedCalendarUpdate).not.toHaveBeenCalled();
    expect(confirmImportedCalendarUpdate).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Review Teams calendar update' }));
    expect(await screen.findByRole('status')).toHaveTextContent(review().message);
    expect(previewImportedCalendarUpdate).toHaveBeenCalledExactlyOnceWith(liveSessionId);
    expect(screen.getByText(/2026-12-18/)).toHaveTextContent('2026-12-25');
    expect(screen.getByText(/25 Dec 2026, 12:00/)).toHaveTextContent('25 Dec 2026, 14:00');
    expect(screen.getByText(/https:\/\/example.invalid\/original-teams-link/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Update series and send' })).toBeDisabled();
    expect(confirmImportedCalendarUpdate).not.toHaveBeenCalled();
    expect(checkImportedCalendarUpdate).not.toHaveBeenCalled();
    expect(onUpdated).not.toHaveBeenCalled();
  });

  it('requires acknowledgement and sends only the reviewed token on explicit confirmation', async () => {
    const { onUpdated } = openPanel();
    await userEvent.click(screen.getByRole('button', { name: 'Review Teams calendar update' }));
    const send = await screen.findByRole('button', { name: 'Update series and send' });
    fireEvent.click(send);
    expect(confirmImportedCalendarUpdate).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('checkbox', { name: /I checked the dates/ }));
    expect(confirmImportedCalendarUpdate).not.toHaveBeenCalled();
    expect(send).toBeEnabled();
    await userEvent.click(send);
    await waitFor(() => expect(onUpdated).toHaveBeenCalledOnce());
    expect(confirmImportedCalendarUpdate).toHaveBeenCalledExactlyOnceWith(liveSessionId, review().previewToken, true);
    expect(screen.getByRole('status')).toHaveTextContent('Original series extended and verified.');
    expect(checkImportedCalendarUpdate).not.toHaveBeenCalled();
  });

  it('cancels a review without changing the original meeting', async () => {
    const { onUpdated } = openPanel();
    await prepareConfirmation();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('button', { name: 'Update series and send' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Review Teams calendar update' })).toBeEnabled();
    expect(confirmImportedCalendarUpdate).not.toHaveBeenCalled();
    expect(onUpdated).not.toHaveBeenCalled();
  });

  it('shows a blocked review reason without exposing a confirmation action', async () => {
    vi.mocked(previewImportedCalendarUpdate).mockResolvedValue({
      status: 'blocked', message: 'The original organiser calendar is not accessible.',
      code: 'organizer_calendar_unavailable', addedSessions: [],
    });
    const { onUpdated } = openPanel();
    await userEvent.click(screen.getByRole('button', { name: 'Review Teams calendar update' }));
    expect(await screen.findByRole('status')).toHaveTextContent('The original organiser calendar is not accessible.');
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Update series and send' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Import confirmed Teams dates' })).not.toBeInTheDocument();
    expect(confirmImportedCalendarUpdate).not.toHaveBeenCalled();
    expect(onUpdated).not.toHaveBeenCalled();
  });

  it('imports dates already present in Microsoft without asking to notify people', async () => {
    vi.mocked(previewImportedCalendarUpdate).mockResolvedValue({ ...review(), calendarChangeRequired: false });
    const { onUpdated } = openPanel();
    await userEvent.click(screen.getByRole('button', { name: 'Review Teams calendar update' }));
    const save = await screen.findByRole('button', { name: 'Import confirmed Teams dates' });
    expect(save).toBeEnabled();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.getByText(/sends no calendar update/)).toBeVisible();
    await userEvent.click(save);
    expect(confirmImportedCalendarUpdate).toHaveBeenCalledExactlyOnceWith(liveSessionId, review().previewToken, false);
    await waitFor(() => expect(onUpdated).toHaveBeenCalledOnce());
  });

  it('offers only status recovery after connection loss and never repeats confirmation', async () => {
    vi.mocked(confirmImportedCalendarUpdate).mockRejectedValue(new TypeError('Network connection lost'));
    vi.mocked(checkImportedCalendarUpdate).mockRejectedValueOnce(new TypeError('Still unavailable')).mockResolvedValueOnce(confirmed());
    const { onUpdated } = openPanel();
    await prepareConfirmation();
    await userEvent.click(screen.getByRole('button', { name: 'Update series and send' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Check update status before attempting another calendar update.');
    expect(screen.queryByRole('button', { name: 'Update series and send' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Review Teams calendar update' })).not.toBeInTheDocument();
    expect(onUpdated).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Check update status' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('this check does not resend the update');
    expect(screen.queryByRole('button', { name: 'Review Teams calendar update' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Check update status' }));
    await waitFor(() => expect(onUpdated).toHaveBeenCalledOnce());
    expect(checkImportedCalendarUpdate).toHaveBeenNthCalledWith(1, liveSessionId, 'OP-REVIEW');
    expect(checkImportedCalendarUpdate).toHaveBeenNthCalledWith(2, liveSessionId, 'OP-REVIEW');
    expect(confirmImportedCalendarUpdate).toHaveBeenCalledOnce();
    expect(previewImportedCalendarUpdate).toHaveBeenCalledOnce();
  });

  it('checks the returned operation when Microsoft verification remains pending', async () => {
    vi.mocked(confirmImportedCalendarUpdate).mockResolvedValue({
      status: 'verification_pending', message: 'Microsoft accepted the update; verification is pending.', operationId: 'OP-ACCEPTED',
    });
    const { onUpdated } = openPanel();
    await prepareConfirmation();
    await userEvent.click(screen.getByRole('button', { name: 'Update series and send' }));
    const check = await screen.findByRole('button', { name: 'Check update status' });
    expect(onUpdated).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Update series and send' })).not.toBeInTheDocument();
    await userEvent.click(check);
    expect(checkImportedCalendarUpdate).toHaveBeenCalledExactlyOnceWith(liveSessionId, 'OP-ACCEPTED');
    await waitFor(() => expect(onUpdated).toHaveBeenCalledOnce());
  });

  it('reconnects an expired calendar credential and checks the original operation without reviewing or sending again', async () => {
    vi.mocked(confirmImportedCalendarUpdate).mockResolvedValue({
      status: 'verification_pending', message: 'The calendar update needs verification.', operationId: 'OP-ACCEPTED',
    });
    // The reconnect response may omit operationId; recovery must retain it.
    vi.mocked(checkImportedCalendarUpdate).mockResolvedValueOnce({
      status: 'blocked', message: 'Reconnect the same Microsoft account to verify the update.',
      connectionRequired: true, connectionKind: 'group',
    }).mockResolvedValueOnce(confirmed());
    const popup = { location: { href: '' }, closed: false, close: vi.fn() } as unknown as Window;
    vi.spyOn(window, 'open').mockReturnValue(popup);
    const { onUpdated, unmount } = openPanel();
    await prepareConfirmation();
    await userEvent.click(screen.getByRole('button', { name: 'Update series and send' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Check update status' }));
    expect(await screen.findByRole('button', { name: 'Connect Microsoft calendar' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Check update status' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Review Teams calendar update' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Update series and send' })).not.toBeInTheDocument();
    expect(onUpdated).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Connect Microsoft calendar' }));
    expect(connectImportedCalendar).toHaveBeenCalledExactlyOnceWith(liveSessionId, 'group');
    fireEvent(window, new MessageEvent('message', {
      source: popup, origin: 'https://lms.example.invalid', data: { type: 'lms:teams-calendar-connected', liveSessionId, ok: true },
    }));
    await waitFor(() => expect(onUpdated).toHaveBeenCalledOnce());
    expect(fetchImportedCalendarConnection).toHaveBeenCalledExactlyOnceWith(liveSessionId);
    expect(checkImportedCalendarUpdate).toHaveBeenCalledTimes(2);
    expect(checkImportedCalendarUpdate).toHaveBeenNthCalledWith(1, liveSessionId, 'OP-ACCEPTED');
    expect(checkImportedCalendarUpdate).toHaveBeenNthCalledWith(2, liveSessionId, 'OP-ACCEPTED');
    expect(previewImportedCalendarUpdate).toHaveBeenCalledOnce();
    expect(confirmImportedCalendarUpdate).toHaveBeenCalledOnce();
    unmount();
  });

  it('does not reuse a completed operation id if a later confirmation response is lost', async () => {
    // Ready previews carry the signed review token; the committed operation id
    // is first returned by confirmation, which may lose its response.
    vi.mocked(previewImportedCalendarUpdate).mockResolvedValue({ ...review(), operationId: undefined });
    vi.mocked(confirmImportedCalendarUpdate).mockResolvedValueOnce(confirmed())
      .mockRejectedValueOnce(new TypeError('New confirmation response was lost'));
    const { onUpdated } = openPanel();
    await prepareConfirmation();
    await userEvent.click(screen.getByRole('button', { name: 'Update series and send' }));
    await waitFor(() => expect(onUpdated).toHaveBeenCalledOnce());
    await prepareConfirmation();
    await userEvent.click(screen.getByRole('button', { name: 'Update series and send' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Check update status before attempting another calendar update.');
    await userEvent.click(screen.getByRole('button', { name: 'Check update status' }));
    // Omitting the id asks the server for its current durable operation.
    expect(checkImportedCalendarUpdate).toHaveBeenCalledExactlyOnceWith(liveSessionId, undefined);
    await waitFor(() => expect(onUpdated).toHaveBeenCalledTimes(2));
    expect(previewImportedCalendarUpdate).toHaveBeenCalledTimes(2);
    expect(confirmImportedCalendarUpdate).toHaveBeenCalledTimes(2);
  });

  it('resumes a previously uncertain operation discovered during review without confirming again', async () => {
    vi.mocked(previewImportedCalendarUpdate).mockResolvedValue({
      status: 'verification_pending', message: 'A previous update needs verification.',
      operationId: 'OP-PREVIOUS', addedSessions: [],
    });
    openPanel();
    await userEvent.click(screen.getByRole('button', { name: 'Review Teams calendar update' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Check update status' }));
    expect(checkImportedCalendarUpdate).toHaveBeenCalledExactlyOnceWith(liveSessionId, 'OP-PREVIOUS');
    expect(confirmImportedCalendarUpdate).not.toHaveBeenCalled();
  });

  it('prevents repeated sends while the confirmation is in flight', async () => {
    const waiting = pending<ImportedCalendarUpdateResult>();
    vi.mocked(confirmImportedCalendarUpdate).mockReturnValue(waiting.promise);
    openPanel();
    await prepareConfirmation();
    const send = screen.getByRole('button', { name: 'Update series and send' });
    fireEvent.click(send);
    fireEvent.click(send);
    expect(confirmImportedCalendarUpdate).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: /Applying and verifying/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    await act(async () => waiting.resolve(confirmed()));
  });

  it('respects a disabled module before review and before confirmation', async () => {
    const { onUpdated, rerender } = openPanel(true);
    fireEvent.click(screen.getByRole('button', { name: 'Review Teams calendar update' }));
    expect(previewImportedCalendarUpdate).not.toHaveBeenCalled();
    rerender(<ImportedCalendarUpdatePanel liveSessionId={liveSessionId} disabled={false} onUpdated={onUpdated} />);
    await prepareConfirmation();
    rerender(<ImportedCalendarUpdatePanel liveSessionId={liveSessionId} disabled onUpdated={onUpdated} />);
    fireEvent.click(screen.getByRole('button', { name: 'Update series and send' }));
    expect(confirmImportedCalendarUpdate).not.toHaveBeenCalled();
  });

  it('does not refresh a module after an unmounted review finishes up to date', async () => {
    const waiting = pending<ImportedCalendarPreview>();
    vi.mocked(previewImportedCalendarUpdate).mockReturnValue(waiting.promise);
    const { onUpdated, unmount } = openPanel();
    await userEvent.click(screen.getByRole('button', { name: 'Review Teams calendar update' }));
    unmount();
    await act(async () => waiting.resolve({ status: 'up_to_date', message: 'Already current.', addedSessions: [] }));
    expect(onUpdated).not.toHaveBeenCalled();
    expect(confirmImportedCalendarUpdate).not.toHaveBeenCalled();
  });

  it('does not refresh another module when an unmounted confirmation finishes', async () => {
    const waiting = pending<ImportedCalendarUpdateResult>();
    vi.mocked(confirmImportedCalendarUpdate).mockReturnValue(waiting.promise);
    const { onUpdated, unmount } = openPanel();
    await prepareConfirmation();
    await userEvent.click(screen.getByRole('button', { name: 'Update series and send' }));
    unmount();
    await act(async () => waiting.resolve(confirmed()));
    expect(onUpdated).not.toHaveBeenCalled();
    expect(confirmImportedCalendarUpdate).toHaveBeenCalledOnce();
  });

  it('does not refresh another module when an unmounted status check finishes', async () => {
    vi.mocked(previewImportedCalendarUpdate).mockResolvedValue({
      status: 'verification_pending', message: 'Previous update pending.', operationId: 'OP-PREVIOUS', addedSessions: [],
    });
    const waiting = pending<ImportedCalendarUpdateResult>();
    vi.mocked(checkImportedCalendarUpdate).mockReturnValue(waiting.promise);
    const { onUpdated, unmount } = openPanel();
    await userEvent.click(screen.getByRole('button', { name: 'Review Teams calendar update' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Check update status' }));
    unmount();
    await act(async () => waiting.resolve(confirmed()));
    expect(onUpdated).not.toHaveBeenCalled();
    expect(confirmImportedCalendarUpdate).not.toHaveBeenCalled();
  });

  it('offers calendar connection for a blocked review and explains a blocked popup without sending', async () => {
    vi.mocked(previewImportedCalendarUpdate).mockResolvedValue({
      status: 'blocked', message: 'Connect a calendar editor.', addedSessions: [],
      connectionRequired: true, connectionKind: 'group',
    });
    vi.spyOn(window, 'open').mockReturnValue(null);
    openPanel();
    await userEvent.click(screen.getByRole('button', { name: 'Review Teams calendar update' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Connect Microsoft calendar' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Allow the Microsoft sign-in popup');
    expect(connectImportedCalendar).not.toHaveBeenCalled();
    expect(confirmImportedCalendarUpdate).not.toHaveBeenCalled();
  });

  it('verifies only a matching sign-in callback and reviews again without sending an update', async () => {
    vi.mocked(previewImportedCalendarUpdate).mockResolvedValueOnce({
      status: 'blocked', message: 'Connect a calendar editor.', addedSessions: [],
      connectionRequired: true, connectionKind: 'group',
    }).mockResolvedValueOnce(review());
    const popup = { location: { href: '' }, closed: false, close: vi.fn() } as unknown as Window;
    vi.spyOn(window, 'open').mockReturnValue(popup);
    const { onUpdated, unmount } = openPanel();
    await userEvent.click(screen.getByRole('button', { name: 'Review Teams calendar update' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Connect Microsoft calendar' }));
    expect(connectImportedCalendar).toHaveBeenCalledExactlyOnceWith(liveSessionId, 'group');
    expect(popup.location.href).toBe('https://login.microsoftonline.com/example/oauth2/v2.0/authorize');
    const data = { type: 'lms:teams-calendar-connected', liveSessionId, ok: true };
    fireEvent(window, new MessageEvent('message', { source: popup, origin: 'https://unrelated.example.invalid', data }));
    fireEvent(window, new MessageEvent('message', { source: window, origin: 'https://lms.example.invalid', data }));
    fireEvent(window, new MessageEvent('message', {
      source: popup, origin: 'https://lms.example.invalid', data: { ...data, liveSessionId: 'ANOTHER-SERIES' },
    }));
    expect(fetchImportedCalendarConnection).not.toHaveBeenCalled();
    fireEvent(window, new MessageEvent('message', { source: popup, origin: 'https://lms.example.invalid', data }));
    expect(await screen.findByRole('button', { name: 'Update series and send' })).toBeDisabled();
    expect(fetchImportedCalendarConnection).toHaveBeenCalledExactlyOnceWith(liveSessionId);
    expect(previewImportedCalendarUpdate).toHaveBeenCalledTimes(2);
    expect(confirmImportedCalendarUpdate).not.toHaveBeenCalled();
    expect(onUpdated).not.toHaveBeenCalled();
    unmount();
  });

  it('does not review or send when the sign-in callback is not confirmed by the server', async () => {
    vi.mocked(previewImportedCalendarUpdate).mockResolvedValue({
      status: 'blocked', message: 'Connect a calendar editor.', addedSessions: [],
      connectionRequired: true, connectionKind: 'user',
    });
    vi.mocked(fetchImportedCalendarConnection).mockResolvedValue({ connected: false, message: 'Calendar access was not granted.' });
    const popup = { location: { href: '' }, closed: false, close: vi.fn() } as unknown as Window;
    vi.spyOn(window, 'open').mockReturnValue(popup);
    const { unmount } = openPanel();
    await userEvent.click(screen.getByRole('button', { name: 'Review Teams calendar update' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Connect Microsoft calendar' }));
    fireEvent(window, new MessageEvent('message', {
      source: popup, origin: 'https://lms.example.invalid', data: { type: 'lms:teams-calendar-connected', liveSessionId, ok: true },
    }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Calendar access was not granted.');
    expect(previewImportedCalendarUpdate).toHaveBeenCalledOnce();
    expect(confirmImportedCalendarUpdate).not.toHaveBeenCalled();
    unmount();
  });

  it('keeps a failed reconnection visible even when an older connection still exists', async () => {
    const popup = { location: { href: '' }, closed: false, close: vi.fn() } as unknown as Window;
    vi.spyOn(window, 'open').mockReturnValue(popup);
    const onEditorConnected = vi.fn();
    const { unmount } = render(<ImportedCalendarUpdatePanel liveSessionId={liveSessionId} disabled={false}
      connectionOnly editorConnectionKind="group" onEditorConnected={onEditorConnected} onUpdated={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Connect Microsoft calendar' }));
    fireEvent(window, new MessageEvent('message', {
      source: popup, origin: 'https://lms.example.invalid', data: {
        type: 'lms:teams-calendar-connected', liveSessionId, ok: false,
        error: 'Microsoft requires administrator consent for Group.ReadWrite.All (AADSTS65001).',
      },
    }));
    expect(await screen.findByRole('alert')).toHaveTextContent('AADSTS65001');
    expect(fetchImportedCalendarConnection).not.toHaveBeenCalled();
    expect(onEditorConnected).not.toHaveBeenCalled();
    expect(previewImportedCalendarUpdate).not.toHaveBeenCalled();
    expect(confirmImportedCalendarUpdate).not.toHaveBeenCalled();
    unmount();
  });

  it('does not unlock a group calendar with a connection for a user calendar', async () => {
    vi.mocked(fetchImportedCalendarConnection).mockResolvedValue({ connected: true, calendarKind: 'user' });
    const popup = { location: { href: '' }, closed: false, close: vi.fn() } as unknown as Window;
    vi.spyOn(window, 'open').mockReturnValue(popup);
    const onEditorConnected = vi.fn();
    const { unmount } = render(<ImportedCalendarUpdatePanel liveSessionId={liveSessionId} disabled={false}
      connectionOnly editorConnectionKind="group" onEditorConnected={onEditorConnected} onUpdated={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Connect Microsoft calendar' }));
    fireEvent(window, new MessageEvent('message', {
      source: popup, origin: 'https://lms.example.invalid', data: { type: 'lms:teams-calendar-connected', liveSessionId, ok: true },
    }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/group calendar/i);
    expect(onEditorConnected).not.toHaveBeenCalled();
    expect(previewImportedCalendarUpdate).not.toHaveBeenCalled();
    expect(confirmImportedCalendarUpdate).not.toHaveBeenCalled();
    unmount();
  });

  it('refreshes the original editor after the server confirms the requested calendar connection', async () => {
    const popup = { location: { href: '' }, closed: false, close: vi.fn() } as unknown as Window;
    vi.spyOn(window, 'open').mockReturnValue(popup);
    const onEditorConnected = vi.fn();
    const { unmount } = render(<ImportedCalendarUpdatePanel liveSessionId={liveSessionId} disabled={false}
      connectionOnly editorConnectionKind="group" onEditorConnected={onEditorConnected} onUpdated={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Connect Microsoft calendar' }));
    fireEvent(window, new MessageEvent('message', {
      source: popup, origin: 'https://lms.example.invalid', data: { type: 'lms:teams-calendar-connected', liveSessionId, ok: true },
    }));
    await waitFor(() => expect(onEditorConnected).toHaveBeenCalledOnce());
    expect(fetchImportedCalendarConnection).toHaveBeenCalledExactlyOnceWith(liveSessionId);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(previewImportedCalendarUpdate).not.toHaveBeenCalled();
    expect(confirmImportedCalendarUpdate).not.toHaveBeenCalled();
    unmount();
  });

  it('ignores calendar sign-in callbacks after the module panel unmounts', async () => {
    vi.mocked(previewImportedCalendarUpdate).mockResolvedValue({
      status: 'blocked', message: 'Connect a calendar editor.', addedSessions: [],
      connectionRequired: true, connectionKind: 'group',
    });
    const popup = { location: { href: '' }, closed: false, close: vi.fn() } as unknown as Window;
    vi.spyOn(window, 'open').mockReturnValue(popup);
    const { onUpdated, unmount } = openPanel();
    await userEvent.click(screen.getByRole('button', { name: 'Review Teams calendar update' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Connect Microsoft calendar' }));
    unmount();
    fireEvent(window, new MessageEvent('message', {
      source: popup, origin: 'https://lms.example.invalid', data: { type: 'lms:teams-calendar-connected', liveSessionId, ok: true },
    }));
    expect(fetchImportedCalendarConnection).not.toHaveBeenCalled();
    expect(previewImportedCalendarUpdate).toHaveBeenCalledOnce();
    expect(confirmImportedCalendarUpdate).not.toHaveBeenCalled();
    expect(onUpdated).not.toHaveBeenCalled();
  });
});

describe('imported calendar API wire contract', () => {
  it('starts calendar connection with the server-selected calendar kind through authenticated POST', async () => {
    const real = await vi.importActual<typeof import('@/lib/curriculumApi')>('@/lib/curriculumApi');
    const transport = vi.mocked(coachFetch).mockResolvedValue(new Response(JSON.stringify({
      authorizationUrl: 'https://login.microsoftonline.com/example/oauth2/v2.0/authorize',
      callbackOrigin: 'https://lms.example.invalid',
    }), { status: 200 }));
    await real.connectImportedCalendar('LIVE /existing', 'group');
    expect(transport).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining('/teams-meetings/LIVE%20%2Fexisting/imported-calendar/connect/'),
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ calendarKind: 'group' }) }),
    );
  });

  it('uses the preview endpoint without a confirmation token or notification acknowledgement', async () => {
    const real = await vi.importActual<typeof import('@/lib/curriculumApi')>('@/lib/curriculumApi');
    const transport = vi.mocked(coachFetch).mockResolvedValue(new Response(JSON.stringify(review()), { status: 200 }));
    await real.previewImportedCalendarUpdate('LIVE /existing');
    expect(transport).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining('/teams-meetings/LIVE%20%2Fexisting/imported-calendar/preview/'),
      expect.objectContaining({ method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' } }),
    );
  });

  it.each([true, false])('sends the exact reviewed token and acknowledgement %s, without client replacement details', async acknowledged => {
    const real = await vi.importActual<typeof import('@/lib/curriculumApi')>('@/lib/curriculumApi');
    const transport = vi.mocked(coachFetch).mockResolvedValue(new Response(JSON.stringify(confirmed()), { status: 200 }));
    await real.confirmImportedCalendarUpdate('LIVE /existing', 'signed.review+token/unchanged', acknowledged);
    expect(transport).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining('/teams-meetings/LIVE%20%2Fexisting/imported-calendar/confirm/'),
      expect.objectContaining({ method: 'POST', body: JSON.stringify({
        previewToken: 'signed.review+token/unchanged', acknowledgeNotifications: acknowledged,
      }) }),
    );
  });

  it('recovers through status with the operation id and never resends the reviewed update', async () => {
    const real = await vi.importActual<typeof import('@/lib/curriculumApi')>('@/lib/curriculumApi');
    const transport = vi.mocked(coachFetch).mockResolvedValue(new Response(JSON.stringify(confirmed()), { status: 200 }));
    await real.checkImportedCalendarUpdate(liveSessionId, 'OP-ACCEPTED');
    expect(transport).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining(`/teams-meetings/${liveSessionId}/imported-calendar/status/`),
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ operationId: 'OP-ACCEPTED' }) }),
    );
  });

  it('does not automatically retry a confirmation after a network failure', async () => {
    const real = await vi.importActual<typeof import('@/lib/curriculumApi')>('@/lib/curriculumApi');
    const transport = vi.mocked(coachFetch).mockRejectedValue(new TypeError('Connection lost after sending'));
    await expect(real.confirmImportedCalendarUpdate(liveSessionId, 'signed-review', true)).rejects.toThrow('Connection lost after sending');
    expect(transport).toHaveBeenCalledOnce();
  });
});
