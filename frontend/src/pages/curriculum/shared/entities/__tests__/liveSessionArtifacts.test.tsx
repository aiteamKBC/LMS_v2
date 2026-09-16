import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchLiveSessionArtifacts, type LiveSessionArtifactsResponse } from '@/lib/curriculumApi';
import { coachFetch } from '@/lib/coachFetch';
import { ComponentEditor } from '../../../week-builder/page';
import { LiveSessionArtifactsPanel, type LiveSessionArtifactTarget } from '../liveSessionArtifacts';

vi.mock('@/lib/curriculumApi', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/curriculumApi')>(),
  fetchLiveSessionArtifacts: vi.fn(),
}));
vi.mock('@/lib/coachFetch', () => ({ coachFetch: vi.fn() }));

const session: LiveSessionArtifactTarget = {
  liveSessionId: 'S1', title: 'Example session', dateIso: '2026-09-16T09:00:00Z',
  date: '2026-09-16', actualStart: '', artifactsSyncedAt: '',
};
const saved = {
  id: 'O6', seriesId: 'S1', sessionNumber: 6, startsAt: '2026-09-17T09:00:00Z', endsAt: '2026-09-17T11:00:00Z',
  state: 'completed', reportReady: true, archiveReady: true, syncedAt: '2026-09-17T12:00:00Z',
  attendance: [{ email: 'learner@example.invalid', name: 'Learner One', seconds: 240, attendance: 1,
    status: 'present', expected: true, excused: false, catchupCompleted: false }],
  artifacts: [{ id: 'R6', type: 'recording', state: 'ready' },
    { id: 'T6', type: 'transcript', state: 'ready', text: 'Speaker: Saved session six.' }],
};
const occurrences = { series: { id: 'S1' }, occurrences: [
  { id: 'O1', live_session_id: 'S1', session_number: 1, scheduled_start: session.dateIso },
  { id: 'O6', live_session_id: 'S1', session_number: 6, scheduled_start: saved.startsAt },
] };
const fetchArtifacts = vi.mocked(fetchLiveSessionArtifacts);
const fetchMock = vi.fn();
const ok = (data: unknown) => Promise.resolve({ ok: true, json: async () => data } as Response);
const resultUrl = '/curriculum_api/curriculum/session-results/S1/sessions/6/';

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockImplementation((url: string) => {
    if (url === resultUrl) return ok({ sessions: [saved] });
    throw new Error(`Unexpected network request: ${url}`);
  });
  fetchArtifacts.mockResolvedValue(occurrences);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('component editor saved session results', () => {
  it('uses the linked session archive for playback, transcript and attendance', async () => {
    render(<LiveSessionArtifactsPanel session={session} occurrenceId="O6" sessionNumber={6} />);
    const video = await screen.findByLabelText('Session recording 1');
    expect(video).toHaveAttribute('src', '/curriculum_api/curriculum/session-results/S1/artifacts/R6/');
    expect(video).toHaveAttribute('preload', 'none');
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(resultUrl, expect.objectContaining({ credentials: 'include' }));
    expect(fetchArtifacts).not.toHaveBeenCalled();
    expect(coachFetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('tab', { name: 'transcripts' }));
    expect(screen.getByText('Speaker: Saved session six.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Download TXT' })).toHaveAttribute('href', '/curriculum_api/curriculum/session-results/S1/artifacts/T6/?format=txt');
    fireEvent.click(screen.getByRole('tab', { name: 'attendance' }));
    expect(screen.getByText('Learner One')).toBeInTheDocument();
    expect(screen.getByText('Present')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Export attendance CSV' })).toHaveAttribute('href', `${resultUrl}attendance.csv`);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('queues synchronization without rereading stale files and refreshes saved results on request', async () => {
    vi.mocked(coachFetch).mockImplementation(() => ok({ state: 'queued', message: 'Synchronization queued. Check saved results shortly.' }));
    render(<LiveSessionArtifactsPanel session={session} sessionNumber={6} />);
    await screen.findByLabelText('Session recording 1');
    fireEvent.click(screen.getByRole('button', { name: 'Sync attendance & files' }));
    expect(await screen.findByText('Synchronization queued. Check saved results shortly.')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(coachFetch).toHaveBeenCalledExactlyOnceWith('/curriculum_api/curriculum/session-results/S1/sync/', { method: 'POST' });
    expect(screen.getByLabelText('Session recording 1')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Refresh saved results' }));
    await screen.findByLabelText('Session recording 1');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenLastCalledWith(resultUrl, expect.objectContaining({ credentials: 'include' }));
    expect(coachFetch).toHaveBeenCalledTimes(1);
    expect(fetchArtifacts).not.toHaveBeenCalled();
  });

  it('shows pending processing and attendance rather than claiming Teams has no files', async () => {
    fetchMock.mockImplementation(() => ok({ sessions: [{ ...saved, reportReady: false,
      artifacts: [{ id: 'R6', type: 'recording', state: 'pending' }],
      attendance: [{ ...saved.attendance[0], attendance: null, status: 'pending', seconds: 0 }],
    }] }));
    render(<LiveSessionArtifactsPanel session={session} sessionNumber={6} />);
    expect(await screen.findByText(/Recording found. Saving a copy/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Session recording 1')).not.toBeInTheDocument();
    expect(screen.queryByText(/Teams held no recording/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'attendance' }));
    expect(screen.getByText('Awaiting report')).toBeInTheDocument();
    expect(screen.queryByText('Absent')).not.toBeInTheDocument();
  });

  it('shows a rejected queue request and leaves saved data available', async () => {
    vi.mocked(coachFetch).mockRejectedValue(new Error('Could not queue synchronization.'));
    render(<LiveSessionArtifactsPanel session={session} sessionNumber={6} />);
    await screen.findByLabelText('Session recording 1');
    fireEvent.click(screen.getByRole('button', { name: 'Sync attendance & files' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not queue synchronization.');
    expect(screen.getByLabelText('Session recording 1')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Sync attendance & files' })).toBeEnabled();
  });

  it('resolves an older component by occurrence ID before its outdated schedule', async () => {
    render(<LiveSessionArtifactsPanel session={session} occurrenceId="O6" />);
    await screen.findByLabelText('Session recording 1');
    expect(fetchArtifacts).toHaveBeenCalledExactlyOnceWith('S1', expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(resultUrl, expect.anything());
  });

  it('does not substitute another occurrence when the stored occurrence ID is missing', async () => {
    render(<LiveSessionArtifactsPanel session={session} occurrenceId="missing" />);
    expect(await screen.findByText(/Link this component to a Teams session/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(coachFetch).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Sync attendance & files' })).not.toBeInTheDocument();
  });

  it('supports an unambiguous saved schedule for components without occurrence tracking', async () => {
    render(<LiveSessionArtifactsPanel session={{ ...session, dateIso: saved.startsAt }} />);
    await screen.findByLabelText('Session recording 1');
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(resultUrl, expect.anything());
  });

  it('does not guess between two occurrences with the same schedule', async () => {
    fetchArtifacts.mockResolvedValue({ ...occurrences, occurrences: [occurrences.occurrences[1],
      { ...occurrences.occurrences[1], id: 'O7', session_number: 7 }] });
    render(<LiveSessionArtifactsPanel session={{ ...session, dateIso: saved.startsAt }} />);
    expect(await screen.findByText(/Link this component to a Teams session/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('allows retrying a failed occurrence lookup without writing or syncing', async () => {
    fetchArtifacts.mockRejectedValueOnce(new Error('Session lookup unavailable.'));
    render(<LiveSessionArtifactsPanel session={session} occurrenceId="O6" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Session lookup unavailable.');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh saved results' }));
    await screen.findByLabelText('Session recording 1');
    expect(fetchArtifacts).toHaveBeenLastCalledWith('S1', expect.objectContaining({ skipCache: true }));
    expect(coachFetch).not.toHaveBeenCalled();
  });

  it('ignores a late occurrence lookup after selecting a different component', async () => {
    let finishLookup!: (value: LiveSessionArtifactsResponse) => void;
    fetchArtifacts.mockImplementationOnce(() => new Promise(resolve => { finishLookup = resolve; }));
    const view = render(<LiveSessionArtifactsPanel session={{ ...session, liveSessionId: 'OLD' }} occurrenceId="OLD-O" />);
    const signal = fetchArtifacts.mock.calls[0][1]?.signal;
    view.rerender(<LiveSessionArtifactsPanel session={session} sessionNumber={6} />);
    await screen.findByLabelText('Session recording 1');
    finishLookup({ series: {}, occurrences: [{ id: 'OLD-O', live_session_id: 'OLD', session_number: 1 }] });
    await waitFor(() => expect(signal?.aborted).toBe(true));
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(resultUrl, expect.anything());
    expect(screen.getByLabelText('Session recording 1')).toHaveAttribute('src', '/curriculum_api/curriculum/session-results/S1/artifacts/R6/');
  });

  it('opens saved results inside the real editor using its stored occurrence link', async () => {
    const component: ComponentProps<typeof ComponentEditor>['component'] = {
      id: 'C6', weekId: 'W6', type: 'live-session', title: 'Live session six', description: '',
      expectedOtjh: 2, points: 30, reflectionRequired: false, reflectionQuestion: '',
      workplaceEvidenceRequired: false, tutorValidationRequired: false, coachValidationRequired: true,
      ksbMappings: [], settings: { teamsLiveSessionId: 'S1', teamsOccurrenceId: 'O6' },
    };
    const onChange = vi.fn();
    render(<ComponentEditor component={component} onChange={onChange} onBack={vi.fn()} groupOptions={[]}
      weekScope={{} as ComponentProps<typeof ComponentEditor>['weekScope']} weekSessionDate={session.date} />);
    await screen.findByLabelText('Session recording 1');
    expect(screen.getByText('Recording & attendance')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(resultUrl, expect.anything());
    expect(onChange).not.toHaveBeenCalled();
    expect(coachFetch).not.toHaveBeenCalled();
  });
});
