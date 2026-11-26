import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { CoachingMeeting } from '@/api/coachingRecordings';
import MeetingDetailsDrawer from './MeetingDetailsDrawer';
vi.mock('./SessionDetails', () => ({ default: () => <div>Recording details</div> }));
vi.mock('./MeetingQualityChecks', () => ({ default: () => <div>Saved checks</div> }));
vi.mock('./QualityReviewDialog', () => ({ default: ({ meetingId, meetingStartsAt, meetingEndsAt }: { meetingId?: string; meetingStartsAt?: string; meetingEndsAt?: string }) =>
  <div data-meeting-id={meetingId} data-start={meetingStartsAt} data-end={meetingEndsAt}>Choose learner and fill quality form</div> }));
const meeting = (category: CoachingMeeting['category'], phase: CoachingMeeting['phase']): CoachingMeeting => ({
  calendarEventId: 'event', coachEmail: 'coach@example.invalid', eventKey: null, candidateEventKeys: [], learnerIds: [], family: null,
  meetingId: 'a'.repeat(32),
  category, title: 'Synthetic meeting', startsAt: '2026-10-25T09:00:00Z', endsAt: '2026-10-25T10:00:00Z', phase, match: 'external',
  readyToAction: false, media: { state: 'pending', recordings: [], readyCount: 0 },
});
it.each(['MCM', 'PR', 'SUPPORT', 'OTHER', 'LECTURE'] as const)('opens a quality form for %s even without an LMS booking', async category => {
  render(<MeetingDetailsDrawer meeting={meeting(category, 'upcoming')} reference="signed-reference" timeZone="UTC" now={Date.parse('2026-10-24T10:00:00Z')} coachName="Coach One" learnerNames={[]} onClose={vi.fn()} qualityEnabled />);
  fireEvent.click(screen.getByRole('tab', { name: 'Quality check' }));
  fireEvent.click(screen.getByRole('button', { name: /Quality Check/ }));
  const form = await screen.findByText('Choose learner and fill quality form');
  expect(form).toHaveAttribute('data-meeting-id', 'a'.repeat(32));
  expect(form).toHaveAttribute('data-start', '2026-10-25T09:00:00Z');
  expect(form).toHaveAttribute('data-end', '2026-10-25T10:00:00Z');
});
it('preserves the Curriculum-only form boundary', () => {
  render(<MeetingDetailsDrawer meeting={meeting('OTHER', 'ended')} timeZone="UTC" now={Date.parse('2026-10-25T11:00:00Z')} coachName="Coach One" learnerNames={[]} onClose={vi.fn()} />);
  expect(screen.queryByRole('button', { name: /Quality Check/ })).not.toBeInTheDocument();
  expect(screen.queryByRole('tab', { name: 'Quality check' })).not.toBeInTheDocument();
});

it('opens verified evidence during the scheduled window and explains the calendar status', () => {
  render(<MeetingDetailsDrawer meeting={meeting('MCM', 'in-progress')} reference="signed-reference" timeZone="UTC" now={Date.parse('2026-10-25T09:30:00Z')} coachName="Coach One" learnerNames={[]} onClose={vi.fn()} />);
  expect(screen.getByRole('tab', { name: 'Overview', selected: true })).toBeInTheDocument();
  expect(screen.getByText('Within scheduled time')).toBeInTheDocument();
  expect(screen.getByText(/does not confirm whether the call is still live/)).toBeInTheDocument();
  expect(screen.queryByText('Ended')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: 'Recording' }));
  expect(screen.getByText('Recording details')).toBeVisible();
});

it('separates overview, evidence and saved quality checks and supports keyboard navigation', () => {
  render(<MeetingDetailsDrawer meeting={meeting('MCM', 'ended')} reference="signed-reference" timeZone="UTC" now={Date.parse('2026-10-25T11:00:00Z')} coachName="Coach One" learnerNames={[]} onClose={vi.fn()} qualityEnabled />);
  expect(screen.getAllByRole('tab').map(tab => tab.textContent)).toEqual(['Overview', 'Recording', 'Attendance', 'Transcript', 'Quality check']);
  expect(screen.getByText('Coach One')).toBeVisible();
  expect(screen.getByText('Recording details')).not.toBeVisible();
  expect(screen.getByText('Saved checks')).not.toBeVisible();
  fireEvent.keyDown(screen.getByRole('tab', { name: 'Overview' }), { key: 'ArrowRight' });
  expect(screen.getByRole('tab', { name: 'Recording', selected: true })).toHaveFocus();
  expect(screen.getByText('Recording details')).toBeVisible();
  expect(screen.getByText('Coach One')).not.toBeVisible();
  fireEvent.keyDown(screen.getByRole('tab', { name: 'Recording' }), { key: 'End' });
  expect(screen.getByRole('tab', { name: 'Quality check', selected: true })).toHaveFocus();
  expect(screen.getByText('Saved checks')).toBeVisible();
  expect(screen.getByText('Recording details')).not.toBeVisible();
  fireEvent.keyDown(screen.getByRole('tab', { name: 'Quality check' }), { key: 'Home' });
  expect(screen.getByRole('tabpanel', { name: 'Overview' })).toBeVisible();
});
