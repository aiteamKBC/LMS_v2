import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CoachMeetingArtifactsPanel } from './CoachMeetingArtifactsPanel';
import { reviewAttendanceLinks, type AttendanceLinkContext } from './reviewAttendanceLinks';

vi.mock('./reviewAttendanceLinks', () => ({ reviewAttendanceLinks: vi.fn() }));
const request = vi.mocked(reviewAttendanceLinks);
const event = { id: 'mcr:21:1', eventKey: 'mcr:21:1', source: 'mcr', meetingLink: 'https://example.invalid/meeting' };
const audit = { id: 1, confirmedBy: 'coach@example.invalid', confirmedAt: '2026-10-27T12:00:00Z',
  reason: 'Participant joined using a different email account.', revokedAt: null, revokedBy: null, undoReason: null };
function data(linked = false): AttendanceLinkContext {
  return { version: linked ? 'v2' : 'v1', learner: { id: 21, name: 'Synthetic learner' }, targets: linked ? [] : [{ key: 'learner', role: 'learner', name: 'Synthetic learner' }],
    candidates: linked ? [] : [{ rowId: 'extra', key: 'evidence-key' }], activeLinks: linked ? [audit] : [], history: linked ? [audit] : [],
    attendance: { reports: [], records: [], reportCount: 1, participantCount: 2, attendedCount: 1, absentCount: 1,
      expectedCount: 1, expectedAttendedCount: linked ? 1 : 0, expectedAbsentCount: linked ? 0 : 1, extraCount: linked ? 0 : 1,
      tracker: [{ id: 'learner', name: 'Synthetic learner', role: 'learner', expected: true, attended: linked,
        status: linked ? 'attended' : 'absent', totalAttendanceSeconds: linked ? 1200 : 0,
        ...(linked ? { coachVerification: audit, linkedEmail: 'alternate@example.invalid' } : {}) },
        ...(!linked ? [{ id: 'extra', name: 'Alternate account', role: 'attendee', expected: false, attended: true,
          status: 'extra', totalAttendanceSeconds: 1200 }] : [])] } };
}
function mount(canEdit = true) {
  const fetchArtifacts = vi.fn().mockResolvedValue({ artifacts: [], attendance: data().attendance });
  return render(<CoachMeetingArtifactsPanel event={event} fetchArtifacts={fetchArtifacts} showMeetingSummary={false}
    attendanceLinkKey={canEdit ? event.eventKey : undefined} />);
}
async function open() {
  fireEvent.click(await screen.findByRole('button', { name: 'Link Alternate account to expected participant' }));
}
beforeEach(() => { vi.resetAllMocks(); request.mockResolvedValue(data()); });
afterEach(cleanup);

