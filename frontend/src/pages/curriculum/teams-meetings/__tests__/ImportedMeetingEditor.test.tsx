import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readImportedMeetingEditor, previewImportedMeetingEdit, confirmImportedMeetingEdit, checkImportedMeetingEdit,
  type ImportedMeetingEditor as EditorData } from '@/lib/curriculumApi';
import { ImportedMeetingEditor } from '../ImportedMeetingEditor';

vi.mock('@/lib/curriculumApi', () => ({ readImportedMeetingEditor: vi.fn(), previewImportedMeetingEdit: vi.fn(),
  confirmImportedMeetingEdit: vi.fn(), checkImportedMeetingEdit: vi.fn() }));

const original = (): EditorData => ({ status: 'editable', sourceToken: 'verified-original', message: 'Original calendar verified.',
  organizer: 'owner@example.invalid', attendees: ['old@example.invalid'], presenters: ['presenter@example.invalid'],
  coOrganizers: [], rolesEditable: true, timeZone: 'Europe/London',
  options: { recordAutomatically: true, allowTranscription: true, lobbyBypassSettings: { scope: 'invited' }, meetingSpokenLanguageTag: 'en-GB' },
  sessions: [{ sessionNumber: 1, start: '2030-10-25T11:00:00Z', end: '2030-10-25T13:00:00Z', editable: false },
    { sessionNumber: 2, start: '2030-11-01T12:00:00Z', end: '2030-11-01T14:00:00Z', editable: true }],
});

beforeEach(() => {
  vi.mocked(readImportedMeetingEditor).mockReset().mockResolvedValue(original());
  vi.mocked(previewImportedMeetingEdit).mockReset().mockResolvedValue({ status: 'ready', message: 'Review these edits.',
    previewToken: 'signed-edit', operationId: 'OP', addedSessions: [], notificationScope: 'No LMS email; Microsoft silence requested.' });
  vi.mocked(confirmImportedMeetingEdit).mockReset().mockResolvedValue({ status: 'confirmed', operationId: 'OP', message: 'Edits verified.' });
  vi.mocked(checkImportedMeetingEdit).mockReset().mockResolvedValue({ status: 'confirmed', operationId: 'OP', message: 'Edits verified.' });
});

function open() {
  const onUpdated = vi.fn(async () => undefined);
  return { onUpdated, ...render(<ImportedMeetingEditor liveSessionId="LIVE" disabled={false} onUpdated={onUpdated} />) };
}

async function edit() {
  await userEvent.click(screen.getByRole('button', { name: 'Edit existing Teams meeting' }));
  await screen.findByLabelText(/Calendar invitees/);
}

