import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CoachMeetingArtifactsPanel } from './CoachMeetingArtifactsPanel';
import type { CoachMeetingArtifactsResponse, CoachMeetingSummary } from './calendarEvents';

afterEach(() => cleanup());

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
