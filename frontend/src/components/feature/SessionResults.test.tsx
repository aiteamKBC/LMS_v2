import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionResults } from './SessionResults';
import { ModuleSessions } from '@/pages/curriculum/module-workspace/ModuleSessions';
import { coachFetch } from '@/lib/coachFetch';

vi.mock('@/lib/coachFetch', () => ({ coachFetch: vi.fn() }));
const session = {
  id: 'O1', seriesId: 'S1', sessionNumber: 1, startsAt: '2026-09-01T09:00:00Z', endsAt: '2026-09-01T10:00:00Z',
  state: 'completed', reportReady: true, syncedAt: '2026-09-01T11:00:00Z',
  attendance: [{ email: 'learner@example.invalid', name: 'Learner One', seconds: 240,
    attendance: 1, status: 'present', rawAttendance: 1, rawStatus: 'present',
    effectiveAttendance: 1, effectiveStatus: 'present', finalOutcome: 'present',
    excuseStatus: 'none', recoveryStatus: 'none', expected: true, excused: false, catchupCompleted: false }],
  artifacts: [{ id: 'recording-1', type: 'recording', state: 'ready' }, { id: 'transcript-1', type: 'transcript', state: 'ready', text: 'Speaker: Saved lesson.' }],
};
const fetchMock = vi.fn();
const ok = (data: unknown) => Promise.resolve({ ok: true, json: async () => data });
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal('fetch', fetchMock); fetchMock.mockImplementation(() => ok({ sessions: [session] })); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('Saved session results', () => {
  it('shows the two event recordings on 2 October and the two lecture recordings on 9 October', async () => {
    const dated = { ...session, startsAt: '2026-10-09T08:00:00Z',
      artifacts: [
        { id: 'event-1', type: 'recording', state: 'ready', createdAt: '2026-10-02T08:05:00Z' },
        { id: 'event-2', type: 'recording', state: 'ready', createdAt: '2026-10-02T10:35:00Z' },
        { id: 'lecture-1', type: 'recording', state: 'ready', createdAt: '2026-10-09T06:43:00Z' },
        { id: 'lecture-2', type: 'recording', state: 'ready', createdAt: '2026-10-09T10:43:00Z' },
      ] };
    fetchMock.mockImplementation(() => ok({ sessions: [dated] }));
    const { unmount } = render(<MemoryRouter><SessionResults seriesId="S1" sessionNumber={3}
      recordingDate="2026-10-02" recordingsOnly learner={{ kind: 'commercial', id: '7' }} /></MemoryRouter>);
    await screen.findByLabelText('Session recording 1');
    expect(document.querySelectorAll('video')).toHaveLength(2);
    expect([...document.querySelectorAll('video')].map(video => video.getAttribute('src')))
      .toEqual([expect.stringContaining('event-1'), expect.stringContaining('event-2')]);
    expect(screen.getByText('Recorded on 2026-10-02 (UK date)')).toBeInTheDocument();
    expect(screen.queryByText(/Scheduled:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Your original attendance:/)).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'transcripts' })).not.toBeInTheDocument();
    unmount();
    render(<MemoryRouter><SessionResults seriesId="S1" sessionNumber={3}
      recordingDate="2026-10-09" learner={{ kind: 'commercial', id: '7' }} /></MemoryRouter>);
    await screen.findByLabelText('Session recording 1');
    expect(document.querySelectorAll('video')).toHaveLength(2);
    expect([...document.querySelectorAll('video')].map(video => video.getAttribute('src')))
      .toEqual([expect.stringContaining('lecture-1'), expect.stringContaining('lecture-2')]);
    expect(screen.getByText(/Scheduled:/)).toBeInTheDocument();
  });
  it('shows the read-only account check beside the register without changing attendance', async () => {
    const account = (overrides: Record<string, unknown>) => ({ sourceRecordIds: ['R1'], displayName: '', teamsRole: 'Attendee',
      verification: 'verified', tenant: 'home', accountType: 'Microsoft work or school account', email: '', emailSource: 'teams',
      otherEmails: [], enteredEmail: '', lookup: '', linkedBy: 'email', status: 'matched', reason: '', joins: 1, seconds: 240, ...overrides });
    const identityCheck = {
      counts: { matched: 1, 'different-account': 1, 'unverified-guest': 1, unknown: 0, unmatched: 0 }, lookupPending: 1,
      participants: [
        { kind: 'learner', name: 'Learner One', roles: ['Learner'], learnerProfileId: 1, expectedEmail: 'learner@example.invalid',
          linkedBy: ['email'], teamsRoles: ['Attendee'], status: 'matched', reason: 'Signed in to Microsoft with the LMS email.',
          accounts: [account({ email: 'learner@example.invalid' })] },
        { kind: 'learner', name: 'Learner Two', roles: ['Learner'], learnerProfileId: 2, expectedEmail: 'two@example.invalid',
          linkedBy: ['alias'], teamsRoles: ['Attendee'], status: 'different-account', reason: 'Signed in to Microsoft as home@other.invalid, not the LMS email.',
          accounts: [account({ sourceRecordIds: ['R2'], email: 'home@other.invalid', tenant: 'external', status: 'different-account' })] },
        { kind: 'learner', name: 'Learner Three', roles: ['Learner'], learnerProfileId: 3, expectedEmail: 'three@example.invalid',
          linkedBy: ['name'], teamsRoles: ['Attendee'], status: 'unverified-guest', reason: 'Joined without signing in to Microsoft, so Microsoft cannot confirm who this was.',
          accounts: [account({ sourceRecordIds: ['R3'], verification: 'unverified', accountType: 'anonymous guest', enteredEmail: 'three@example.invalid', status: 'unverified-guest' })] },
      ],
    };
    fetchMock.mockImplementation(() => ok({ sessions: [{ ...session, identityCheck }] }));
    render(<SessionResults seriesId="S1" sessionNumber={1} />);
    fireEvent.click(await screen.findByRole('tab', { name: 'attendance' }));
    fireEvent.click(screen.getByRole('button', { name: /Account check/ }));
    expect(screen.getByText('home@other.invalid')).toBeInTheDocument();
    expect(screen.getByText('Typed three@example.invalid (not verified)')).toBeInTheDocument();
    expect(screen.getByText(/1 signed-in account has no email yet/)).toBeInTheDocument();
    // Matched learners are hidden until "Everyone" is chosen; the register still lists them.
    expect(screen.queryByText('Signed in to Microsoft with the LMS email.')).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: /Show/ }), { target: { value: 'all' } });
    expect(screen.getByText('Signed in to Microsoft with the LMS email.')).toBeInTheDocument();
    expect(screen.getAllByText('Present').length).toBeGreaterThan(0);
    expect(coachFetch).not.toHaveBeenCalled();
  });

  it('shows refresh feedback while keeping the saved video mounted', async () => {
    render(<SessionResults seriesId="S1" sessionNumber={1} />);
    const video = await screen.findByLabelText('Session recording 1');
    let finish!: (response: unknown) => void;
    fetchMock.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh saved results' }));
    expect(screen.getByRole('button', { name: 'Refreshing…' })).toBeDisabled();
    expect(screen.getByLabelText('Session recording 1')).toBe(video);
    finish({ ok: true, json: async () => ({ sessions: [session] }) });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh saved results' })).toBeEnabled());
    expect(coachFetch).not.toHaveBeenCalled();
  });

  it('shows series transfer progress in the module index without loading rosters', async () => {
    fetchMock.mockImplementationOnce(() => ok({ series: [{ id: 'S1', title: 'Example', sessions: [session] }],
      jobs: [{ live_session_id: 'S1', state: 'running', progress: { filesReady: 0, totalFiles: 2,
        transfer: { phase: 'uploading', bytesTransferred: 25, totalBytes: 100, updatedAt: new Date().toISOString(),
          type: 'recording', sessionNumber: 1 } } }] }));
    render(<ModuleSessions moduleId="M" />);
    expect(await screen.findByRole('progressbar', { name: 'Uploading recording to Azure' })).toHaveAttribute('aria-valuenow', '25');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(coachFetch).not.toHaveBeenCalled();
  });

  it('lets staff hide a recording without deleting it or requesting Teams sync', async () => {
    vi.mocked(coachFetch).mockResolvedValue({ ok: true, json: async () => ({ hiddenFromLearners: true }) } as Response);
    render(<SessionResults seriesId="S1" sessionNumber={1} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Hide from learners' }));
    await waitFor(() => expect(coachFetch).toHaveBeenCalledWith(
      '/curriculum_api/curriculum/session-results/S1/artifacts/recording-1/visibility/',
      expect.objectContaining({ method: 'POST', body: '{"hidden":true}' })));
    expect(screen.getByLabelText('Session recording 1')).toBeInTheDocument();
  });

  it('keeps hidden recordings and transcripts out of learner preview', async () => {
    fetchMock.mockImplementation(() => ok({ sessions: [{ ...session,
      artifacts: session.artifacts.map(file => ({ ...file, hiddenFromLearners: true })) }] }));
    render(<SessionResults seriesId="S1" sessionNumber={1} preview />);
    await screen.findByText(/No recording is saved/);
    expect(screen.queryByLabelText('Session recording 1')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /learners/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'transcripts' }));
    expect(screen.queryByText('Speaker: Saved lesson.')).not.toBeInTheDocument();
  });
  it('labels the exact scheduled session separately from the recorded meeting date', async () => {
    fetchMock.mockImplementation(() => ok({ sessions: [{ ...session, title: 'Example lecture',
      actualStartsAt: '2026-08-31T11:00:00Z', artifacts: [] }] }));
    render(<SessionResults seriesId="S1" sessionNumber={1} />);
    await screen.findByText('Example lecture');
    expect(screen.getByText(/^Scheduled:/)).toHaveTextContent('1 Sept 2026');
    expect(screen.getByText(/^Recorded meeting:/)).toHaveTextContent('31 Aug 2026');
    expect(screen.getByText(/No recording is saved for this session/)).toBeInTheDocument();
  });
  it('explains a future staff session without calling its missing results an error', async () => {
    fetchMock.mockImplementation(() => ok({ sessions: [{ ...session,
      startsAt: '2099-10-16T09:00:00Z', endsAt: '2099-10-16T11:00:00Z',
      state: 'scheduled', reportReady: false, syncedAt: undefined, attendance: [], artifacts: [],
    }], job: { live_session_id: 'S1', state: 'failed', last_error: 'A prior sync needs retry.' } }));
    render(<SessionResults seriesId="S1" sessionNumber={1} />);
    expect(await screen.findByText(/This session has not taken place yet/)).toBeInTheDocument();
    expect(screen.getByText('Results will be available after this session.')).toBeInTheDocument();
    expect(screen.getByText('Recordings will appear here if this session is recorded.')).toBeInTheDocument();
    expect(screen.getByText('Sync status for the full meeting series')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('A prior sync needs retry.');
    fireEvent.click(screen.getByRole('tab', { name: 'attendance' }));
    expect(screen.getByText(/Attendance will be available after this session ends/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'transcripts' }));
    expect(screen.getByText('Transcripts will appear here if this session is transcribed.')).toBeInTheDocument();
  });
  it('shows the future session message to a learner without an absence warning', async () => {
    fetchMock.mockImplementation(() => ok({ sessions: [{ ...session,
      startsAt: '2099-10-16T09:00:00Z', endsAt: '2099-10-16T11:00:00Z',
      state: 'scheduled', reportReady: false, syncedAt: undefined, attendance: [], artifacts: [],
    }] }));
    render(<MemoryRouter><SessionResults seriesId="S1" sessionNumber={1}
      learner={{ kind: 'commercial', id: '7' }} /></MemoryRouter>);
    expect(await screen.findByText(/This session has not taken place yet/)).toBeInTheDocument();
    expect(screen.getByText('Your original attendance: Not available yet')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText(/Sync status for the full meeting series/)).not.toBeInTheDocument();
  });
  it('loads one saved session and embeds private playback without Graph sync', async () => {
    render(<MemoryRouter><SessionResults seriesId="S1" sessionNumber={1} /></MemoryRouter>);
    const video = await screen.findByLabelText('Session recording 1');
    expect(video).toHaveAttribute('preload', 'none');
    expect(video).toHaveAttribute('src', '/curriculum_api/curriculum/session-results/S1/artifacts/recording-1/');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(coachFetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('tab', { name: 'transcripts' }));
    expect(screen.getByText('Speaker: Saved lesson.')).toBeInTheDocument();
    expect(screen.getByText('Download TXT')).toHaveAttribute('href', expect.stringContaining('?format=txt'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('learner uses the scoped route and cannot access the attendance roster or export', async () => {
    render(<MemoryRouter><SessionResults seriesId="S1" sessionNumber={1} learner={{ kind: 'commercial', id: '7' }} /></MemoryRouter>);
    await screen.findByText('Your original attendance: Present');
    expect(fetchMock.mock.calls[0][0]).toBe('/learner_api/session-results/commercial/7/S1/sessions/1/');
    expect(screen.queryByRole('tab', { name: 'attendance' })).not.toBeInTheDocument();
    expect(screen.queryByText('Export attendance CSV')).not.toBeInTheDocument();
    expect(screen.queryByText('Export attendance PDF')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Session recording 1')).toHaveAttribute('src', '/learner_api/session-results/commercial/7/S1/artifacts/recording-1/');
  });

  it.each(['commercial', 'apprenticeship'] as const)('credits live attendance for a Recorded %s learner without requiring playback', async kind => {
    render(<MemoryRouter><SessionResults seriesId="S1" sessionNumber={1}
      learner={{ kind, id: '7' }} attendanceType="Recorded" /></MemoryRouter>);
    expect(await screen.findByText('Your original attendance: Present')).toBeInTheDocument();
    expect(screen.getByText('Your live attendance counts for this session. Watching the recording is optional.')).toBeInTheDocument();
    expect(screen.queryByText('Open attendance and report absence')).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'attendance' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Session recording 1')).toBeInTheDocument();
    expect(fetchMock.mock.calls.every(([, options]) => !options?.method || options.method === 'GET')).toBe(true);
  });

  it.each(['absent', 'pending', 'review', 'made_up'])('does not claim live attendance for a Recorded learner with %s outcome', async outcome => {
    const raw = outcome === 'made_up' ? 'absent' : outcome;
    fetchMock.mockImplementation(() => ok({ sessions: [{ ...session, attendance: [{ ...session.attendance[0],
      status: raw, rawStatus: raw, attendance: outcome === 'made_up' ? 1 : 0,
      rawAttendance: 0, effectiveAttendance: outcome === 'made_up' ? 1 : 0, finalOutcome: outcome,
    }] }] }));
    render(<MemoryRouter><SessionResults seriesId="S1" sessionNumber={1}
      learner={{ kind: 'commercial', id: '7' }} attendanceType="Recorded" /></MemoryRouter>);
    await screen.findByLabelText('Session recording 1');
    expect(screen.queryByText(/Your original attendance:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Watching the recording is optional/)).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'recordings' })).toBeInTheDocument();
  });

  it('keeps the Teams attendance card for a Not recorded learner', async () => {
    render(<MemoryRouter><SessionResults seriesId="S1" sessionNumber={1}
      learner={{ kind: 'commercial', id: '7' }} attendanceType="Not recorded" /></MemoryRouter>);
    expect(await screen.findByText('Your original attendance: Present')).toBeInTheDocument();
  });

  it('keeps a reported recovery separate from the original absence', async () => {
    fetchMock.mockImplementation(() => ok({ sessions: [{ ...session, attendance: [{ ...session.attendance[0],
      status: 'absent', attendance: 0, rawStatus: 'absent', rawAttendance: 0,
      effectiveStatus: 'absent', effectiveAttendance: 0, finalOutcome: 'absent',
      absenceReported: true, recoveryStatus: 'requested', recoveryType: 'recorded', excused: false }] }] }));
    render(<MemoryRouter><SessionResults seriesId="S1" sessionNumber={1} learner={{ kind: 'apprenticeship', id: '7' }} /></MemoryRouter>);
    expect(await screen.findByText('Your original attendance: Absent')).toBeInTheDocument();
    expect(screen.queryByText(/Effective outcome:/)).not.toBeInTheDocument();
    expect(screen.getByText('View recovery plan')).toHaveAttribute('href', '/learner/attendance');
  });

  it('shows made up separately without rewriting the original Teams absence', async () => {
    fetchMock.mockImplementation(() => ok({ sessions: [{ ...session, attendance: [{ ...session.attendance[0],
      status: 'absent', attendance: 0, rawStatus: 'absent', rawAttendance: 0,
      effectiveStatus: 'made_up', effectiveAttendance: 1, finalOutcome: 'made_up',
      excuseStatus: 'approved', recoveryStatus: 'catchup_booked', excused: true, catchupCompleted: true }] }] }));
    render(<MemoryRouter><SessionResults seriesId="S1" sessionNumber={1} learner={{ kind: 'apprenticeship', id: '7' }} /></MemoryRouter>);
    expect(await screen.findByText('Your original attendance: Absent')).toBeInTheDocument();
    expect(screen.getByText('Effective outcome: Made up — catch-up completed')).toBeInTheDocument();
    expect(screen.queryByText('Book catch-up with your coach')).not.toBeInTheDocument();
  });

  it('shows attendance and recovery state in the staff register', async () => {
    fetchMock.mockImplementation(() => ok({ sessions: [{ ...session, attendance: [
      { ...session.attendance[0], status: 'absent', attendance: 0, rawStatus: 'absent', rawAttendance: 0,
        name: 'Booked Learner', recoveryStatus: 'catchup_booked', recoveryType: 'catch-up' },
      { ...session.attendance[0], status: 'absent', attendance: 0, rawStatus: 'absent', rawAttendance: 0,
        name: 'No Recovery Learner', email: 'second@example.invalid', recoveryStatus: 'none' },
      { ...session.attendance[0], status: 'absent', attendance: 0, rawStatus: 'absent', rawAttendance: 0,
        name: 'Recovered Learner', email: 'third@example.invalid', recoveryStatus: 'completed', catchupCompleted: true },
    ] }] }));
    render(<MemoryRouter><SessionResults seriesId="S1" sessionNumber={1} /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('tab', { name: 'attendance' }));
    expect(screen.getByRole('columnheader', { name: 'Attendance' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Recovery' })).toBeInTheDocument();
    expect(screen.getByText('Catch-up booked')).toBeInTheDocument();
    expect(screen.getByText('Catch-up completed')).toBeInTheDocument();
    expect(screen.getByText('Not requested')).toBeInTheDocument();
  });

  it('uses the destination module roster when reviewing a replaced Teams link', async () => {
    const unmatched = { email: 'other@example.invalid', name: 'Other identity', seconds: 600,
      attendance: 1, status: 'present', rawAttendance: 1, rawStatus: 'present',
      expected: false, excused: false, catchupCompleted: false };
    fetchMock.mockImplementation(() => ok({ sessions: [{ ...session,
      unmatchedAttendance: [unmatched],
      attendanceCandidates: [{ learnerProfileId: 7, email: 'learner@example.invalid', name: 'Learner One' }],
    }] }));
    vi.mocked(coachFetch).mockResolvedValue({ ok: true, json: async () => ({
      aliasEmail: unmatched.email, learnerProfileId: 7,
      learnerEmail: 'learner@example.invalid', learnerName: 'Learner One',
    }) } as Response);

    render(<MemoryRouter><SessionResults seriesId="S1" sessionNumber={1} moduleId="DEST" /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('tab', { name: 'attendance' }));
    expect(fetchMock.mock.calls[0][0]).toBe('/curriculum_api/curriculum/session-results/S1/sessions/1/?moduleId=DEST');
    expect(screen.getByRole('link', { name: 'Export attendance CSV' })).toHaveAttribute(
      'href', '/curriculum_api/curriculum/session-results/S1/sessions/1/attendance.csv?moduleId=DEST');
    expect(screen.queryByText('Other identity')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Review unmatched participants (1)' }));
    fireEvent.change(screen.getByLabelText('Match other@example.invalid to learner'), { target: { value: '7' } });
    fireEvent.click(screen.getByRole('button', { name: 'Link identity' }));

    await waitFor(() => expect(coachFetch).toHaveBeenCalledWith(
      '/curriculum_api/curriculum/session-results/S1/sessions/1/attendance-alias/',
      expect.objectContaining({ method: 'POST', body: '{"aliasEmail":"other@example.invalid","learnerProfileId":7,"sourceRecordIds":[],"moduleId":"DEST"}' }),
    ));
    expect(await screen.findByText(/is now matched to Learner One/)).toBeInTheDocument();
  });

  it('groups email-less Teams records and sends their source identities for manual matching', async () => {
    const unmatched = { email: '', name: 'Shaz Yousaf', seconds: 6205, sourceRecordIds: ['ROW-1', 'ROW-2', 'ROW-3'],
      attendance: null, status: 'review', rawAttendance: null, rawStatus: 'review',
      expected: false, excused: false, catchupCompleted: false };
    fetchMock.mockImplementation(() => ok({ sessions: [{ ...session,
      unmatchedAttendance: [unmatched],
      attendanceCandidates: [{ learnerProfileId: 7, email: 'learner@example.invalid', name: 'Shezreah Yousaf' }],
    }] }));
    vi.mocked(coachFetch).mockResolvedValue({ ok: true, json: async () => ({
      aliasEmail: '', sourceRecordIds: unmatched.sourceRecordIds, learnerProfileId: 7,
      learnerEmail: 'learner@example.invalid', learnerName: 'Shezreah Yousaf',
    }) } as Response);

    render(<MemoryRouter><SessionResults seriesId="S1" sessionNumber={1} /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('tab', { name: 'attendance' }));
    fireEvent.click(screen.getByRole('button', { name: 'Review unmatched participants (1)' }));
    expect(screen.getByText('Unverified Teams identity')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Match Shaz Yousaf to learner'), { target: { value: '7' } });
    fireEvent.click(screen.getByRole('button', { name: 'Link identity' }));

    await waitFor(() => expect(coachFetch).toHaveBeenCalledWith(
      '/curriculum_api/curriculum/session-results/S1/sessions/1/attendance-alias/',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ aliasEmail: '', learnerProfileId: 7, sourceRecordIds: unmatched.sourceRecordIds }) }),
    ));
  });

  it('preselects a unique name suggestion but waits for staff confirmation', async () => {
    const unmatched = { email: '', name: 'Learner One', seconds: 600, sourceRecordIds: ['ROW-1'],
      suggestedLearnerProfileId: 7, attendance: null, status: 'review', rawAttendance: null, rawStatus: 'review',
      expected: false, excused: false, catchupCompleted: false };
    fetchMock.mockImplementation(() => ok({ sessions: [{ ...session,
      unmatchedAttendance: [unmatched],
      attendanceCandidates: [{ learnerProfileId: 7, email: 'learner@example.invalid', name: 'Learner One' }],
    }] }));
    vi.mocked(coachFetch).mockResolvedValue({ ok: true, json: async () => ({
      aliasEmail: '', sourceRecordIds: unmatched.sourceRecordIds, learnerProfileId: 7,
      learnerEmail: 'learner@example.invalid', learnerName: 'Learner One',
    }) } as Response);

    render(<MemoryRouter><SessionResults seriesId="S1" sessionNumber={1} /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('tab', { name: 'attendance' }));
    fireEvent.click(screen.getByRole('button', { name: 'Review unmatched participants (1)' }));
    const select = screen.getByLabelText('Match Learner One to learner');
    expect(select).toHaveValue('7');
    expect(screen.getByText(/Suggested from the Teams name/)).toBeInTheDocument();
    expect(coachFetch).not.toHaveBeenCalled();
    fireEvent.change(select, { target: { value: '' } });
    expect(screen.getByRole('button', { name: 'Link identity' })).toBeDisabled();
    fireEvent.change(select, { target: { value: '7' } });
    fireEvent.click(screen.getByRole('button', { name: 'Link identity' }));
    await waitFor(() => expect(coachFetch).toHaveBeenCalledTimes(1));
  });

  it('shows a failed archive without attempting playback', async () => {
    fetchMock.mockImplementation(() => ok({ sessions: [{ ...session, artifacts: [{ id: 'A', type: 'recording', state: 'failed' }] }],
      job: { live_session_id: 'S1', state: 'failed', last_error: 'Recording storage needs retry.' } }));
    render(<SessionResults seriesId="S1" sessionNumber={1} />);
    expect(await screen.findByText(/Saving this recording needs retry/)).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Recording storage needs retry.');
    expect(screen.queryByLabelText('Session recording 1')).not.toBeInTheDocument();
  });

  it('keeps network errors visible and supports a read-only retry', async () => {
    fetchMock.mockRejectedValueOnce(new Error('Saved results unavailable'));
    render(<SessionResults seriesId="S1" sessionNumber={1} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Saved results unavailable');
    fireEvent.click(screen.getByText('Refresh saved results'));
    expect(await screen.findByLabelText('Session recording 1')).toBeInTheDocument();
    expect(coachFetch).not.toHaveBeenCalled();
  });

  it('exports and searches only the opened session', async () => {
    render(<SessionResults seriesId="S1" sessionNumber={1} />);
    await screen.findByLabelText('Session recording 1');
    fireEvent.click(screen.getByRole('tab', { name: 'attendance' }));
    expect(screen.getByText('Export attendance CSV')).toHaveAttribute('href', '/curriculum_api/curriculum/session-results/S1/sessions/1/attendance.csv');
    fireEvent.change(screen.getByLabelText('Search attendance'), { target: { value: 'nobody' } });
    expect(screen.queryByText('Learner One')).not.toBeInTheDocument();
  });

  it('requests immediate processing and refreshes saved status without waiting on Graph', async () => {
    vi.mocked(coachFetch).mockResolvedValue({ ok: true, json: async () => ({ state: 'queued', message: 'Sync requested.' }) } as Response);
    render(<SessionResults seriesId="S1" sessionNumber={1} />);
    await screen.findByLabelText('Session recording 1');
    fireEvent.click(screen.getByRole('button', { name: 'Sync attendance & files' }));
    expect(await screen.findByText('Sync requested.')).toBeInTheDocument();
    expect(coachFetch).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it('keeps a completed session calm while retaining the worker error for staff', async () => {
    let state = 'running';
    fetchMock.mockImplementation(() => ok({ sessions: [session],
      job: { live_session_id: 'S1', state, last_error: state === 'failed' ? 'Recording storage needs retry.' : '' } }));
    render(<SessionResults seriesId="S1" sessionNumber={1} />);
    const video = await screen.findByLabelText('Session recording 1');
    expect(screen.getByText(/Sync in progress/)).toBeInTheDocument();
    state = 'failed';
    fireEvent.click(screen.getByRole('button', { name: 'Refresh saved results' }));
    expect(await screen.findByText('The recording and attendance for this session are saved.')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('View background sync notice'));
    expect(screen.getByText(/The last sync for this meeting series reported an issue/)).toHaveTextContent('Recording storage needs retry.');
    expect(screen.getByLabelText('Session recording 1')).toBe(video);
    expect(coachFetch).not.toHaveBeenCalled();
  });

  it('replaces the request notice with the actual completed status', async () => {
    vi.mocked(coachFetch).mockResolvedValue({ ok: true, json: async () => ({ state: 'queued', message: 'Sync requested.' }) } as Response);
    fetchMock.mockImplementationOnce(() => ok({ sessions: [session] }))
      .mockImplementation(() => ok({ sessions: [session], job: { live_session_id: 'S1', state: 'complete', last_error: '' } }));
    render(<SessionResults seriesId="S1" sessionNumber={1} />);
    await screen.findByLabelText('Session recording 1');
    fireEvent.click(screen.getByRole('button', { name: 'Sync attendance & files' }));
    expect(await screen.findByText(/Sync finished/)).toBeInTheDocument();
    expect(screen.queryByText('Sync requested.')).not.toBeInTheDocument();
  });

  it('offers the staff PDF for the exact session alongside the CSV', async () => {
    render(<SessionResults seriesId="S1" sessionNumber={1} />);
    await screen.findByLabelText('Session recording 1');
    fireEvent.click(screen.getByRole('tab', { name: 'attendance' }));
    expect(screen.getByRole('link', { name: 'Export attendance PDF' })).toHaveAttribute('href', '/curriculum_api/curriculum/session-results/S1/sessions/1/attendance.pdf');
    expect(screen.getByRole('link', { name: 'Export attendance CSV' })).toHaveAttribute('href', expect.stringContaining('attendance.csv'));
  });

  it('refreshes saved results without replacing the playing video or enqueueing sync', async () => {
    render(<SessionResults seriesId="S1" sessionNumber={1} />);
    const video = await screen.findByLabelText('Session recording 1') as HTMLVideoElement;
    video.currentTime = 42;
    fireEvent.click(screen.getByRole('button', { name: 'Refresh saved results' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(screen.getByLabelText('Session recording 1')).toBe(video);
    expect(video.currentTime).toBe(42);
    expect(coachFetch).not.toHaveBeenCalled();
  });

  it('keeps attendance visible with a precise setup warning when archive storage is missing', async () => {
    fetchMock.mockImplementation(() => ok({ sessions: [{ ...session, archiveReady: false,
      artifacts: session.artifacts.map(file => ({ ...file, state: 'pending' })) }] }));
    render(<SessionResults seriesId="S1" sessionNumber={1} />);
    expect(await screen.findByText(/Recording storage needs setup/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sync attendance & files' })).toBeDisabled();
    expect(screen.getByText(/Teams has a recording/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Session recording 1')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'attendance' }));
    expect(screen.getByText('Learner One')).toBeInTheDocument();
    expect(screen.getAllByText('Present')).toHaveLength(1);
    expect(coachFetch).not.toHaveBeenCalled();
  });

  it('previews saved media without exposing the roster or synchronization controls', async () => {
    render(<SessionResults seriesId="S1" sessionNumber={1} preview />);
    await screen.findByLabelText('Session recording 1');
    expect(screen.queryByRole('tab', { name: 'attendance' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sync attendance & files' })).not.toBeInTheDocument();
    expect(screen.queryByText('Your attendance: Present')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'transcripts' }));
    expect(screen.getByText('Speaker: Saved lesson.')).toBeInTheDocument();
    expect(coachFetch).not.toHaveBeenCalled();
  });
});

describe('Module session index', () => {
  beforeEach(() => { fetchMock.mockImplementation((url: string) => ok(url.includes('/modules/')
    ? { series: [{ id: 'S1', title: 'Example module', sessions: [session] }], jobs: [] }
    : { sessions: [session] })); });

  it('locates saved files in another occurrence without relinking either session', async () => {
    fetchMock.mockImplementation((url: string) => ok(url.includes('/modules/')
      ? { series: [{ id: 'S1', title: 'Example', sessions: [{ ...session, fileCount: 0 },
        { ...session, id: 'O6', sessionNumber: 6, fileCount: 4 }] }], jobs: [] }
      : { sessions: [{ ...session, artifacts: [] }] }));
    render(<ModuleSessions moduleId="M1" />);
    fireEvent.click(await screen.findByText('Session 1'));
    fireEvent.click(screen.getByRole('button', { name: /Session 6.*4 files/ }));
    await waitFor(() => expect(fetchMock.mock.calls.some(call => call[0].endsWith('/sessions/6/?moduleId=M1'))).toBe(true));
    expect(coachFetch).not.toHaveBeenCalled();
  });

  it('refreshes sync status immediately while keeping session details lazy', async () => {
    vi.mocked(coachFetch).mockResolvedValue({ ok: true, json: async () => ({ state: 'queued', message: 'Sync requested. Results will be saved in the background.' }) } as Response);
    render(<ModuleSessions moduleId="M1" />);
    await screen.findByText('Session 1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText('Sync attendance & files'));
    await screen.findByText('Sync requested. Results will be saved in the background.');
    expect(coachFetch).toHaveBeenCalledWith('/curriculum_api/curriculum/session-results/S1/sync/', { method: 'POST' });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls.every(call => call[0].includes('/modules/'))).toBe(true);
    fireEvent.click(screen.getByText('Session 1'));
    await screen.findByLabelText('Session recording 1');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('clears the previously selected session when the module changes', async () => {
    const page = render(<ModuleSessions moduleId="M1" />);
    fireEvent.click(await screen.findByText('Session 1'));
    await screen.findByLabelText('Session recording 1');
    page.rerender(<ModuleSessions moduleId="M2" />);
    await waitFor(() => expect(screen.queryByLabelText('Session recording 1')).not.toBeInTheDocument());
    expect(fetchMock.mock.calls.some(call => call[0].includes('/modules/M2/'))).toBe(true);
  });

  it('shows saved sessions and a disabled sync action when setup is incomplete', async () => {
    fetchMock.mockImplementation(() => ok({ series: [{ id: 'S1', title: 'Example module', sessions: [session] }],
      jobs: [], syncAvailable: false, warning: 'Recording storage needs setup.' }));
    render(<ModuleSessions moduleId="M1" />);
    await screen.findByText('Session 1');
    expect(screen.getByText('Recording storage needs setup.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sync attendance & files' })).toBeDisabled();
    expect(screen.getByText('Attendance report saved')).toBeInTheDocument();
    expect(coachFetch).not.toHaveBeenCalled();
  });
  const linkedGuest = { identityKind: 'guest_name', identityValue: 'example guest', revision: 1,
    name: 'Example Guest', aliasEmail: '', sourceRecordIds: ['R1'], learnerProfileId: 7,
    learnerName: 'Learner One', scope: 'module' };
  const linkedSession = { ...session, linkedIdentities: [linkedGuest], attendanceCandidates: [
    { learnerProfileId: 7, name: 'Learner One', email: 'one@example.invalid' },
    { learnerProfileId: 8, name: 'Learner Two', email: 'two@example.invalid' },
  ] };

  it('lets staff correct a linked identity and refreshes the register', async () => {
    fetchMock.mockImplementation(() => ok({ sessions: [linkedSession] }));
    vi.mocked(coachFetch).mockResolvedValue({ ok: true, json: async () => ({ learnerName: 'Learner Two', recalculation: 'complete' }) } as Response);
    render(<MemoryRouter><SessionResults seriesId="S1" sessionNumber={1} moduleId="M" /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('tab', { name: 'attendance' }));
    fireEvent.click(screen.getByText('Linked identities (1)'));
    fireEvent.click(screen.getByRole('button', { name: 'Correct link for Example Guest' }));
    fireEvent.change(screen.getByLabelText('Correct learner'), { target: { value: '8' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save corrected link' }));
    await waitFor(() => expect(coachFetch).toHaveBeenCalled());
    const body = JSON.parse(vi.mocked(coachFetch).mock.calls[0][1]!.body as string);
    expect(body).toMatchObject({ action: 'change', learnerProfileId: 8, expectedLearnerProfileId: 7,
      expectedRevision: 1, identityKind: 'guest_name', identityValue: 'example guest', moduleId: 'M' });
    expect(await screen.findByText('Identity is now matched to Learner Two.')).toBeInTheDocument();
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(1));
  });

  it('offers cancellation and an explicit unlink action without deleting Teams evidence', async () => {
    fetchMock.mockImplementation(() => ok({ sessions: [linkedSession] }));
    vi.mocked(coachFetch).mockResolvedValue({ ok: true, json: async () => ({ recalculation: 'complete' }) } as Response);
    render(<MemoryRouter><SessionResults seriesId="S1" sessionNumber={1} /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('tab', { name: 'attendance' }));
    fireEvent.click(screen.getByText('Linked identities (1)'));
    fireEvent.click(screen.getByRole('button', { name: 'Correct link for Example Guest' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(coachFetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Correct link for Example Guest' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm unlink' }));
    await waitFor(() => expect(coachFetch).toHaveBeenCalled());
    expect(JSON.parse(vi.mocked(coachFetch).mock.calls[0][1]!.body as string)).toMatchObject({ action: 'unlink', expectedRevision: 1, expectedLearnerProfileId: 7 });
    expect(await screen.findByText(/Identity unlinked/)).toBeInTheDocument();
  });

  it('keeps a concurrent correction error visible and preserves the selected learner', async () => {
    fetchMock.mockImplementation(() => ok({ sessions: [linkedSession] }));
    vi.mocked(coachFetch).mockResolvedValue({ ok: false, json: async () => ({ error: 'This link changed in another window.' }) } as Response);
    render(<MemoryRouter><SessionResults seriesId="S1" sessionNumber={1} /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('tab', { name: 'attendance' }));
    fireEvent.click(screen.getByText('Linked identities (1)'));
    fireEvent.click(screen.getByRole('button', { name: 'Correct link for Example Guest' }));
    fireEvent.change(screen.getByLabelText('Correct learner'), { target: { value: '8' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save corrected link' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This link changed in another window.');
    expect(screen.getByLabelText('Correct learner')).toHaveValue('8');
  });

  it('shows reporting failure as partial success even when a sync job is present', async () => {
    fetchMock.mockImplementation(() => ok({ sessions: [linkedSession], job: { state: 'completed' } }));
    vi.mocked(coachFetch).mockResolvedValue({ ok: true, json: async () => ({ learnerName: 'Learner Two', recalculation: 'failed' }) } as Response);
    render(<MemoryRouter><SessionResults seriesId="S1" sessionNumber={1} /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('tab', { name: 'attendance' }));
    fireEvent.click(screen.getByText('Linked identities (1)'));
    fireEvent.click(screen.getByRole('button', { name: 'Correct link for Example Guest' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save corrected link' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('correction was saved');
    expect(screen.getByText('Identity is now matched to Learner Two.')).toBeInTheDocument();
  });

  it('explains automatic full-name matches and allows staff to unlink them', async () => {
    fetchMock.mockImplementation(() => ok({ sessions: [{ ...linkedSession,
      linkedIdentities: [{ ...linkedGuest, revision: 0, automatic: true }] }] }));
    vi.mocked(coachFetch).mockResolvedValue({ ok: true, json: async () => ({ recalculation: 'complete' }) } as Response);
    render(<MemoryRouter><SessionResults seriesId="S1" sessionNumber={1} moduleId="M" /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('tab', { name: 'attendance' }));
    fireEvent.click(screen.getByText('Linked identities (1)'));
    expect(screen.getByText(/Automatically matched by exact full name/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Correct link for Example Guest' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm unlink' }));
    await waitFor(() => expect(coachFetch).toHaveBeenCalled());
    expect(JSON.parse(vi.mocked(coachFetch).mock.calls[0][1]!.body as string)).toMatchObject({
      action: 'unlink', expectedRevision: 0, expectedLearnerProfileId: 7, moduleId: 'M',
    });
  });

});
