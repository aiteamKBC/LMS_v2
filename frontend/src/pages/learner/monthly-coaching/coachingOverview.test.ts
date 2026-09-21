import { describe, expect, it } from 'vitest';
import type { LearnerCalendarEvent, LearnerReviewDefinition } from '@/api/learnerCalendar';
import type { MeetingAttendance } from '@/api/meetingAttendance';
import type { ReviewParticipantRole } from '@/api/reviewInstances';
import { coachingOverview, coachingSessionState } from './coachingOverview';

const today = '2026-09-14';
const session = (id: string, date = today, overrides: Partial<LearnerCalendarEvent> = {}): LearnerCalendarEvent => ({
  id, eventKey: id, title: 'Monthly coaching', source: 'mcr', type: 'coaching', sequence: 1,
  status: 'scheduled', date, targetDate: date, scheduledDate: date, scheduledTime: '10:00',
  durationMinutes: 60, coachName: 'Coach', coachEmail: '', meetingLink: 'https://teams.microsoft.com/meet/123',
  meetingProvider: 'Microsoft Teams', notes: '', ...overrides,
});
const attendance = (id: string, overrides: Partial<MeetingAttendance> = {}): MeetingAttendance => ({
  id, title: 'Monthly coaching', date: today, startTime: '10:00', durationMinutes: 60,
  status: 'scheduled', meetingLink: 'https://teams.microsoft.com/meet/123', meetingProvider: 'Microsoft Teams',
  canAttend: true, attendanceConfirmed: false, creditedMinutes: null, canReportAbsence: true,
  absenceReported: false, absenceSessionId: null, missed: false, ...overrides,
});
function definition(pending: ReviewParticipantRole[] = ['participant'], status = 'awaiting-signature'): LearnerReviewDefinition {
  return {
    manualOverride: null,
    instance: { id: 'instance-1', reviewTemplateId: 'template-1', learnerId: 1, programmeId: 'programme-1',
      occurrenceNumber: 1, targetDate: today, status, startedAt: null, completedAt: today },
    template: { id: 'template-1', name: 'Monthly coaching',
      signatures: { participant: true, advisor: true, employer: true, referrer: false },
      visibleTo: { participant: true, advisor: true, employer: true, referrer: false },
      recurrence: { interval: 1, unit: 'month' }, notifications: {}, allowEditingPriorDays: 0 },
    sections: [], signatures: {
      participant: { required: true, signed: !pending.includes('participant') },
      advisor: { required: true, signed: !pending.includes('advisor') },
      employer: { required: true, signed: !pending.includes('employer') },
      referrer: { required: false, signed: false },
    },
  };
}

