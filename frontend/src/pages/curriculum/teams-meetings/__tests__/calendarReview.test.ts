import { beforeEach, describe, expect, it, vi } from 'vitest';
import Swal, { type SweetAlertOptions } from 'sweetalert2';
import { calendarReviewHtml, TeamsReviewCancelled } from '../calendarReview';
import { clockLabel, normalizedClock } from '../calendarTime';
import { buildTeamsCalendarInput, emptyTeamsCalendarForm } from '../createCalendarForm';
import { createTeamsMeeting, updateTeamsMeetingSchedule, type TeamsMeetingInput } from '../../module-builder/moduleAuthoringData';

vi.mock('sweetalert2', () => ({ default: { fire: vi.fn() } }));
const fetchMock = vi.fn();

const input = (): TeamsMeetingInput => ({
  title: 'Synthetic module', organizerEmail: 'organizer@example.invalid', attendees: ['learner@example.invalid'],
  presenters: [], coOrganizers: [], localStartDateTime: '2026-09-17T12:00', startDateTimeUtc: '2026-09-17T11:00:00Z',
  durationMinutes: 120, repeat: 'weekly', repeatOccurrences: 2, lobbyBypass: 'invited', recording: 'record-transcribe',
  spokenLanguage: 'en-GB', meetingType: 'live-session', details: '', requestResponses: true,
  allowNewTimeProposals: true, hideAttendees: false, transactionId: 'SYNTHETIC',
  scheduledOccurrences: [
    { sessionNumber: 1, startDateTimeUtc: '2026-09-17T11:00:00Z', durationMinutes: 120 },
    { sessionNumber: 2, startDateTimeUtc: '2026-10-29T12:00:00Z', durationMinutes: 120 },
  ],
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchMock);
  vi.mocked(Swal.fire).mockResolvedValue({ isConfirmed: true, isDenied: false, isDismissed: false });
  fetchMock.mockImplementation(async (_url, init) => ({ ok: true, json: async () => init?.method === 'POST' || init?.method === 'PATCH'
    ? { created: true, updated: true, meeting: {}, warnings: [] }
    : { series: { organizer_email: 'organizer@example.invalid', join_url: 'https://teams.microsoft.com/meet/synthetic',
      attendees: ['existing@example.invalid'], presenters: ['tutor@example.invalid'], co_organizers: [] }, occurrences: [] },
  }));
});