describe('editing a verified imported meeting', () => {
  it('does not write or read Microsoft until asked to open the editor', async () => {
    open();
    expect(readImportedMeetingEditor).not.toHaveBeenCalled();
    await edit();
    expect(readImportedMeetingEditor).toHaveBeenCalledExactlyOnceWith('LIVE');
    expect(screen.getByLabelText(/Calendar invitees/)).toHaveValue('old@example.invalid');
    expect(screen.getByLabelText('Recording')).toHaveValue('record-transcribe');
    expect(screen.getByLabelText('Session 1 start')).toBeDisabled();
    expect(screen.getByLabelText('Session 2 start')).toHaveValue('2030-11-01T12:00');
    expect(previewImportedMeetingEdit).not.toHaveBeenCalled();
    expect(confirmImportedMeetingEdit).not.toHaveBeenCalled();
  });

  it('reviews an attendee removal with silence requested, without resending options or dates', async () => {
    const { onUpdated } = open();
    await edit();
    fireEvent.change(screen.getByLabelText(/Calendar invitees/), { target: { value: 'new@example.invalid' } });
    await userEvent.click(screen.getByRole('button', { name: 'Save without notifying' }));
    expect(previewImportedMeetingEdit).toHaveBeenCalledExactlyOnceWith('LIVE', 'verified-original', { attendees: ['new@example.invalid'] }, false);
    expect(await screen.findByRole('button', { name: 'Confirm meeting edits' })).toBeDisabled();
    expect(confirmImportedMeetingEdit).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('checkbox', { name: /I reviewed these edits/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm meeting edits' }));
    await waitFor(() => expect(onUpdated).toHaveBeenCalledOnce());
    expect(confirmImportedMeetingEdit).toHaveBeenCalledExactlyOnceWith('LIVE', 'signed-edit');
  });

  it('keeps the notification choice separate from an options-only change', async () => {
    open(); await edit();
    await userEvent.selectOptions(screen.getByLabelText('Spoken language'), 'ar-EG');
    await userEvent.click(screen.getByRole('button', { name: 'Review update and notify' }));
    expect(previewImportedMeetingEdit).toHaveBeenCalledExactlyOnceWith('LIVE', 'verified-original', { language: 'ar-EG' }, true);
  });

  it('sends a future move in the business time zone and retains its duration', async () => {
    open(); await edit();
    fireEvent.change(screen.getByLabelText('Session 2 start'), { target: { value: '2030-11-01T13:00' } });
    await userEvent.click(screen.getByRole('button', { name: 'Save without notifying' }));
    expect(previewImportedMeetingEdit).toHaveBeenCalledExactlyOnceWith('LIVE', 'verified-original', {
      sessions: [{ sessionNumber: 2, start: '2030-11-01T13:00:00.000Z', durationMinutes: 120 }],
    }, false);
  });

  it('keeps edits after cancelling a review and never confirms it', async () => {
    open(); await edit();
    fireEvent.change(screen.getByLabelText(/Calendar invitees/), { target: { value: 'new@example.invalid' } });
    await userEvent.click(screen.getByRole('button', { name: 'Save without notifying' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel edit review' }));
    expect(screen.getByLabelText(/Calendar invitees/)).toHaveValue('new@example.invalid');
    expect(confirmImportedMeetingEdit).not.toHaveBeenCalled();
  });

  it('recovers a lost save response using a read-only status check', async () => {
    vi.mocked(confirmImportedMeetingEdit).mockRejectedValue(new Error('timeout'));
    const { onUpdated } = open(); await edit();
    await userEvent.click(screen.getByRole('button', { name: 'Save without notifying' }));
    await userEvent.click(await screen.findByRole('checkbox', { name: /I reviewed these edits/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm meeting edits' }));
    const status = await screen.findByRole('button', { name: 'Check edit status' });
    expect(screen.queryByRole('button', { name: 'Confirm meeting edits' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save without notifying' })).toBeDisabled();
    await userEvent.click(status);
    await waitFor(() => expect(onUpdated).toHaveBeenCalledOnce());
    expect(checkImportedMeetingEdit).toHaveBeenCalledExactlyOnceWith('LIVE', 'OP');
    expect(confirmImportedMeetingEdit).toHaveBeenCalledTimes(1);
  });

  it('shows missing original-calendar access without inventing an empty editable roster', async () => {
    vi.mocked(readImportedMeetingEditor).mockResolvedValue({ status: 'blocked', message: 'Original calendar unavailable.', connectionRequired: true });
    open();
    await userEvent.click(screen.getByRole('button', { name: 'Edit existing Teams meeting' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Original calendar unavailable.');
    expect(screen.queryByLabelText(/Calendar invitees/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save without notifying' })).not.toBeInTheDocument();
  });

  it('does not allow stale asynchronous data to appear after the module closes', async () => {
    let resolve!: (value: EditorData) => void;
    vi.mocked(readImportedMeetingEditor).mockReturnValue(new Promise(done => { resolve = done; }));
    const { unmount } = open();
    await userEvent.click(screen.getByRole('button', { name: 'Edit existing Teams meeting' }));
    unmount();
    await act(async () => { resolve(original()); });
    expect(confirmImportedMeetingEdit).not.toHaveBeenCalled();
  });
});
