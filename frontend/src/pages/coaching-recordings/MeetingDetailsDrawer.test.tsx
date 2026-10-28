import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { CoachingMeeting } from '@/api/coachingRecordings';
import MeetingDetailsDrawer from './MeetingDetailsDrawer';
vi.mock('./SessionDetails', () => ({ default: () => <div>Recording details</div> }));
vi.mock('./MeetingQualityChecks', () => ({ default: () => <div>Saved checks</div> }));
vi.mock('./QualityReviewDialog', () => ({ default: () => <div>Choose learner and fill quality form</div> }));
const meeting = (category: CoachingMeeting['category'], phase: CoachingMeeting['phase']): CoachingMeeting => ({
  calendarEventId: 'event', coachEmail: 'coach@example.invalid', eventKey: null, candidateEventKeys: [], learnerIds: [], family: null,
  category, title: 'Synthetic meeting', startsAt: '2026-10-25T09:00:00Z', endsAt: '2026-10-25T10:00:00Z', phase, match: 'external',
  readyToAction: false, media: { state: 'pending', recordings: [], readyCount: 0 },
});
it.each(['MCM', 'PR', 'SUPPORT', 'OTHER', 'LECTURE'] as const)('opens a quality form for %s even without an LMS booking', async category => {
  render(<MeetingDetailsDrawer meeting={meeting(category, 'upcoming')} reference="signed-reference" timeZone="UTC" now={Date.parse('2026-10-24T10:00:00Z')} coachName="Coach One" learnerNames={[]} onClose={vi.fn()} qualityEnabled />);
  fireEvent.click(screen.getByRole('button', { name: /Quality Check/ }));
  expect(await screen.findByText('Choose learner and fill quality form')).toBeInTheDocument();
});
it('preserves the Curriculum-only form boundary', () => {
  render(<MeetingDetailsDrawer meeting={meeting('OTHER', 'ended')} timeZone="UTC" now={Date.parse('2026-10-25T11:00:00Z')} coachName="Coach One" learnerNames={[]} onClose={vi.fn()} />);
  expect(screen.queryByRole('button', { name: /Quality Check/ })).not.toBeInTheDocument();
});

it('opens verified evidence during the scheduled window and explains the calendar status', () => {
  render(<MeetingDetailsDrawer meeting={meeting('MCM', 'in-progress')} reference="signed-reference" timeZone="UTC" now={Date.parse('2026-10-25T09:30:00Z')} coachName="Coach One" learnerNames={[]} onClose={vi.fn()} />);
  expect(screen.getByText('Recording details')).toBeInTheDocument();
  expect(screen.getByText('Within scheduled time')).toBeInTheDocument();
  expect(screen.getByText(/does not confirm whether the call is still live/)).toBeInTheDocument();
  expect(screen.queryByText('Ended')).not.toBeInTheDocument();
});
