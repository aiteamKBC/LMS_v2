import { describe, expect, it } from 'vitest';
import type { LearnerCalendarEvent, LearnerReviewDefinition } from '@/api/learnerCalendar';
import type { MeetingAttendance } from '@/api/meetingAttendance';
import { presentReview, reviewOverview, reviewsListHref } from './reviewPresentation';

describe('APTEM next review uses lifecycle eligibility, not imported-record presence', () => {
  const dates = ['2026-10-26', '2027-03-30', '2027-06-29', '2027-09-29'];
  const row = (number: number, status = 'not-scheduled', overrides: Partial<LearnerCalendarEvent> = {}) => session(`aptem:${number}`, {
    sequence: number, title: `Progress Review ${number}`, reviewSource: 'aptem', migratedForm: false,
    status, effectiveLmsStatus: status, sourceStatus: status, targetDate: dates[number - 1], date: dates[number - 1],
    scheduledDate: null, scheduledTime: null, meetingLink: '', importedReview: {
      id: String(number), aptemReviewId: `A-${number}`, name: `Progress Review ${number}`, type: 'Progress Review', reviewerName: 'Synthetic Coach',
      plannedDate: dates[number - 1], plannedTime: null, completedDate: status === 'completed' ? dates[number - 1] : null,
      status, extractionStatus: 'complete', detailsAvailable: false, sections: [],
    }, ...overrides,
  });

  it.each(['participant', 'employer'] as const)('selects Review 2 after completed Review 1 for %s, regardless of API order', viewer => {
    const rows = [row(4), row(1, 'completed'), row(3), row(2)];
    const before = structuredClone(rows);
    const result = reviewOverview(rows, [], '2026-10-24', {}, viewer);
    expect(result.all.map(item => item.session.sequence)).toEqual([1, 2, 3, 4]);
    expect(result.current?.session.id).toBe('aptem:2');
    expect(result.upcoming.map(item => item.session.sequence)).toEqual([2, 3, 4]);
    expect(rows).toEqual(before);
  });

  it('selects Review 1 when all four are pending, without deriving completion from dates', () => {
    expect(reviewOverview([row(4), row(2), row(1), row(3)], [], '2026-10-24', {}, 'employer').current?.session.id).toBe('aptem:1');
  });

  it.each(['completed', 'cancelled', 'unknown'])('has no next action when all imported reviews are %s', status => {
    expect(reviewOverview([row(1, status), row(2, status)], [], '2026-10-24', {}, 'employer').current).toBeNull();
  });

  it('keeps the existing Native historical fallback and empty-state contract', () => {
    const native = session('native-history', { status: 'completed' });
    expect(reviewOverview([native], [], today, {}, 'employer').current?.session).toBe(native);
    expect(reviewOverview([], [], today, {}, 'employer').current).toBeNull();
  });

  it('retains confirmed-booking priority over unbooked plans and signature reminders', () => {
    const booked = row(3, 'scheduled', { calendarEventKey: 'booking:3', scheduledDate: dates[2], bookingStatus: 'scheduled' });
    const sign = row(1, 'awaiting-signature', { migratedForm: true, employerSignatureRequired: true, employerSigned: false });
    const result = reviewOverview([row(2), sign, booked, row(4)], [], '2026-10-24', {}, 'employer');
    expect(result.current?.session).toBe(booked);
    expect(result.attention.map(item => item.session.id)).toEqual(['aptem:1']);
  });

  it.each(['in-progress', 'awaiting-signature', 'completed', 'not-scheduled'])('preserves resolved local %s over stale scheduled booking status', status => {
    const local = row(2, status, { migratedForm: true, sourceStatus: 'not-scheduled', bookingStatus: 'scheduled' });
    const result = presentReview(local, undefined, today, undefined, 'employer');
    expect(result.status).toBe(status);
  });

  it('keeps source-completed history completed despite a stale cancelled calendar copy', () => {
    const history = row(1, 'completed', { bookingStatus: 'cancelled' });
    expect(presentReview(history, undefined, today, undefined, 'employer')).toMatchObject({ status: 'completed', past: true, action: 'view' });
    expect(reviewOverview([history, row(2)], [], today, {}, 'employer').current?.session.id).toBe('aptem:2');
  });

  it.each(['attended', 'missed'] as const)('does not convert %s evidence into formal Review completion', outcome => {
    const local = row(2, 'in-progress', { migratedForm: true, calendarEventKey: 'booking:2', scheduledDate: today, bookingStatus: 'scheduled' });
    expect(presentReview(local, attendance(local.id, { attendanceConfirmed: outcome === 'attended', missed: outcome === 'missed' }), today, undefined, 'employer').status).toBe('in-progress');
  });
});

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
    manualOverride: null,
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
    // Identity, not position: the list is ordered by planned date, so each input
    // event is located by id and must still be the very same object, never a copy.
    expect(result.all).toHaveLength(sessions.length);
    sessions.forEach(input => expect(result.all.find(item => item.session.id === input.id)?.session).toBe(input));
    expect([...result.all].sort((a, b) => a.session.id.localeCompare(b.session.id)).map(item => item.session))
      .toEqual([...original].sort((a, b) => a.id.localeCompare(b.id)));
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
    expect(result.all.find(item => item.session.id === 'moved')).toMatchObject({ date: '2026-10-01', attendance: confirmed });
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

  it.each([
    ['scheduled', 'Scheduled'], ['not-scheduled', 'Not scheduled'], ['planned', 'Not scheduled'], ['in-progress', 'In progress'],
    ['awaiting-signature', 'Awaiting signatures'], ['completed', 'Completed'], ['cancelled', 'Cancelled'],
  ])('names an imported %s review by its state, as the detail header does', (status, label) => {
    const imported = session('imported-review:12', { status, importedReview: {
      id: '12', aptemReviewId: '12', name: 'Imported review', type: 'Progress Review', reviewerName: 'Previous coach',
      plannedDate: '2025-01-01', plannedTime: null, completedDate: '2025-01-01', status,
      extractionStatus: 'complete', detailsAvailable: true, sections: [],
    } });
    expect(presentReview(imported, undefined, today)).toMatchObject({ label, action: 'view', past: true });
    expect(presentReview(imported, undefined, today, undefined, 'employer')).toMatchObject({
      label, action: 'view', past: true, needsAttention: false, booked: false, canReschedule: false, joinUrl: null,
    });
  });

  it('falls back to a neutral record label when an imported row carries no recognised state', () => {
    const imported = session('imported-review:13', { status: 'unknown', importedReview: {
      id: '13', aptemReviewId: '13', name: 'Imported review', type: 'Progress Review', reviewerName: 'Previous coach',
      plannedDate: '2025-01-01', plannedTime: null, completedDate: '2025-01-01', status: 'unknown',
      extractionStatus: 'complete', detailsAvailable: true, sections: [],
    } });
    expect(presentReview(imported, undefined, today)).toMatchObject({ label: 'Review record', action: 'view' });
    expect(presentReview(imported, undefined, today, undefined, 'employer')).toMatchObject({ label: 'Review record', action: 'view', past: true });
  });

  it.each(['cancelled', 'deleted', 'superseded', 'completed'])('does not offer booking or joining when attendance status is %s', status => {
    const result = presentReview(session('closed', { learnerSigned: true }), attendance('closed', { status }), today);
    expect(result).toMatchObject({ action: 'view', booked: false, canReschedule: false, joinUrl: null, past: true });
  });

  const aptem = (overrides: Partial<LearnerCalendarEvent> = {}) => session('imported-review:11', {
    reviewId: '11', reviewSource: 'aptem', calendarEventKey: 'booking:11', importedReview: {
      id: '11', aptemReviewId: 'A-11', name: 'Imported review', type: 'Progress Review', reviewerName: 'Coach',
      plannedDate: today, plannedTime: '10:00', completedDate: null, status: 'scheduled',
      extractionStatus: 'complete', detailsAvailable: true, sections: [],
    }, ...overrides,
  });

  it('offers rescheduling for an active Aptem booking without treating a source date as a booking', () => {
    expect(presentReview(aptem(), undefined, today)).toMatchObject({ booked: true, past: false, canReschedule: true });
    expect(presentReview(aptem({ calendarEventKey: undefined }), undefined, today)).toMatchObject({
      booked: false, past: false, canReschedule: false, action: 'schedule', label: 'Not scheduled',
    });
  });

  it.each(['scheduled', 'in-progress'])('recognises a coach-booked PSP that is %s without offering learner rescheduling', status => {
    const row = aptem({ status, importedReview: { ...aptem().importedReview!, type: 'Personal Support Plan' } });
    expect(presentReview(row, undefined, today)).toMatchObject({
      booked: true, past: false, action: 'join', joinUrl: row.meetingLink, canReschedule: false,
    });
  });

  it.each(['unbooked', 'completed', 'cancelled', 'source-completed'])('does not expose a meeting link for a %s PSP', state => {
    const row = aptem({
      status: ['completed', 'cancelled'].includes(state) ? state : 'scheduled',
      calendarEventKey: state === 'unbooked' ? undefined : 'booking:11',
      importedReview: { ...aptem().importedReview!, type: 'Personal Support Plan',
        completedDate: state === 'source-completed' ? today : null },
    });
    expect(presentReview(row, undefined, today)).toMatchObject({
      booked: false, action: 'view', joinUrl: null, canReschedule: false,
    });
  });

  it.each(['Progress Review', 'Progress Review (+ Skills Radar)'])('keeps an unbooked Aptem %s in upcoming reviews with a booking action', type => {
    const row = aptem({ status: 'not-scheduled', calendarEventKey: undefined, scheduledDate: null, scheduledTime: null,
      targetDate: '2027-03-11', importedReview: { ...aptem().importedReview!, type, status: 'Not Scheduled' } });
    const before = structuredClone(row);
    const result = reviewOverview([row], [], today);
    expect(result.current).toMatchObject({ session: row, action: 'schedule', label: 'Not scheduled', booked: false, canReschedule: false });
    expect(result.upcoming).toHaveLength(1);
    expect(result.past).toEqual([]);
    expect(row).toEqual(before);
    expect(presentReview(row, undefined, today, undefined, 'employer').action).toBe('view');
  });

  it.each(['completed', 'awaiting-signature', 'in-progress', 'cancelled'])('does not book an Aptem %s review despite a stale unscheduled list status', status => {
    const row = aptem({ status: 'not-scheduled', calendarEventKey: undefined, scheduledDate: null });
    expect(presentReview(row, undefined, today, definition(status)).action).toBe('view');
    expect(presentReview({ ...row, importedReview: { ...row.importedReview!, status } }, undefined, today).action).toBe('view');
    expect(presentReview({ ...row, sourceStatus: status }, undefined, today).action).toBe('view');
  });

  it('does not book completed source history, an attended occurrence, or an ordinary imported review', () => {
    const row = aptem({ status: 'not-scheduled', calendarEventKey: undefined, scheduledDate: null });
    expect(presentReview({ ...row, importedReview: { ...row.importedReview!, completedDate: today } }, undefined, today).action).toBe('view');
    expect(presentReview(row, attendance(row.id, { attendanceConfirmed: true }), today).action).toBe('view');
    expect(presentReview({ ...row, importedReview: { ...row.importedReview!, type: 'Eligibility Review & FS Discussion' } }, undefined, today).action).toBe('view');
  });

  it.each(['completed', 'awaiting-signature', 'in-progress', 'cancelled'])('keeps a linked Aptem %s review closed to rescheduling despite stale attendance', status => {
    expect(presentReview(aptem({ status }), attendance('imported-review:11'), today).canReschedule).toBe(false);
  });

  it.each(['completed', 'awaiting-signature', 'in-progress'])('does not reschedule a linked Aptem form with %s content', status => {
    expect(presentReview(aptem(), attendance('imported-review:11'), today, definition(status)).canReschedule).toBe(false);
  });

  it('does not reschedule an attended Aptem booking', () => {
    expect(presentReview(aptem(), attendance('imported-review:11', { attendanceConfirmed: true }), today).canReschedule).toBe(false);
  });

  it.each(['calendar-key', 'review-id'])('matches Aptem attendance using its %s without matching another review on the same day', match => {
    const row = aptem({ id: 'aptem-event:A-11', calendarEventKey: match === 'calendar-key' ? 'booking:11' : undefined });
    const matched = attendance(match === 'review-id' ? 'imported-review:11' : 'local-booking:11', {
      calendarEventKey: 'booking:11', date: '2026-10-01', attendanceConfirmed: true,
    });
    const unrelated = attendance('imported-review:12', { calendarEventKey: 'booking:12' });
    const result = reviewOverview([row], [unrelated, matched], today).all[0];
    expect(result).toMatchObject({ attendance: matched, date: '2026-10-01', canReschedule: false });
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
    expect(reviewsListHref(learner, new URLSearchParams('view=all&filter=upcoming'), '/learner/reviews')).toBe('/learner/reviews?kind=apprenticeship&learner=12&view=all&filter=upcoming');
  });
});