describe('monthly coaching overview', () => {
  it('keeps today in focus and preserves an older learner signature as a separate action', () => {
    const sign = session('sign', '2026-09-01', { status: 'awaiting-signature', reviewTemplateId: 'template-1' });
    const current = session('today');
    const result = coachingOverview([session('future', '2026-10-01'), sign, current], [], today, { sign: definition() });
    expect(result.current?.session).toBe(current);
    expect(result.needsAction.map(item => item.session.id)).toEqual(['sign']);
    expect(result.needsAction[0].action).toBe('sign');
    expect(result.upcoming.map(item => item.session.id)).toEqual(['today', 'future']);
  });

  it('selects the next booked appointment before an old signature or an unscheduled target', () => {
    const planned = session('planned', today, { status: 'not-scheduled', scheduledDate: null });
    const next = session('booked', '2026-09-20');
    const sign = session('sign', '2026-09-01', { status: 'awaiting-signature', reviewTemplateId: 'template-1' });
    const result = coachingOverview([sign, planned, next], [], today, { sign: definition() });
    expect(result.current?.session).toBe(next);
    expect(result.needsAction.map(item => item.session.id)).toEqual(['sign', 'planned']);
  });

  it('uses the review definition rather than the stale calendar learnerSigned flag', () => {
    const signed = session('signed', today, { status: 'awaiting-signature', learnerSigned: false });
    expect(coachingSessionState(signed, undefined, today, definition(['advisor']))).toMatchObject({
      group: 'past', signature: 'coach', action: 'view', statusLabel: 'Waiting for your coach',
    });
    expect(coachingSessionState({ ...signed, learnerSigned: true }, undefined, today, definition())).toMatchObject({
      group: 'needs-action', signature: 'learner', action: 'sign',
    });
  });

  it('distinguishes another signer from the coach and never invents a learner signature requirement', () => {
    const row = session('summary', today, { status: 'awaiting-signature' });
    expect(coachingSessionState(row, undefined, today, definition(['employer']))).toMatchObject({
      signature: 'others', needsAction: false, statusLabel: 'Waiting for other signatures',
    });
    expect(coachingSessionState(row, undefined, today)).toMatchObject({
      signature: 'unknown', needsAction: false, action: 'view', statusLabel: 'Signature pending',
    });
    const noParticipant = definition(['participant']);
    noParticipant.signatures.participant.required = false;
    expect(coachingSessionState(row, undefined, today, noParticipant).action).toBe('view');
  });

  it('requires a submitted instance before offering a signature, and still supports unsigned completed forms', () => {
    expect(coachingSessionState(session('draft'), undefined, today, definition(['participant'], 'in-progress')).action).not.toBe('sign');
    expect(coachingSessionState(session('done', today, { status: 'completed' }), undefined, today, definition(['participant'], 'completed'))).toMatchObject({
      group: 'needs-action', action: 'sign',
    });
  });

  it('keeps imported reviews read-only even if a similarly named form has a pending signature', () => {
    const archived = session('imported-review:11', '2025-01-01', { status: 'completed', importedReview: {
      id: '11', aptemReviewId: '11', name: 'Old monthly coaching', type: 'Monthly Coaching Meeting',
      reviewerName: 'Old coach', plannedDate: '2025-01-01', plannedTime: null, completedDate: '2025-01-01',
      status: 'completed', extractionStatus: 'complete', detailsAvailable: true, sections: [],
    } });
    const result = coachingOverview([archived], [], today, { [archived.id]: definition() });
    expect(result.current).toBeNull();
    expect(result.past[0]).toMatchObject({ signature: 'none', action: 'view' });
  });

  it('surfaces only overdue or next-seven-day booking reminders as tasks, including month boundaries', () => {
    const target = (id: string, date: string) => session(id, date, { status: 'not-scheduled', scheduledDate: null, scheduledTime: null });
    const result = coachingOverview([
      target('far', '2027-05-01'), target('week', '2026-10-03'), target('old', '2026-09-01'),
      target('later', '2026-10-04'),
    ], [], '2026-09-26');
    expect(result.needsAction.map(item => item.session.id)).toEqual(['old', 'week']);
    expect(result.upcoming.map(item => item.session.id)).toEqual(['later', 'far']);
    expect(result.needsAction.every(item => item.action === 'schedule')).toBe(true);
  });

  it('does not mark missing or malformed target dates overdue', () => {
    const missing = session('missing', today, { status: 'planned', scheduledDate: null, date: null, targetDate: null });
    const malformed = { ...missing, id: 'bad', targetDate: '2026-02-31' };
    expect(coachingSessionState(missing, undefined, today)).toMatchObject({ group: 'upcoming', date: null });
    expect(coachingSessionState(malformed, undefined, today)).toMatchObject({ group: 'upcoming', date: null });
  });

  it('keeps the nearest absence-reported appointment link available while prioritising rescheduling', () => {
    const absent = session('absent', '2026-09-15');
    const result = coachingOverview([session('later', '2026-10-01'), absent], [attendance('absent', {
      date: '2026-09-15', canAttend: false, absenceReported: true,
    })], today);
    expect(result.current?.session).toBe(absent);
    expect(result.current).toMatchObject({ action: 'reschedule', group: 'needs-action', joinUrl: 'https://teams.microsoft.com/meet/123' });
  });

  it('only calls past attendance missed when the attendance source says so', () => {
    const past = session('past', '2026-09-13');
    expect(coachingSessionState(past, undefined, today)).toMatchObject({ action: 'view', group: 'past', statusLabel: 'Awaiting update' });
    expect(coachingSessionState(past, attendance('past', { date: '2026-09-13', missed: true, canAttend: false }), today)).toMatchObject({
      action: 'reschedule', group: 'needs-action', statusLabel: 'Meeting missed',
    });
  });

  it('never reschedules attendance that is confirmed or a review already in progress/submitted', () => {
    const missed = attendance('row', { missed: true, absenceReported: true });
    expect(coachingSessionState(session('row'), { ...missed, attendanceConfirmed: true }, today)).toMatchObject({
      action: 'view', group: 'past', statusLabel: 'Attended',
    });
    for (const status of ['in-progress', 'completed', 'awaiting-signature']) {
      expect(coachingSessionState(session('row', today, { status }), { ...missed, status }, today).action).toBe('view');
    }
  });

  it('lets attendance cancellation/completion override a stale scheduled calendar row', () => {
    const row = session('row');
    for (const status of ['cancelled', 'deleted', 'superseded', 'completed']) {
      const result = coachingOverview([row], [attendance('row', { status })], today);
      expect(result.current).toBeNull();
      expect(result.past[0]).toMatchObject({ action: 'view', booked: false, joinUrl: null });
    }
  });

  it('joins attendance only by occurrence identity and uses its trusted meeting link', () => {
    const first = session('one', today, { eventKey: 'calendar:one' });
    const second = session('two');
    const result = coachingOverview([first, second], [attendance('imported-review:8', {
      calendarEventKey: 'calendar:one', absenceReported: true,
    })], today);
    expect(result.needsAction.map(item => item.session.id)).toEqual(['one']);
    expect(result.upcoming.map(item => item.session.id)).toEqual(['two']);
    expect(result.needsAction[0].session).toBe(first);
    expect(coachingSessionState(second, attendance('two', { meetingLink: '' }), today)).toMatchObject({
      action: 'prepare', joinUrl: null,
    });
  });

  it('prioritises joining on the meeting date while keeping future meeting links available', () => {
    expect(coachingSessionState(session('now'), undefined, today)).toMatchObject({ action: 'join', joinUrl: 'https://teams.microsoft.com/meet/123' });
    expect(coachingSessionState(session('future', '2026-09-15'), undefined, today)).toMatchObject({ action: 'prepare', joinUrl: 'https://teams.microsoft.com/meet/123' });
  });

  it.each(['javascript:alert(1)', 'http://teams.microsoft.com/meet/123', '/meeting/123', 'not a URL'])(
    'never exposes an unsafe meeting URL: %s', meetingLink => {
      expect(coachingSessionState(session('bad', today, { meetingLink }), undefined, today)).toMatchObject({ action: 'prepare', joinUrl: null });
      expect(coachingSessionState(session('absent', '2026-09-15'), attendance('absent', {
        date: '2026-09-15', absenceReported: true, meetingLink,
      }), today)).toMatchObject({ action: 'reschedule', joinUrl: null });
    },
  );

  it.each(['cancelled', 'deleted', 'superseded', 'completed', 'awaiting-signature', 'failed'])(
    'does not expose a stale meeting link when the booking is %s', status => {
      const row = session('closed', '2026-09-15', { status });
      expect(coachingSessionState(row, undefined, today).joinUrl).toBeNull();
      expect(coachingSessionState(session('closed', '2026-09-15'), attendance('closed', {
        date: '2026-09-15', status,
      }), today).joinUrl).toBeNull();
    },
  );

  it('does not offer joining again after attendance has been confirmed', () => {
    expect(coachingSessionState(session('attended'), attendance('attended', { attendanceConfirmed: true }), today)).toMatchObject({
      action: 'view', joinUrl: null, statusLabel: 'Attended',
    });
  });

  it('partitions every occurrence into one tab and keeps recent history first without mutating inputs', () => {
    const rows = [session('done-old', '2026-09-01', { status: 'completed' }),
      session('book', '2026-09-17', { status: 'planned', scheduledDate: null }),
      session('next', '2026-09-20'), session('done-new', '2026-09-10', { status: 'completed' })];
    const order = rows.map(row => row.id);
    const result = coachingOverview(rows, [], today);
    const grouped = [...result.needsAction, ...result.upcoming, ...result.past];
    expect(grouped).toHaveLength(rows.length);
    expect(new Set(grouped.map(item => item.session.id)).size).toBe(rows.length);
    expect(result.past.map(item => item.session.id)).toEqual(['done-new', 'done-old']);
    expect(rows.map(row => row.id)).toEqual(order);
    expect(coachingOverview([], [], today).current).toBeNull();
  });
});
