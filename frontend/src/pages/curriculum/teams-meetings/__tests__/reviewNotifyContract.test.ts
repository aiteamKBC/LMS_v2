/**
 * The review's email box is a decision the server has to hear.
 *
 * It used to stay in the browser: the choice came back from `reviewCalendar`,
 * was used to decide whether to send the LMS change email, and never reached
 * the PATCH. So the server read "do not email" from every single save, and the
 * only way it could keep a save quiet was to skip publishing the invitation
 * list -- which is how one restored session ended up on nobody's calendar.
 *
 * The flag now travels with the save, and it says one thing only: whether
 * Microsoft should announce the change. Who is on the meeting is not its
 * business, and these tests pin that separation down at the wire.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Swal, { type SweetAlertOptions } from 'sweetalert2';
import { updateTeamsMeetingSchedule } from '../../module-builder/moduleAuthoringData';

vi.mock('sweetalert2', () => ({ default: { fire: vi.fn(), getPopup: vi.fn() } }));

const fetchMock = vi.fn();

const dates = () => ({
  title: 'Synthetic module',
  organizerEmail: 'organizer@example.invalid',
  localStartDateTime: '2026-09-17T12:00',
  startDateTimeUtc: '2026-09-17T11:00:00Z',
  durationMinutes: 120,
  repeat: 'weekly' as const,
  repeatOccurrences: 2,
  scheduledOccurrences: [
    { sessionNumber: 1, startDateTimeUtc: '2026-09-17T11:00:00Z', durationMinutes: 120 },
    { sessionNumber: 2, startDateTimeUtc: '2026-09-24T11:00:00Z', durationMinutes: 120 },
  ],
});

/** Confirm the review with the email box in the given state. */
function reviewWith(ticked: boolean) {
  const popup = document.createElement('div');
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.id = 'teams-review-notify';
  box.checked = ticked;
  popup.append(box);
  vi.mocked(Swal.getPopup).mockReturnValue(popup as HTMLElement);
  vi.mocked(Swal.fire).mockImplementation(async (options: unknown) => {
    await (options as SweetAlertOptions).preConfirm?.('on');
    return { isConfirmed: true, isDenied: false, isDismissed: false } as never;
  });
}

const sentBody = () => JSON.parse(fetchMock.mock.calls.at(-1)![1].body);

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockImplementation(async (_url: string, init?: { method?: string }) => ({
    ok: true,
    json: async () => (init?.method === 'PATCH'
      ? { updated: true, meeting: {}, warnings: [] }
      : {
        series: {
          organizer_email: 'organizer@example.invalid',
          join_url: 'https://teams.microsoft.com/meet/synthetic',
          attendees: ['learner@example.invalid'], presenters: [], co_organizers: [],
        },
        occurrences: [
          { session_number: 1, status: 'scheduled', scheduled_start: '2026-09-17T11:00:00Z', scheduled_end: '2026-09-17T13:00:00Z' },
          { session_number: 2, status: 'scheduled', scheduled_start: '2026-09-24T11:00:00Z', scheduled_end: '2026-09-24T13:00:00Z' },
        ],
      }),
  }));
});

describe('the review email choice on the wire', () => {
  it('sends notifyAttendees true when the calendar itself moved', async () => {
    reviewWith(false);
    const result = await updateTeamsMeetingSchedule('LIVE-SYNTHETIC', dates());
    expect(sentBody().notifyAttendees).toBe(true);
    expect(result.notifyAttendees).toBe(true);
  });

  it('carries an explicit unchecked email choice through to the PATCH', async () => {
    reviewWith(false);
    const result = await updateTeamsMeetingSchedule('LIVE-SYNTHETIC', {
      ...dates(), notifyAttendees: false,
    });
    expect(sentBody().notifyAttendees).toBe(false);
    expect(result.notifyAttendees).toBe(false);
  });

  it('turns notifications off for a people-only update', async () => {
    // Correcting who is invited is nobody else's news. The people it adds are
    // reached on their own; everyone already on the meeting hears nothing.
    reviewWith(true);
    const result = await updateTeamsMeetingSchedule('LIVE-SYNTHETIC', { ...dates(), peopleOnly: true });
    expect(sentBody().notifyAttendees).toBe(false);
    expect(result.notifyAttendees).toBe(false);
  });

  it('turns them off for a settings-only save too, and keeps it off the wire', async () => {
    reviewWith(true);
    const result = await updateTeamsMeetingSchedule('LIVE-SYNTHETIC', {
      ...dates(), peopleOnly: true, settingsOnly: true, recording: 'record',
    });
    expect(sentBody().notifyAttendees).toBe(false);
    expect(sentBody().settingsOnly).toBeUndefined();
    expect(result.notifyAttendees).toBe(false);
  });

  it('carries the invitation list whatever the email choice is', async () => {
    reviewWith(false);
    await updateTeamsMeetingSchedule('LIVE-SYNTHETIC', {
      ...dates(), attendees: ['learner@example.invalid'], presenters: ['tutor@example.invalid'],
    });
    const sent = sentBody();
    expect(sent.notifyAttendees).toBe(true);
    expect(sent.attendees).toEqual(['learner@example.invalid']);
    expect(sent.presenters).toEqual(['tutor@example.invalid']);
  });
});
