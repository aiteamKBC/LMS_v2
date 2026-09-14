import { describe, expect, it } from 'vitest';
import type { LearnerCalendarEvent, LearnerReviewDefinition } from '@/api/learnerCalendar';
import type { MeetingAttendance } from '@/api/meetingAttendance';
import { presentReview, reviewOverview, reviewsListHref } from './reviewPresentation';

const today = '2026-09-14';
const session = (id: string, overrides: Partial<LearnerCalendarEvent> = {}): LearnerCalendarEvent => ({
  id, eventKey: id, title: `Progress Review ${id}`, source: 'progress-review', type: 'review', sequence: 1,
  status: 'scheduled', date: today, targetDate: today, scheduledDate: today, scheduledTime: '10:00',
  durationMinutes: 60, coachName: 'Coach', coachEmail: '', meetingLink: 'https://teams.microsoft.com/meet/123',
  meetingProvider: 'Microsoft Teams', notes: '', ...overrides,
});
const attendance = (id: string, overrides: Partial<MeetingAttendance> = {}): MeetingAttendance => ({
  id, title: 'Progress Review', date: today, startTime: '10:00', durationMinutes: 60, status: 'scheduled',
  meetingLink: 'https://teams.microsoft.com/meet/123', meetingProvider: 'Microsoft Teams',
  canAttend: true, attendanceConfirmed: false, creditedMinutes: null, canReportAbsence: false,
  absenceReported: false, absenceSessionId: null, missed: false, ...overrides,
});
function definition(status = 'awaiting-signature', participantRequired = true, participantSigned = false): LearnerReviewDefinition {
  return {
    instance: { id: 'instance-1', reviewTemplateId: 'template-1', learnerId: 12, programmeId: 'programme-1',
      occurrenceNumber: 1, targetDate: today, status, startedAt: null, completedAt: today },
    template: { id: 'template-1', name: 'Progress Review',
      signatures: { participant: participantRequired, advisor: true, employer: true, referrer: false },
      visibleTo: { participant: true, advisor: true, employer: true, referrer: false },
      recurrence: { interval: 3, unit: 'month' }, notifications: {}, allowEditingPriorDays: 0 },
    sections: [], signatures: {
      participant: { required: participantRequired, signed: participantSigned },
      advisor: { required: true, signed: true }, employer: { required: true, signed: false },
      referrer: { required: false, signed: false },
    },
  };
}

