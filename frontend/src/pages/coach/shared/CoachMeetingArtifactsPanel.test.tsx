import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CoachMeetingArtifactsPanel } from './CoachMeetingArtifactsPanel';
import type { CoachMeetingArtifactsResponse, CoachMeetingSummary } from './calendarEvents';

afterEach(() => cleanup());

describe('stored APTEM portal resources', () => {
  it.each(['MCM', 'PR', 'PR + Skills Radar', 'PSP'])('loads %s without refresh or Coach actions, including during loading', async (family) => {
    const fetchArtifacts = vi.fn().mockResolvedValue({ artifacts: [], resourceMode: 'stored',
      storage: { stored: true, syncedAt: '2026-10-24T10:00:00Z' } });
    render(<CoachMeetingArtifactsPanel event={{ ...event, title: family }} fetchArtifacts={fetchArtifacts}
      storedOnly refreshOnLoad showCheckAction />);
    expect(screen.queryByRole('button', { name: 'Check Teams' })).not.toBeInTheDocument();
    expect(await screen.findByText('No saved meeting recording is available. Your coach can check Teams for updates.')).toBeInTheDocument();
    expect(screen.getByText(/Last saved:.*Newer resources may not be included/)).toBeInTheDocument();
    expect(screen.queryByText('AI Meeting Summary')).not.toBeInTheDocument();
    expect(fetchArtifacts).toHaveBeenCalledExactlyOnceWith(event.eventKey, expect.any(AbortSignal), { refresh: false });
  });

  it('uses stored mode returned by the server and shows updated resources on the next visit', async () => {
    const fetchArtifacts = vi.fn().mockResolvedValue({ artifacts: [], resourceMode: 'stored' });
    const first = render(<CoachMeetingArtifactsPanel event={event} fetchArtifacts={fetchArtifacts} />);
    await screen.findByText(/No saved meeting recording/);
    expect(screen.queryByRole('button', { name: 'Check Teams' })).not.toBeInTheDocument();
    first.unmount();
    fetchArtifacts.mockResolvedValue({ resourceMode: 'stored', artifacts: [
      { artifact_type: 'recording', graph_artifact_id: 'saved-after-coach-refresh' },
    ] });
    render(<CoachMeetingArtifactsPanel event={event} fetchArtifacts={fetchArtifacts} storedOnly />);
    expect(await screen.findByRole('button', { name: 'Play' })).toBeInTheDocument();
    expect(fetchArtifacts).toHaveBeenCalledTimes(2);
    expect(fetchArtifacts.mock.calls.every((call) => call[2].refresh === false)).toBe(true);
  });

  it('retains a stored read error without adding a Teams refresh action', async () => {
    const fetchArtifacts = vi.fn().mockRejectedValue(new Error('Stored resources unavailable'));
    render(<CoachMeetingArtifactsPanel event={event} fetchArtifacts={fetchArtifacts} storedOnly />);
    expect(await screen.findByText('Stored resources unavailable')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Check Teams' })).not.toBeInTheDocument();
    expect(fetchArtifacts).toHaveBeenCalledTimes(1);
  });

  it('shows metadata without offering playback when a recording has no saved video', async () => {
    const fetchArtifacts = vi.fn().mockResolvedValue({ resourceMode: 'stored', artifacts: [
      { artifact_type: 'recording', graph_artifact_id: 'metadata-only', content_available: false },
    ] });
    render(<CoachMeetingArtifactsPanel event={event} fetchArtifacts={fetchArtifacts} storedOnly />);
    expect(await screen.findByText('A saved copy of this recording is not available yet.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Play' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Download' })).not.toBeInTheDocument();
    expect(fetchArtifacts).toHaveBeenCalledTimes(1);
  });
});

it('preserves Native check execution and hidden defaults while allowing an inert visible action', async () => {
  const user = userEvent.setup();
  const fetchArtifacts = vi.fn().mockResolvedValue({ artifacts: [] });
  const { rerender } = render(<CoachMeetingArtifactsPanel event={event} fetchArtifacts={fetchArtifacts} />);
  const check = await screen.findByRole('button', { name: 'Check Teams' });
  expect(check).toBeEnabled();
  await user.click(check);
  expect(fetchArtifacts).toHaveBeenCalledWith(event.eventKey, undefined, { refresh: true });
  const requestCount = fetchArtifacts.mock.calls.length;
  rerender(<CoachMeetingArtifactsPanel event={event} fetchArtifacts={fetchArtifacts} canCheck={false} />);
  expect(screen.queryByRole('button', { name: 'Check Teams' })).not.toBeInTheDocument();
  rerender(<CoachMeetingArtifactsPanel event={event} fetchArtifacts={fetchArtifacts} canCheck={false} showCheckAction />);
  const disabled = screen.getByRole('button', { name: 'Check Teams' });
  expect(disabled).toBeDisabled();
  await user.click(disabled);
  expect(fetchArtifacts).toHaveBeenCalledTimes(requestCount);
});

const event = {
  id: 'mcr:42:1:2026-09-19',
  eventKey: 'mcr:42:1:2026-09-19',
  source: 'mcr',
  status: 'completed',
  meetingLink: 'https://teams.example.test/meeting',
};

function renderSummary(meetingSummary: CoachMeetingSummary) {
  const response: CoachMeetingArtifactsResponse = {
    artifacts: [],
    attendance: undefined,
    meetingSummary,
    errors: [],
  };
  const fetchArtifacts = vi.fn().mockResolvedValue(response);

  render(
    <CoachMeetingArtifactsPanel
      event={event}
      fetchArtifacts={fetchArtifacts}
      showAttendance={false}
      canEditSummary={false}
    />,
  );

  return fetchArtifacts;
}

function renderArtifacts(artifacts: CoachMeetingArtifactsResponse['artifacts']) {
  const response: CoachMeetingArtifactsResponse = {
    artifacts,
    attendance: undefined,
    meetingSummary: null,
    errors: [],
  };
  const fetchArtifacts = vi.fn().mockResolvedValue(response);

  render(
    <CoachMeetingArtifactsPanel
      event={event}
      fetchArtifacts={fetchArtifacts}
      showAttendance={false}
      canEditSummary={false}
    />,
  );
}

function summary(status: string, overview: string, error = ''): CoachMeetingSummary {
  return {
    summary: {
      title: 'Monthly Coaching Recap',
      overview,
      keyPoints: [],
      actions: [],
      nextSteps: [],
      support: [],
    },
    status,
    generatedAt: '2026-09-19T19:49:00Z',
    editedAt: status === 'edited' ? '2026-09-19T19:55:00Z' : null,
    editedBy: status === 'edited' ? 'coach@example.test' : '',
    model: 'test-model',
    error,
  };
}

describe('MeetingSummaryCard status handling', () => {
  it('preserves draft fields across typing and parent rerenders without extra artifact requests', async () => {
    const user = userEvent.setup();
    const stored = summary('ready', 'Saved overview');
    const fetchArtifacts = vi.fn().mockResolvedValue({ artifacts: [], meetingSummary: stored });
    const saveSummary = vi.fn().mockImplementation(async (_key, payload) => ({
      meetingSummary: { ...stored, summary: payload, status: 'edited', editedAt: '2026-10-24T12:00:00Z' },
    }));
    const props = { event, fetchArtifacts, saveSummary, canEditSummary: true };
    const { rerender } = render(<CoachMeetingArtifactsPanel {...props} />);
    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByDisplayValue('Saved overview'), { target: { value: 'Unsaved overview' } });
    fireEvent.change(screen.getByDisplayValue('Monthly Coaching Recap'), { target: { value: 'My recap' } });
    fireEvent.change(screen.getByPlaceholderText('Add a key discussion point'), { target: { value: 'Keep this point' } });
    fireEvent.change(screen.getByPlaceholderText('Action'), { target: { value: 'Practice task' } });
    rerender(<CoachMeetingArtifactsPanel {...props} event={{ ...event, title: 'Updated card label' }} />);
    expect(screen.getByDisplayValue('Unsaved overview')).toBeVisible();
    expect(screen.getByDisplayValue('My recap')).toBeVisible();
    expect(screen.getByDisplayValue('Keep this point')).toBeVisible();
    expect(screen.getByDisplayValue('Practice task')).toBeVisible();
    expect(fetchArtifacts).toHaveBeenCalledTimes(1);
    expect(fetchArtifacts.mock.calls[0][2]).toEqual({ refresh: false });
    await user.click(screen.getByRole('button', { name: /Save/ }));
    await waitFor(() => expect(saveSummary).toHaveBeenCalledWith(event.eventKey, expect.objectContaining({
      title: 'My recap', overview: 'Unsaved overview', keyPoints: ['Keep this point'],
      actions: [expect.objectContaining({ title: 'Practice task' })],
    })));
    expect(await screen.findByText('Coach edited')).toBeVisible();
    expect(screen.getByText('Unsaved overview')).toBeVisible();
    expect(fetchArtifacts).toHaveBeenCalledTimes(1);
  });

  it('retains a failed-save draft and error through rerenders, then reads the next explicit refresh', async () => {
    const user = userEvent.setup();
    const fetchArtifacts = vi.fn().mockResolvedValueOnce({ artifacts: [], meetingSummary: summary('ready', 'Saved overview') })
      .mockResolvedValue({ artifacts: [], meetingSummary: summary('edited', 'New saved overview') });
    const saveSummary = vi.fn().mockRejectedValue(new Error('Recap could not be saved'));
    const props = { event, fetchArtifacts, saveSummary, canEditSummary: true };
    const { rerender } = render(<CoachMeetingArtifactsPanel {...props} />);
    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByDisplayValue('Saved overview'), { target: { value: 'Retain my draft' } });
    await user.click(screen.getByRole('button', { name: /Save/ }));
    expect(await screen.findByText('Recap could not be saved')).toBeVisible();
    rerender(<CoachMeetingArtifactsPanel {...props} className="updated" />);
    expect(screen.getByDisplayValue('Retain my draft')).toBeVisible();
    expect(screen.getByText('Recap could not be saved')).toBeVisible();
    expect(fetchArtifacts).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Check Teams' }));
    expect(await screen.findByText('New saved overview')).toBeVisible();
    expect(screen.queryByDisplayValue('Retain my draft')).not.toBeInTheDocument();
    expect(fetchArtifacts).toHaveBeenCalledTimes(2);
    expect(fetchArtifacts).toHaveBeenLastCalledWith(event.eventKey, undefined, { refresh: true });
  });

  it('renders a ready summary as AI generated with its overview', async () => {
    renderSummary(summary('ready', 'The learner and coach reviewed progress.'));

    expect(await screen.findByText('AI generated')).toBeInTheDocument();
    expect(screen.getByText('The learner and coach reviewed progress.')).toBeInTheDocument();
    expect(screen.queryByText('Generation failed')).not.toBeInTheDocument();
  });

  it('renders an edited summary as coach edited', async () => {
    renderSummary(summary('edited', 'The coach confirmed the agreed actions.'));

    expect(await screen.findByText('Coach edited')).toBeInTheDocument();
    expect(screen.queryByText('AI generated')).not.toBeInTheDocument();
  });

  it('renders an empty failed fallback as an error without exposing its raw exception', async () => {
    renderSummary(summary('failed', '', "name 'source' is not defined"));

    expect(await screen.findByText('Generation failed')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Meeting recap generation failed. No AI recap is available yet.',
    );
    expect(screen.queryByText('AI generated')).not.toBeInTheDocument();
    expect(screen.queryByText('No overview is available yet.')).not.toBeInTheDocument();
    expect(screen.queryByText("name 'source' is not defined")).not.toBeInTheDocument();
  });
});

describe('Meeting artifact display', () => {
  it('combines transcript segments into one downloadable card while keeping recordings separate', async () => {
    renderArtifacts([
      {
        id: 'transcript-1',
        artifact_type: 'transcript',
        graph_artifact_id: 'transcript-1',
        created_datetime: '2026-09-19T10:00:00Z',
      },
      {
        id: 'transcript-2',
        artifact_type: 'transcript',
        graph_artifact_id: 'transcript-2',
        created_datetime: '2026-09-19T10:30:00Z',
      },
      {
        id: 'recording-1',
        artifact_type: 'recording',
        graph_artifact_id: 'recording-1',
      },
      {
        id: 'recording-2',
        artifact_type: 'recording',
        graph_artifact_id: 'recording-2',
      },
    ]);

    expect((await screen.findAllByText('Transcript'))).toHaveLength(1);
    expect(screen.getAllByText('Recording')).toHaveLength(2);
    const downloadLinks = screen.getAllByRole('link', { name: 'Download' });
    expect(downloadLinks).toHaveLength(3);
    expect(downloadLinks[0]).toHaveAttribute(
      'href',
      expect.stringContaining('/artifacts/transcript/combined/content'),
    );
  });
});