describe('review before sending', () => {
  it('sends nothing while review is pending and sends the reviewed snapshot after confirmation', async () => {
    let confirm!: (value: { isConfirmed: boolean; isDenied: boolean; isDismissed: boolean }) => void;
    vi.mocked(Swal.fire).mockReturnValueOnce(new Promise(resolve => { confirm = resolve; }));
    const values = input();
    const pending = createTeamsMeeting(values);
    expect(fetchMock).not.toHaveBeenCalled();
    values.attendees.push('added-after-review@example.invalid');
    confirm({ isConfirmed: true, isDenied: false, isDismissed: false });
    await pending;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sent.attendees).toEqual(['learner@example.invalid']);
    expect(sent.hideAttendees).toBe(true);
  });

  it('cancelling does not create or send anything', async () => {
    vi.mocked(Swal.fire).mockResolvedValueOnce({ isConfirmed: false, isDenied: false, isDismissed: true });
    await expect(createTeamsMeeting(input())).rejects.toBeInstanceOf(TeamsReviewCancelled);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects duplicate/overlapping dates before review and transport', async () => {
    const values = input();
    values.scheduledOccurrences![1].startDateTimeUtc = values.scheduledOccurrences![0].startDateTimeUtc;
    await expect(createTeamsMeeting(values)).rejects.toThrow('overlap');
    expect(Swal.fire).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('requires an explicit review checkbox', async () => {
    await createTeamsMeeting(input());
    const options = vi.mocked(Swal.fire).mock.calls[0][0] as unknown as { inputValidator: (value: unknown) => unknown };
    expect(options.inputValidator(0)).toBe('Confirm that you have reviewed this calendar.');
    expect(options.inputValidator(1)).toBeUndefined();
  });

  it('shows noon, midnight, timezone, recipients and escaped user text', () => {
    const values = input();
    values.title = '<img src=x onerror=alert(1)>';
    const html = calendarReviewHtml(values, 'Europe/London');
    expect(html).toContain('12:00 PM');
    expect(html).toContain('02:00 PM');
    expect(html).toContain('Europe/London');
    expect(html).toContain('learner@example.invalid');
    expect(html).toContain('&lt;img');
    expect(html).not.toContain('<img');
    values.scheduledOccurrences![0].startDateTimeUtc = '2026-09-16T23:00:00Z';
    expect(calendarReviewHtml(values, 'Europe/London')).toContain('12:00 AM');
  });

  it('reviews current organizer, link and saved recipients before a dates-only save', async () => {
    const values = input();
    const { attendees: _attendees, presenters: _presenters, coOrganizers: _coOrganizers, ...dates } = values;
    await updateTeamsMeetingSchedule('LIVE-SYNTHETIC', dates);
    expect(fetchMock.mock.calls[0][1]?.method).toBeUndefined();
    const options = vi.mocked(Swal.fire).mock.calls[0][0] as unknown as SweetAlertOptions;
    expect(options.html).toContain('existing@example.invalid');
    expect(options.html).toContain('https://teams.microsoft.com/meet/synthetic');
    const sent = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(sent).not.toHaveProperty('attendees');
    expect(fetchMock.mock.calls[1][1].method).toBe('PATCH');
  });

  it('cancelling Save makes only its read request', async () => {
    vi.mocked(Swal.fire).mockResolvedValueOnce({ isConfirmed: false, isDenied: false, isDismissed: true });
    await expect(updateTeamsMeetingSchedule('LIVE-SYNTHETIC', input())).rejects.toBeInstanceOf(TeamsReviewCancelled);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]?.method).toBeUndefined();
  });

  it('reviews serialized invitation fields and each saved duration when saving people', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ series: {
      organizer_email: 'organizer@example.invalid', join_url: 'https://teams.microsoft.com/meet/synthetic',
      attendees: '["existing@example.invalid"]', presenters: '[]', co_organizers: '[]', calendar_series: '[]',
    }, occurrences: [
      { session_number: 1, scheduled_start: '2026-09-17T11:00:00Z', scheduled_end: '2026-09-17T12:00:00Z', status: 'scheduled' },
      { session_number: 2, scheduled_start: '2026-10-29T12:00:00Z', scheduled_end: '2026-10-29T14:00:00Z', status: 'scheduled' },
    ] }) });
    const values = input();
    const { attendees: _attendees, presenters: _presenters, coOrganizers: _coOrganizers, ...dates } = values;
    await updateTeamsMeetingSchedule('LIVE-SYNTHETIC', { ...dates, peopleOnly: true });
    const sent = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(sent.scheduledOccurrences.map((item: { durationMinutes: number }) => item.durationMinutes)).toEqual([60, 120]);
    expect(sent).not.toHaveProperty('attendees');
    const options = vi.mocked(Swal.fire).mock.calls[0][0] as unknown as SweetAlertOptions;
    expect(options.html).toContain('existing@example.invalid');
  });

  it('blocks Save if stored invitation details are malformed', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ series: {
      attendees: '{broken', presenters: [], co_organizers: [],
    }, occurrences: [] }) });
    await expect(updateTeamsMeetingSchedule('LIVE-SYNTHETIC', input())).rejects.toThrow('invitation details');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(Swal.fire).not.toHaveBeenCalled();
  });
});

describe('AM/PM input and labels', () => {
  it.each([['12:00 AM', '00:00'], ['12:00 PM', '12:00'], ['03:00 PM', '15:00'], ['00:00', '00:00']])('%s normalizes to %s', (value, expected) => {
    expect(normalizedClock(value)).toBe(expected);
  });
  it('labels midnight and noon explicitly', () => {
    expect(clockLabel('00:00')).toBe('12:00 AM');
    expect(clockLabel('12:00')).toBe('12:00 PM');
  });
  it('does not send the display fallback for a missing stored time', () => {
    expect(() => buildTeamsCalendarInput({ catalogueId: 'MOD-SYNTHETIC', name: 'Synthetic', durationMinutes: 60,
      plannedStarts: [], teamsStarts: [], sessions: [{ id: 'one', date: '2026-09-17', startTime: '', endTime: '14:00' }] as never,
    }, { ...emptyTeamsCalendarForm(), organizerEmail: 'organizer@example.invalid' })).toThrow('missing or invalid time');
  });

  it('sends the correct instant and duration for legacy afternoon values', () => {
    const payload = buildTeamsCalendarInput({ catalogueId: 'MOD-SYNTHETIC', name: 'Synthetic', durationMinutes: 60,
      plannedStarts: [], teamsStarts: [], sessions: [{ id: 'one', date: '2026-09-17', startTime: '03:00 PM', endTime: '05:00 PM' }] as never,
    }, { ...emptyTeamsCalendarForm(), organizerEmail: 'organizer@example.invalid' });
    expect(payload.startDateTimeUtc).toBe('2026-09-17T14:00:00.000Z');
    expect(payload.durationMinutes).toBe(120);
    expect(payload.hideAttendees).toBe(true);
  });
});