describe('programme order follows the planned date, not the date a review was completed', () => {
  // An imported review carries its planned date in targetDate/scheduledDate and,
  // once completed, its completed date in `date`. The reader upstream orders by
  // `date`, so these arrive in completed order while every row displays planned
  // dates. Each case receives them in that upstream order.
  const imported = (id: string, planned: string, completed: string, sequence: number) =>
    session(id, { date: completed, targetDate: planned, scheduledDate: planned, status: 'completed', sequence });

  it('reorders a review completed away from its plan, and shows dates that agree with the order', () => {
    const sessions = [imported('second', '2026-12-17', '2026-05-04', 2), imported('first', '2026-10-20', '2026-10-20', 1)];
    sessions.forEach(Object.freeze);
    const result = reviewOverview(Object.freeze(sessions), [], today);

    expect(result.all.map(item => item.session.id)).toEqual(['first', 'second']);
    expect(result.all.map(item => item.date)).toEqual(['2026-10-20', '2026-12-17']);
  });

  it('falls back to the occurrence, then to the order the reader gave, on a shared planned date', () => {
    const sessions = [imported('later', '2027-06-02', '2027-06-02', 4), imported('earlier', '2027-06-02', '2027-06-02', 3)];
    expect(reviewOverview(sessions, [], today).all.map(item => item.session.id)).toEqual(['earlier', 'later']);

    const tied = [imported('b', '2027-06-02', '2027-06-02', 3), imported('a', '2027-06-02', '2027-06-02', 3)];
    expect(reviewOverview(tied, [], today).all.map(item => item.session.id)).toEqual(['b', 'a']);
  });

  it('carries the same order into the upcoming and past filters', () => {
    const sessions = [
      imported('past-two', '2026-08-11', '2026-02-02', 2),
      imported('past-one', '2026-06-09', '2026-07-07', 1),
      session('ahead-two', { date: '2027-01-05', targetDate: '2027-01-05', scheduledDate: '2027-01-05', sequence: 4 }),
      session('ahead-one', { date: '2026-11-03', targetDate: '2026-11-03', scheduledDate: '2026-11-03', sequence: 3 }),
    ];
    const result = reviewOverview(sessions, [], today);

    expect(result.upcoming.map(item => item.session.id)).toEqual(['ahead-one', 'ahead-two']);
    // Past stays most-recent-first, now measured by planned date.
    expect(result.past.map(item => item.session.id)).toEqual(['past-two', 'past-one']);
  });

  it('leaves a review without a planned date at the end instead of dropping it', () => {
    const undated = session('undated', { date: null, targetDate: null, scheduledDate: null, status: 'not-scheduled', sequence: 9 });
    const planned = imported('planned', '2027-08-25', '2027-08-25', 5);
    expect(reviewOverview([undated, planned], [], today).all.map(item => item.session.id)).toEqual(['planned', 'undated']);
  });
});
