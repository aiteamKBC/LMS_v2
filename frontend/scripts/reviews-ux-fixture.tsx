import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import '../src/index.css';
import '../src/learner-theme.css';
import ReviewsHome from '../src/pages/learner/progress-reviews/ReviewsHome';
import type { LearnerCalendarEvent, LearnerReviewDefinition } from '../src/api/learnerCalendar';
import type { MeetingAttendance } from '../src/api/meetingAttendance';

// Isolated synthetic UI fixture. It is not imported by the application router,
// has no API hooks, and only records action callbacks in local React state.
const params = new URLSearchParams(window.location.search);
const scenario = params.get('scenario') || 'default';
const makeReview = (id: string, sequence: number, date: string, status = 'scheduled'): LearnerCalendarEvent => ({
  id, eventKey: id, sequence, source: 'progress-review', type: 'review', title: 'Progress Review', status,
  date, targetDate: date, scheduledDate: status === 'not-scheduled' ? null : date,
  scheduledTime: status === 'not-scheduled' ? null : '11:00', durationMinutes: 60,
  coachName: 'Alex Taylor', coachEmail: '', notes: '',
  meetingLink: status === 'scheduled' ? 'https://teams.microsoft.com/example-review' : '',
  meetingProvider: status === 'scheduled' ? 'Microsoft Teams' : '',
});
const allSessions: LearnerCalendarEvent[] = [
  { ...makeReview('review-signature', 1, '2026-09-01', 'awaiting-signature'), reviewTemplateId: 'REV-SIGN', learnerSigned: false },
  { ...makeReview('review-next', 2, '2026-09-18'), targetDate: '2026-09-24' },
  makeReview('review-planned', 3, '2026-12-24', 'not-scheduled'),
  { ...makeReview('review-completed', 4, '2026-08-01', 'completed'), learnerSigned: true },
  makeReview('review-cancelled', 5, '2026-11-01', 'cancelled'),
];
const sessions = scenario === 'empty' ? [] : scenario === 'completed' ? [allSessions[3]]
  : scenario === 'planned' ? [allSessions[2]] : allSessions;
const definitions = { 'review-signature': { instance: { status: 'awaiting-signature' }, signatures: {
  participant: { required: true, signed: false }, advisor: { required: true, signed: true },
} } as LearnerReviewDefinition };
const attendance: MeetingAttendance[] = scenario === 'today' ? [{
  id: 'review-next', calendarEventKey: 'review-next', title: 'Progress Review #2', date: '2026-09-18',
  status: 'scheduled', startTime: '11:00', durationMinutes: 60, meetingLink: allSessions[1].meetingLink,
  meetingProvider: 'Microsoft Teams', canAttend: true, attendanceConfirmed: false, creditedMinutes: null,
  canReportAbsence: true, absenceReported: false, absenceSessionId: 'fixture-absence-next', missed: false,
}] : [];
const initialData = JSON.stringify({ sessions, attendance });
function Fixture() {
  const [notice, setNotice] = React.useState('');
  return <main style={{ background: '#f7f9fc', minHeight: '100vh', padding: 'clamp(16px, 3vw, 40px)', fontFamily: 'Arial, sans-serif' }}>
    <ReviewsHome sessions={sessions} attendance={attendance} definitions={definitions}
      learner={{ kind: 'apprenticeship', id: 'fixture-learner' }} lineManager="Jamie Morgan"
      today={scenario === 'today' ? '2026-09-18' : '2026-09-14'} timeZone="Europe/London"
      loading={false} error="" busy={false} canAct titleOf={session => `Progress Review #${session.sequence}`}
      onSchedule={session => setNotice(`Booking opened: ${session.id}`)}
      onAttend={id => setNotice(`Attendance: ${id}`)} onReport={session => setNotice(`Absence: ${session.id}`)}/>
    {notice && <p role="status" aria-label="Fixture action">{notice}</p>}
    <output hidden data-testid="fixture-data-unchanged">{String(initialData === JSON.stringify({ sessions, attendance }))}</output>
  </main>;
}
createRoot(document.getElementById('root')!).render(<MemoryRouter initialEntries={[`/learner/progress-reviews?${params}`]}><Fixture/></MemoryRouter>);
