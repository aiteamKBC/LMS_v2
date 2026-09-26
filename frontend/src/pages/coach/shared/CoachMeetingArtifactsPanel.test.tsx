import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CoachMeetingArtifactsPanel } from './CoachMeetingArtifactsPanel';
import type { CoachMeetingArtifactsResponse, CoachMeetingSummary } from './calendarEvents';

afterEach(() => cleanup());

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
