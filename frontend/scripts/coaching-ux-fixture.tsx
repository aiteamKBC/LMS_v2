import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import '../src/index.css';
import '../src/learner-theme.css';
import CoachingHome from '../src/pages/learner/monthly-coaching/CoachingHome';
import type { LearnerCalendarEvent, LearnerReviewDefinition } from '../src/api/learnerCalendar';

// Isolated visual smoke fixture. Not imported by the application router.
const makeMeeting = (id: string, date: string, status = 'scheduled'): LearnerCalendarEvent => ({
  id, eventKey: id, source: 'mcr', type: 'coaching', sequence: 1, title: 'Monthly Coaching Meeting',
  status, date, targetDate: date, scheduledDate: status === 'not-scheduled' ? null : date,
  scheduledTime: '11:00', durationMinutes: 60, coachName: 'Alex Taylor', coachEmail: '',
  meetingLink: 'https://teams.microsoft.com/example', meetingProvider: 'Microsoft Teams', notes: '',
});
const sessions = [makeMeeting('signature', '2026-09-01', 'awaiting-signature'), makeMeeting('next', '2026-09-15'),
  makeMeeting('later', '2026-10-15'), makeMeeting('planned', '2026-11-15', 'not-scheduled'), makeMeeting('past', '2026-08-14', 'completed')];
const reviews = { signature: { instance: { status: 'awaiting-signature' }, signatures: {
  participant: { required: true, signed: false }, advisor: { required: true, signed: true },
} } as LearnerReviewDefinition };
const params = new URLSearchParams(window.location.search);
const today = params.get('scenario') === 'today' ? '2026-09-15' : '2026-09-14';
function Fixture() {
  const [notice, setNotice] = React.useState('');
  return <div style={{ background: '#f7f9fc', minHeight: '100vh', padding: 'clamp(16px, 3vw, 40px)', fontFamily: 'Arial, sans-serif' }}>
    <CoachingHome sessions={sessions} attendance={[]} reviews={reviews} learner={{ kind: 'apprenticeship', id: 'test' }}
      today={today} loading={false} error="" canAct busy={false} onSchedule={session => setNotice(`Booking opened: ${session.id}`)}
      onAttend={id => setNotice(`Attendance: ${id}`)} onReport={session => setNotice(`Absence: ${session.id}`)}/>
    {notice && <p role="status">{notice}</p>}
  </div>;
}
createRoot(document.getElementById('root')!).render(<MemoryRouter initialEntries={[`/learner/monthly-coaching?${params}`]}><Fixture/></MemoryRouter>);
