import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchImportedMeetingParticipants, type ImportedMeetingParticipants } from '@/lib/curriculumApi';
import { ImportedParticipantsPanel } from '../ImportedParticipantsPanel';

vi.mock('@/lib/curriculumApi', () => ({ fetchImportedMeetingParticipants: vi.fn() }));

const response = (): ImportedMeetingParticipants => ({
  checkedAt: '2026-10-19T14:00:00Z',
  calendar: {
    status: 'available', source: 'attendee_calendar', message: 'Invitations read from an attendee copy.',
    organizer: { name: 'Existing organiser', email: 'organiser@example.invalid' },
    attendees: [{ name: 'Invited learner', email: 'learner@example.invalid' }], hideAttendees: false,
  },
  roles: { status: 'access_denied', message: 'Microsoft did not allow reading meeting roles.' },
});

describe('people read from an imported meeting', () => {
  beforeEach(() => vi.mocked(fetchImportedMeetingParticipants).mockReset());

  it('shows real invitees from a calendar copy without claiming unavailable roles are empty', async () => {
    vi.mocked(fetchImportedMeetingParticipants).mockResolvedValue(response());
    render(<ImportedParticipantsPanel liveSessionId="LIVE-EXTERNAL" savedOrganizer="saved@example.invalid" />);
    expect(await screen.findByText('learner@example.invalid')).toBeInTheDocument();
    expect(screen.getByText('Calendar invitees (1)')).toBeInTheDocument();
    expect(screen.getByText('Calendar invitation organiser')).toBeInTheDocument();
    expect(within(screen.getByLabelText('Teams meeting organiser')).getByText('Not confirmed yet')).toBeInTheDocument();
    expect(within(screen.getByLabelText('Teams meeting organiser')).queryByText(/organiser@example.invalid/)).not.toBeInTheDocument();
    expect(screen.getByText(/Source: an attendee’s calendar copy/)).toBeInTheDocument();
    expect(screen.getAllByText(/an empty list has not been confirmed/)).toHaveLength(2);
    expect(screen.queryByText('None returned by Microsoft.')).not.toBeInTheDocument();
    expect(screen.getByText('Microsoft reports that the attendee list is not hidden.')).toBeInTheDocument();
  });

  it('marks hidden attendee-copy lists as partial rather than a complete headcount', async () => {
    const data = response();
    data.calendar.status = 'partial';
    data.calendar.hideAttendees = true;
    data.calendar.message = 'This copy hides other invitees.';
    vi.mocked(fetchImportedMeetingParticipants).mockResolvedValue(data);
    render(<ImportedParticipantsPanel liveSessionId="LIVE-EXTERNAL" />);
    expect(await screen.findByText('Calendar invitees (1 visible)')).toBeInTheDocument();
    expect(screen.getByText('Microsoft reports that the attendee list is hidden from invitees.')).toBeInTheDocument();
  });

  it('distinguishes a verified empty list and presenter policy from unread data', async () => {
    const data = response();
    data.calendar.attendees = [];
    data.roles = { status: 'available', message: 'Roles read.', presenters: [], coOrganizers: [], allowedPresenters: 'everyone' };
    vi.mocked(fetchImportedMeetingParticipants).mockResolvedValue(data);
    render(<ImportedParticipantsPanel liveSessionId="LIVE-EXTERNAL" />);
    expect(await screen.findByText('Everyone can present')).toBeInTheDocument();
    expect(screen.getAllByText('None returned by Microsoft.')).toHaveLength(3);
  });

  it('keeps a saved organiser labelled unverified on failure and supports a fresh retry', async () => {
    vi.mocked(fetchImportedMeetingParticipants).mockRejectedValueOnce(new Error('unavailable')).mockResolvedValueOnce(response());
    render(<ImportedParticipantsPanel liveSessionId="LIVE-EXTERNAL" savedOrganizer="saved@example.invalid" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be read from Microsoft');
    expect(screen.getByText(/Saved calendar invitation organiser — not verified by this read/)).toBeInTheDocument();
    expect(screen.queryByText('None returned by Microsoft.')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh people from Teams' }));
    expect(await screen.findByText('learner@example.invalid')).toBeInTheDocument();
    expect(fetchImportedMeetingParticipants).toHaveBeenCalledTimes(2);
  });

  it('does not display a previous module’s names when its request finishes late', async () => {
    let finishOld!: (value: ImportedMeetingParticipants) => void;
    vi.mocked(fetchImportedMeetingParticipants)
      .mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }))
      .mockResolvedValueOnce({ ...response(), calendar: { status: 'unavailable', message: 'New module unavailable.' } });
    const { rerender } = render(<ImportedParticipantsPanel liveSessionId="LIVE-OLD" />);
    await waitFor(() => expect(fetchImportedMeetingParticipants).toHaveBeenCalledTimes(1));
    rerender(<ImportedParticipantsPanel liveSessionId="LIVE-NEW" />);
    expect(await screen.findByText('New module unavailable.')).toBeInTheDocument();
    await act(async () => finishOld(response()));
    expect(screen.queryByText('learner@example.invalid')).not.toBeInTheDocument();
    expect(vi.mocked(fetchImportedMeetingParticipants).mock.calls[0][1]?.aborted).toBe(true);
  });

  it('shows the online organiser separately from the calendar invitation mailbox', async () => {
    const data = response();
    data.organizer = { status: 'available', source: 'online_meeting', message: 'Read from the verified online meeting.',
      person: { name: 'Actual organiser', email: 'person@example.invalid' } };
    vi.mocked(fetchImportedMeetingParticipants).mockResolvedValue(data);
    render(<ImportedParticipantsPanel liveSessionId="LIVE-EXTERNAL" />);
    await screen.findByText('Actual organiser · person@example.invalid');
    const identity = within(screen.getByLabelText('Teams meeting organiser'));
    expect(identity.getByText('Actual organiser · person@example.invalid')).toBeInTheDocument();
    expect(identity.queryByText(/organiser@example.invalid/)).not.toBeInTheDocument();
    expect(screen.getByText('Existing organiser · organiser@example.invalid')).toBeInTheDocument();
  });

  it('labels corroborated saved Microsoft evidence without claiming a fresh organiser lookup', async () => {
    const data = response();
    data.organizer = { status: 'available', source: 'saved_microsoft_records', evidenceAt: '2026-10-16T11:00:00Z',
      message: 'Current Microsoft access is unavailable. Identity confirmed in saved meeting records.',
      person: { name: 'Recorded organiser', email: 'recorded@example.invalid' } };
    vi.mocked(fetchImportedMeetingParticipants).mockResolvedValue(data);
    render(<ImportedParticipantsPanel liveSessionId="LIVE-EXTERNAL" />);
    expect(await screen.findByText('Recorded organiser · recorded@example.invalid')).toBeInTheDocument();
    expect(screen.getByText(/Source: saved Microsoft recording and attendance records/)).toBeInTheDocument();
    expect(screen.queryByText('Source: Microsoft online meeting data.')).not.toBeInTheDocument();
    expect(screen.getByText('Microsoft did not allow reading meeting roles.')).toBeInTheDocument();
  });
});
