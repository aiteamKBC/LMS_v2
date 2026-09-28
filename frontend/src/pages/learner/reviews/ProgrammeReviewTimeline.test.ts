import { describe, expect, it } from 'vitest';
import type { LearnerCalendarEvent } from '@/api/learnerCalendar';
import type { MeetingAttendance } from '@/api/meetingAttendance';
import { completedReviewTimelineStatus, reviewTimelineStatus } from './reviewTimelineStatus';

const event = (overrides: Partial<LearnerCalendarEvent> = {}): LearnerCalendarEvent => ({
  id: 'meeting-1', eventKey: 'meeting-1', title: 'Monthly coaching', source: 'mcr', type: 'coaching', sequence: 1,
  status: 'scheduled', date: '2026-09-01', targetDate: '2026-09-01', scheduledDate: '2026-09-01',
  scheduledTime: '10:00', durationMinutes: 60, coachName: '', coachEmail: '', meetingProvider: '', meetingLink: '', notes: '',
  ...overrides,
});

const attendance = (overrides: Partial<MeetingAttendance> = {}): MeetingAttendance => ({
  id: 'meeting-1', title: 'Monthly coaching', date: '2026-09-01', startTime: '10:00', durationMinutes: 60,
  meetingLink: '', meetingProvider: '', canAttend: false, attendanceConfirmed: false, creditedMinutes: null,
  canReportAbsence: false, absenceReported: false, absenceSessionId: null, missed: false, ...overrides,
});

describe('programme review timeline status', () => {
  it('keeps an elapsed booking scheduled until an attendance source identifies its outcome', () => {
    expect(reviewTimelineStatus(event())).toBe('scheduled');
    expect(reviewTimelineStatus(event(), attendance())).toBe('scheduled');
    expect(reviewTimelineStatus(event({ meetingOutcome: 'ended' }))).toBe('missed');
    expect(reviewTimelineStatus(event({ meetingOutcome: 'completed' }))).toBe('attended');
  });

  it('uses confirmed attendance before stale missed flags and never treats a target date as a booking', () => {
    expect(reviewTimelineStatus(event(), attendance({ missed: true }))).toBe('missed');
    expect(reviewTimelineStatus(event(), attendance({ missed: true, attendanceConfirmed: true }))).toBe('attended');
    expect(reviewTimelineStatus(event({ status: 'not-scheduled', scheduledDate: null }))).toBe('planned');
    expect(reviewTimelineStatus(event({ bookingStatus: 'failed' }))).toBe('planned');
  });

  it('shows a completed review in green from any completed status without changing attendance', () => {
    expect(completedReviewTimelineStatus(event({ status: 'completed' }), attendance({ status: 'scheduled' }))).toBe('attended');
    expect(completedReviewTimelineStatus(event({ bookingStatus: 'completed' }))).toBe('attended');
    expect(completedReviewTimelineStatus(event(), attendance({ status: 'completed' }))).toBe('attended');
    expect(completedReviewTimelineStatus(event(), attendance({ missed: true }), 'completed')).toBe('attended');
    expect(completedReviewTimelineStatus(event(), attendance({ missed: true }), 'awaiting-signature')).toBe('missed');
  });
});
