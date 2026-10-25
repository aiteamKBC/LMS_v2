import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MigratedMeetingIntelligence } from './MigratedMeetingIntelligence';

const api = vi.hoisted(() => ({
  fetch: vi.fn(),
  save: vi.fn(),
}));
vi.mock('@/api/reviewInstances', () => ({
  fetchMigratedReviewIntelligence: api.fetch,
  saveMigratedMeetingSummary: api.save,
}));

const id = 'imported-review:C5-TEST-MCM-20261002-001';
const empty = {
  artifacts: [], attendance: { reports: [], records: [], reportCount: 0, attendedCount: 0, absentCount: 0, participantCount: 0 },
  intelligence: { attendanceStatus: 'not-checked', recordingStatus: 'unknown', transcriptStatus: 'not-checked', summaryStatus: 'not-generated', errorCodes: [] },
  meetingSummary: null, errors: [],
};

beforeEach(() => {
  api.fetch.mockReset().mockResolvedValue(empty);
  api.save.mockReset();
});
afterEach(cleanup);

describe('migrated meeting intelligence', () => {
  it.each(['success', 'failure'])('keeps a new session check intact when the previous check ends with %s', async outcome => {
    let resolveOld!: (value: typeof empty) => void;
    let rejectOld!: (reason: Error) => void;
    let resolveNew!: (value: typeof empty) => void;
    const oldRequest = new Promise<typeof empty>((resolve, reject) => { resolveOld = resolve; rejectOld = reject; });
    const newRequest = new Promise<typeof empty>(resolve => { resolveNew = resolve; });
    api.fetch.mockImplementation((key, _signal, options) => options?.refresh ? (key === id ? oldRequest : newRequest) : Promise.resolve(empty));
    const oldComplete = vi.fn(), newComplete = vi.fn(), checking = vi.fn();
    const { rerender } = render(<MigratedMeetingIntelligence instanceId={id} family="aptem_mcm" status="in-progress"
      viewAs={false} onCheckComplete={oldComplete} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Check Session' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Check Session' }));
    await waitFor(() => expect(api.fetch).toHaveBeenCalledWith(id, undefined, { refresh: true }));
    rerender(<MigratedMeetingIntelligence instanceId="imported-review:new" family="aptem_progress_review" status="in-progress"
      viewAs={false} onCheckComplete={newComplete} onCheckingChange={checking} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Check Session' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Check Session' }));
    await waitFor(() => expect(checking).toHaveBeenCalledWith(true));
    await act(async () => {
      if (outcome === 'failure') rejectOld(new Error('Previous session failure'));
      else resolveOld(empty);
    });
    expect(oldComplete).not.toHaveBeenCalled();
    expect(newComplete).not.toHaveBeenCalled();
    expect(checking).not.toHaveBeenCalledWith(false);
    expect(screen.queryByText(/Previous session failure/)).not.toBeInTheDocument();
    await act(async () => { resolveNew(empty); });
    expect(newComplete).toHaveBeenCalledExactlyOnceWith(empty);
    expect(checking).toHaveBeenLastCalledWith(false);
  });

  it('updates the summary status from an uploaded binding without another Teams request', async () => {
    const { rerender } = render(<MigratedMeetingIntelligence instanceId={id} family="aptem_mcm" status="in-progress"
      viewAs={false} bound savedBinding={{ fieldKey: 'recap', generationStatus: 'failed' }} />);
    await waitFor(() => expect(api.fetch).toHaveBeenCalledTimes(1));
    rerender(<MigratedMeetingIntelligence instanceId={id} family="aptem_mcm" status="in-progress"
      viewAs={false} bound savedBinding={{ fieldKey: 'recap', generationStatus: 'ready',
        generationAttemptedAt: '2026-10-20T09:00:00Z' }} />);
    expect(await screen.findByText('AI generated')).toBeVisible();
    expect(api.fetch).toHaveBeenCalledTimes(1);
  });

  it('reads locally on open and checks Graph only after a coach click', async () => {
    const user = userEvent.setup();
    render(<MigratedMeetingIntelligence instanceId={id} family="aptem_mcm" status="in-progress" viewAs={false} />);
    await waitFor(() => expect(screen.getAllByText('Not checked')).toHaveLength(2));
    expect(api.fetch).toHaveBeenCalledTimes(1);
    expect(api.fetch.mock.calls[0][2]).toEqual({ refresh: false });
    await user.click(screen.getByRole('button', { name: 'Check Session' }));
    await waitFor(() => expect(api.fetch).toHaveBeenCalledTimes(2));
    expect(api.fetch.mock.calls[1][2]).toEqual({ refresh: true });
  });

  it.each(['scheduled', 'in-progress'])('shows saved intelligence and saves a coach edit in %s without refreshing Teams', async status => {
    const user = userEvent.setup();
    api.fetch.mockResolvedValue({
      ...empty,
      attendance: { ...empty.attendance, reportCount: 1, reports: [{
        id: 'report-1', meetingStartDateTime: '2026-11-18T14:00:00Z', meetingEndDateTime: '2026-11-18T14:30:00Z',
        totalParticipantCount: 1, attendedCount: 1, absentCount: 0,
        records: [{ id: 'learner-1', displayName: 'Synthetic learner', email: 'test@example.invalid', totalAttendanceSeconds: 1800, attended: true,
          intervals: [{ joinDateTime: '2026-11-18T14:00:00Z', leaveDateTime: '2026-11-18T14:30:00Z' }] }],
      }] },
      artifacts: [{ id: 'transcript-1', artifact_type: 'transcript', graph_artifact_id: 'transcript-1' }],
      intelligence: { attendanceStatus: 'available', recordingStatus: 'not-available', transcriptStatus: 'available', summaryStatus: 'ready', errorCodes: [] },
      meetingSummary: { status: 'ready', summary: { title: 'MCM recap', overview: 'Initial recap', keyPoints: [], actions: [], nextSteps: [], support: [] } },
    });
    api.save.mockResolvedValue({ answerVersion: 'after-summary', progressVersion: 'after-summary', reviewAnswers: { note: 'Saved words' }, meetingSummary: { status: 'edited', summary: { title: 'MCM recap', overview: 'Coach revision', keyPoints: [], actions: [], nextSteps: [], support: [] } } });
    const onCheckComplete = vi.fn();
    render(<MigratedMeetingIntelligence instanceId={id} family="aptem_mcm" status={status} viewAs={false} onCheckComplete={onCheckComplete} />);
    expect(await screen.findByText('Initial recap')).toBeInTheDocument();
    expect(screen.getAllByText(/30 minutes/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Synthetic learner/)).toBeInTheDocument();
    expect(screen.getAllByText('Available').length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const editor = screen.getByDisplayValue('Initial recap');
    await user.clear(editor);
    await user.type(editor, 'Coach revision');
    await user.click(screen.getByRole('button', { name: 'Save recap' }));
    await waitFor(() => expect(api.save).toHaveBeenCalledWith(id, expect.objectContaining({ overview: 'Coach revision' })));
    expect(onCheckComplete).toHaveBeenCalledWith(expect.objectContaining({ answerVersion: 'after-summary', reviewAnswers: { note: 'Saved words' } }));
    expect(api.fetch.mock.calls.every(call => call[2]?.refresh === false)).toBe(true);
  });

  it('shows an inert Check Session for admin view-as and hides it on completed reviews', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<MigratedMeetingIntelligence instanceId={id} family="aptem_mcm" status="in-progress" viewAs />);
    await screen.findByText(/Admin view-as is read-only/);
    const button = await screen.findByRole('button', { name: 'Check Session' });
    expect(button).toBeDisabled();
    await user.click(button);
    button.focus();
    expect(button).not.toHaveFocus();
    await user.keyboard('{Enter} ');
    rerender(<MigratedMeetingIntelligence instanceId={id} family="aptem_mcm" status="completed" viewAs={false} />);
    expect(screen.queryByRole('button', { name: 'Check Session' })).not.toBeInTheDocument();
    expect(api.fetch.mock.calls.every(call => call[2]?.refresh === false)).toBe(true);
    expect(api.save).not.toHaveBeenCalled();
  });

  it('keeps form-independent pending and error states visible', async () => {
    api.fetch.mockResolvedValue({ ...empty, intelligence: { ...empty.intelligence, transcriptStatus: 'pending', errorCodes: ['ATTENDANCE_NOT_AVAILABLE'] } });
    render(<MigratedMeetingIntelligence instanceId={id} family="aptem_progress_review" status="scheduled" viewAs={false} />);
    expect(await screen.findByText('Pending; check again later')).toBeInTheDocument();
    expect(screen.getByText('ATTENDANCE_NOT_AVAILABLE')).toBeInTheDocument();
  });

  it('blocks checks and summary edits during a template conflict without labeling the coach as an admin', async () => {
    api.fetch.mockResolvedValue({ ...empty, meetingSummary: { status: 'ready', summary: { title: 'Summary', overview: 'Saved summary', keyPoints: [], actions: [], nextSteps: [], support: [] } } });
    render(<MigratedMeetingIntelligence instanceId={id} family="aptem_mcm" status="in-progress" viewAs={false} readOnly />);
    expect(await screen.findByText('Saved summary')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Check Session' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Admin view-as/)).not.toBeInTheDocument();
  });
});
