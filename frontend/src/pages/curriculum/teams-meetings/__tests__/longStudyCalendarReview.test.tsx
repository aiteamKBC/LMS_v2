import { beforeEach, expect, it, vi } from 'vitest';
import Swal from 'sweetalert2';
import { buildTeamsCalendarInput, emptyTeamsCalendarForm } from '../createCalendarForm.helpers';
import { createTeamsMeeting, updateTeamsMeetingSchedule } from '../../module-builder/moduleAuthoringData';

vi.mock('sweetalert2', () => ({ default: { fire: vi.fn() } }));
const fetchMock = vi.fn();

function input(calendar = true) {
  return buildTeamsCalendarInput({ catalogueId: 'MOD-LONG-STUDY', name: 'Synthetic112-session calendar',
    module: { weeks: 16, ...(calendar ? { weekBoundaryMode: 'calendar' as const } : {}) },
    durationMinutes: 60, timeZone: 'Europe/London', plannedStarts: [], teamsStarts: [],
    sessions: Array.from({ length: 112 }, (_, index) => ({
      date: new Date(Date.UTC(2027, 2, 1 + index)).toISOString().slice(0, 10), startTime: '09:00', endTime: '10:00',
    })),
  }, { ...emptyTeamsCalendarForm(), scheduleTimeZone: 'Europe/London', organizerEmail: 'tutor@example.invalid', durationMinutes: '60' });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchMock);
  vi.mocked(Swal.fire).mockResolvedValue({ isConfirmed: true, isDenied: false, isDismissed: false });
  fetchMock.mockImplementation(async () => ({ ok: true, json: async () => ({ created: true, updated: true, meeting: {}, warnings: [] }) }));
});

it('reviews all112 sessions before sending, preserves local DST clocks, and keeps UI metadata off the POST', async () => {
  const calendar = input();
  expect(calendar.reviewSessionLimit).toBe(112);
  expect(calendar.scheduledOccurrences).toHaveLength(112);
  expect(calendar.scheduledOccurrences?.[0].startDateTimeUtc).toBe('2027-03-01T09:00:00.000Z');
  expect(calendar.scheduledOccurrences?.[111].startDateTimeUtc).toBe('2027-06-20T08:00:00.000Z');
  let confirm!: (value: { isConfirmed: boolean; isDenied: boolean; isDismissed: boolean }) => void;
  vi.mocked(Swal.fire).mockReturnValueOnce(new Promise(resolve => { confirm = resolve; }));
  const pending = createTeamsMeeting(calendar);
  expect(fetchMock).not.toHaveBeenCalled();
  const dialog = vi.mocked(Swal.fire).mock.calls[0][0] as unknown as { html: string };
  expect(dialog.html).toContain('112 reviewed sessions');
  expect(dialog.html.match(/class="teams-review-number"/g)).toHaveLength(112);
  confirm({ isConfirmed: true, isDenied: false, isDismissed: false });
  await pending;
  const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
  expect(sent.scheduledOccurrences).toEqual(calendar.scheduledOccurrences);
  expect(sent).not.toHaveProperty('reviewSessionLimit');
});

it('keeps the legacy52-session review guard and sends nothing for a rejected calendar', async () => {
  const calendar = input(false);
  expect(calendar).not.toHaveProperty('reviewSessionLimit');
  await expect(createTeamsMeeting(calendar)).rejects.toThrow('between 1 and 52');
  expect(Swal.fire).not.toHaveBeenCalled();
  expect(fetchMock).not.toHaveBeenCalled();
});

it('takes the update review bound from the saved calendar and retains all dates and the join link', async () => {
  const { reviewSessionLimit: _uiOnly, ...calendar } = input();
  const occurrences = calendar.scheduledOccurrences!.map(item => ({ session_number: item.sessionNumber,
    scheduled_start: item.startDateTimeUtc,
    scheduled_end: new Date(Date.parse(item.startDateTimeUtc) + item.durationMinutes * 60000).toISOString(), status: 'scheduled' }));
  fetchMock.mockImplementation(async (_url, init) => ({ ok: true, json: async () => init?.method === 'PATCH'
    ? { updated: true, meeting: {}, warnings: [] }
    : { series: { organizer_email: 'tutor@example.invalid', join_url: 'https://teams.microsoft.com/meet/synthetic-long',
      attendees: [], presenters: [], co_organizers: [], reviewSessionLimit: 112 }, occurrences },
  }));
  await updateTeamsMeetingSchedule('LIVE-LONG-STUDY', calendar);
  const dialog = vi.mocked(Swal.fire).mock.calls[0][0] as unknown as { html: string };
  expect(dialog.html).toContain('112 reviewed sessions');
  expect(dialog.html).toContain('https://teams.microsoft.com/meet/synthetic-long');
  const sent = JSON.parse(fetchMock.mock.calls[1][1].body);
  expect(sent.scheduledOccurrences).toEqual(calendar.scheduledOccurrences);
  expect(sent).not.toHaveProperty('reviewSessionLimit');
});

it.each([true, false])('waits for a slow long calendar while keeping the short legacy timeout (long=%s)', async long => {
  vi.useFakeTimers();
  try {
    const calendar = input(long);
    if (!long) {
      calendar.scheduledOccurrences = calendar.scheduledOccurrences!.slice(0, 2);
      calendar.repeatOccurrences = 2;
    }
    let signal: AbortSignal | undefined;
    let finish!: () => void;
    fetchMock.mockImplementation((_url, init) => new Promise((resolve, reject) => {
      signal = init.signal;
      finish = () => resolve({ ok: true, json: async () => ({ created: true, meeting: {}, warnings: [] }) });
      signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    }));
    const outcome = createTeamsMeeting(calendar).then(value => value, error => error);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(60000);
    expect(signal?.aborted).toBe(!long);
    if (long) {
      finish();
      expect(await outcome).toMatchObject({ created: true });
    } else {
      expect(await outcome).toBeInstanceOf(Error);
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});