describe('Review attendance identity link', () => {
  it('offers this Review employer and saves the explicitly selected employer target', async () => {
    const initial = data();
    initial.targets.push({ key: 'employer-key', role: 'employer', name: 'Example employer' });
    initial.attendance.tracker!.push({ id: 'employer', name: 'Example employer', role: 'employer', expected: true, attended: false, status: 'absent', totalAttendanceSeconds: 0 });
    request.mockResolvedValueOnce(initial);
    mount(); await open();
    expect(screen.getByRole('option', { name: 'Learner — Synthetic learner' })).toBeVisible();
    expect(screen.getByRole('option', { name: 'Employer — Example employer' })).toBeVisible();
    fireEvent.change(screen.getByLabelText('Expected participant'), { target: { value: 'employer-key' } });
    const saved = data();
    saved.candidates = [];
    saved.activeLinks = [{ ...audit, targetRole: 'employer', targetName: 'Example employer' }];
    saved.history = saved.activeLinks;
    saved.attendance.tracker = [initial.attendance.tracker![0], { ...initial.attendance.tracker![2], attended: true, status: 'attended', coachVerification: audit }];
    request.mockResolvedValueOnce(saved);
    fireEvent.click(screen.getByRole('button', { name: /^Confirm$/ }));
    await screen.findByText('Present · Coach verified');
    expect(request).toHaveBeenLastCalledWith(event.eventKey, { action: 'link', targetKey: 'employer-key', participantKey: 'evidence-key', version: 'v1', reason: audit.reason });
    expect(screen.getByText('Absent')).toBeVisible();
    expect(screen.getAllByText('Employer — Example employer').length).toBeGreaterThan(0);
  });

  it('requires explicit learner selection and saves the source evidence/version, never an email guess', async () => {
    mount(); await open();
    expect(screen.getByRole('button', { name: /^Confirm$/ })).toBeDisabled();
    fireEvent.change(screen.getByRole('combobox', { name: 'Expected participant' }), { target: { value: 'learner' } });
    request.mockResolvedValueOnce(data(true));
    fireEvent.click(screen.getByRole('button', { name: /^Confirm$/ }));
    expect(await screen.findByText('Present · Coach verified')).toBeVisible();
    expect(request).toHaveBeenLastCalledWith(event.eventKey, {
      action: 'link', targetKey: 'learner', participantKey: 'evidence-key', version: 'v1', reason: audit.reason,
    });
    expect(screen.queryByText('Alternate account')).not.toBeInTheDocument();
    expect(screen.getByText('Linked Teams account: alternate@example.invalid')).toBeVisible();
  });

  it('cancel never writes and does not alter the raw absence', async () => {
    mount(); await open(); fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(request).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Absent')).toBeVisible();
  });

  it('retains failed submission and allows reloading a conflicting report', async () => {
    mount(); await open();
    fireEvent.change(screen.getByLabelText('Expected participant'), { target: { value: 'learner' } });
    request.mockRejectedValueOnce(new Error('Attendance changed. Reload it before confirming.'));
    fireEvent.click(screen.getByRole('button', { name: /^Confirm$/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Attendance changed');
    expect(screen.getByText('Absent')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Reload attendance' }));
    await waitFor(() => expect(request).toHaveBeenCalledTimes(3));
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('requires an undo reason, restores original rows, and retains history', async () => {
    request.mockResolvedValueOnce(data(true)); mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Undo link' }));
    expect(screen.getByRole('button', { name: 'Confirm undo' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Undo reason'), { target: { value: 'Wrong person' } });
    const undone = data(); undone.history = [{ ...audit, revokedAt: '2026-10-27T12:05:00Z', revokedBy: audit.confirmedBy, undoReason: 'Wrong person' }];
    request.mockResolvedValueOnce(undone);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm undo' }));
    expect(await screen.findByText('Absent')).toBeVisible();
    expect(request).toHaveBeenLastCalledWith(event.eventKey, { action: 'undo', linkId: 1, version: 'v2', reason: 'Wrong person' });
    expect(screen.getByText(/Undone by/)).toBeInTheDocument();
  });

  it('hides all write controls and makes no correction requests for read-only callers', async () => {
    mount(false); await screen.findByText('Alternate account');
    expect(screen.queryByRole('button', { name: /Link .* to expected participant/ })).not.toBeInTheDocument();
    expect(request).not.toHaveBeenCalled();
  });

  it('shows loading and storage errors without claiming a correction succeeded', async () => {
    let reject!: (reason: Error) => void;
    request.mockReturnValueOnce(new Promise((_, fail) => { reject = fail; }));
    mount(); await screen.findByText('Loading attendance corrections…');
    reject(new Error('Attendance correction storage is unavailable.'));
    expect(await screen.findByRole('alert')).toHaveTextContent('storage is unavailable');
    expect(screen.queryByText('Present · Coach verified')).not.toBeInTheDocument();
  });

  it('blocks duplicate confirmation clicks while saving', async () => {
    mount(); await open();
    fireEvent.change(screen.getByLabelText('Expected participant'), { target: { value: 'learner' } });
    request.mockReturnValueOnce(new Promise(() => {}));
    fireEvent.click(screen.getByRole('button', { name: /^Confirm$/ }));
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Saving…' }));
    expect(request).toHaveBeenCalledTimes(2);
  });
});