describe('review presentation preserves review and booking rules', () => {
  it('selects the nearest booked review while preserving an older signature and original event identities', () => {
    const signature = session('sign', { date: '2026-09-01', scheduledDate: '2026-09-01', status: 'awaiting-signature', reviewTemplateId: 'template-1' });
    const planned = session('planned', { status: 'not-scheduled', scheduledDate: null, targetDate: '2026-09-10' });
    const next = session('next', { scheduledDate: '2026-09-20' });
    const sessions = [signature, planned, session('later', { scheduledDate: '2026-10-01' }), next];
    const original = structuredClone(sessions);
    sessions.forEach(Object.freeze);
    Object.freeze(sessions);
    const result = reviewOverview(sessions, [], today, { sign: definition() });
    expect(result.current?.session).toBe(next);
    expect(result.attention.find(item => item.session.id === 'sign')).toMatchObject({ action: 'sign', past: true });
    expect(result.all.map(item => item.session)).toEqual(original);
    result.all.forEach((item, index) => expect(item.session).toBe(sessions[index]));
    expect([...result.upcoming, ...result.past]).toHaveLength(sessions.length);
    expect(new Set([...result.upcoming, ...result.past].map(item => item.session.id)).size).toBe(sessions.length);
    expect(sessions).toEqual(original);
  });

  it('uses the current attendance appointment when selecting the next review without rewriting its calendar row', () => {
    const moved = session('moved', { scheduledDate: '2026-09-15', targetDate: '2026-09-15' });
    const next = session('next', { scheduledDate: '2026-09-18' });
    const confirmed = attendance('moved', { date: '2026-10-01', startTime: '15:00' });
    const before = structuredClone({ moved, confirmed });
    Object.freeze(moved);
    Object.freeze(confirmed);
    const result = reviewOverview([moved, next], [confirmed], today);
    expect(result.current?.session).toBe(next);
    expect(result.all[0]).toMatchObject({ date: '2026-10-01', attendance: confirmed });
    expect({ moved, confirmed }).toEqual(before);
  });

  it('matches attendance by exact id or event key and preserves its separate durable id', () => {
    const row = session('calendar:22', { eventKey: 'event:22' });
    const matched = attendance('imported-review:8', { calendarEventKey: 'event:22' });
    const unrelated = attendance('other', { title: row.title, calendarEventKey: 'event:other' });
    const result = reviewOverview([row, session('another')], [unrelated, matched], today);
    expect(result.all[0].attendance).toBe(matched);
    expect(result.all[1].attendance).toBeUndefined();
  });

  it('requires a submitted form and an unsigned required participant signature for Curriculum reviews', () => {
    const row = session('form', { status: 'awaiting-signature', reviewTemplateId: 'template-1', learnerSigned: true });
    expect(presentReview(row, undefined, today, definition())).toMatchObject({ action: 'sign', needsAttention: true });
    expect(presentReview(row, undefined, today, definition('in-progress')).action).toBe('view');
    expect(presentReview(row, undefined, today).action).toBe('view');
    expect(presentReview(row, undefined, today, definition('awaiting-signature', false))).toMatchObject({ action: 'view', needsAttention: false });
    expect(presentReview({ ...row, learnerSigned: false }, undefined, today, definition('awaiting-signature', true, true))).toMatchObject({
      action: 'view', label: 'Waiting for other signatures', needsAttention: false,
    });
  });

  it('preserves the legacy learner signature rule and supports submitted completed forms still requiring a signature', () => {
    const legacy = session('legacy', { status: 'awaiting-signature', learnerSigned: false });
    expect(presentReview(legacy, undefined, today).action).toBe('sign');
    expect(presentReview({ ...legacy, learnerSigned: true }, undefined, today).action).toBe('view');
    const completed = session('form', { status: 'completed', reviewInstanceId: 'instance-1' });
    expect(presentReview(completed, undefined, today, definition('completed'))).toMatchObject({ action: 'sign', booked: false, canReschedule: false, joinUrl: null });
  });

  it.each(['scheduled', 'not-scheduled', 'awaiting-signature', 'completed'])('keeps imported %s reviews read-only', status => {
    const imported = session('imported-review:11', { status, importedReview: {
      id: '11', aptemReviewId: '11', name: 'Imported review', type: 'Progress Review', reviewerName: 'Previous coach',
      plannedDate: '2025-01-01', plannedTime: null, completedDate: '2025-01-01', status,
      extractionStatus: 'complete', detailsAvailable: true, sections: [],
    } });
    const result = presentReview(imported, undefined, today, definition(['awaiting-signature', 'completed'].includes(status) ? status : 'in-progress'));
    expect(result).toMatchObject({ action: 'view', past: true, needsAttention: false, canReschedule: false, joinUrl: null });
  });

  it.each(['cancelled', 'deleted', 'superseded', 'completed'])('does not offer booking or joining when attendance status is %s', status => {
    const result = presentReview(session('closed', { learnerSigned: true }), attendance('closed', { status }), today);
    expect(result).toMatchObject({ action: 'view', booked: false, canReschedule: false, joinUrl: null, past: true });
  });

  it('does not infer a missed meeting or attendance from a past date', () => {
    const row = session('past', { scheduledDate: '2026-09-01' });
    expect(presentReview(row, undefined, today)).toMatchObject({ action: 'view', label: 'Awaiting update', past: true });
    expect(presentReview(row, attendance('past', { date: '2026-09-01', missed: true, canAttend: false }), today).label).toBe('Meeting missed');
    expect(presentReview(row, attendance('past', { date: '2026-09-01', attendanceConfirmed: true }), today)).toMatchObject({ action: 'view', label: 'Attendance recorded', canReschedule: false });
  });

  it('keeps unbooked target dates as booking reminders even when their target date is overdue', () => {
    expect(presentReview(session('target', { status: 'not-scheduled', scheduledDate: null, targetDate: '2026-09-01' }), undefined, today)).toMatchObject({
      action: 'schedule', label: 'Not scheduled', booked: false, past: false, joinUrl: null,
    });
  });

  it('uses the confirmed attendance link without falling back to a stale calendar URL', () => {
    expect(presentReview(session('now'), attendance('now', { meetingLink: '' }), today)).toMatchObject({ action: 'view', joinUrl: null });
    expect(presentReview(session('now'), attendance('now', { meetingLink: 'https://teams.microsoft.com/meet/new' }), today)).toMatchObject({
      action: 'join', joinUrl: 'https://teams.microsoft.com/meet/new',
    });
    expect(presentReview(session('future', { scheduledDate: '2026-09-20' }), undefined, today)).toMatchObject({ action: 'view', joinUrl: 'https://teams.microsoft.com/meet/123' });
  });

  it.each(['javascript:alert(1)', 'http://example.com/meeting', '/relative/meeting', 'invalid'])('never exposes an unsafe meeting link: %s', meetingLink => {
    expect(presentReview(session('unsafe', { meetingLink }), undefined, today)).toMatchObject({ action: 'view', joinUrl: null });
  });

  it('uses resolved learner identity and carries only valid review list context back from details', () => {
    const learner = { kind: 'apprenticeship', id: '12' };
    const href = reviewsListHref(learner, new URLSearchParams('kind=bootcamp&learner=999&view=all&filter=past&page=2&unrelated=secret'));
    expect(href).toBe('/learner/progress-reviews?kind=apprenticeship&learner=12&view=all&filter=past&page=2');
    expect(reviewsListHref(learner, new URLSearchParams('view=all&filter=unknown&page=-1'))).toBe('/learner/progress-reviews?kind=apprenticeship&learner=12&view=all');
    expect(reviewsListHref(learner, new URLSearchParams('filter=past&page=2'))).toBe('/learner/progress-reviews?kind=apprenticeship&learner=12');
  });
});
