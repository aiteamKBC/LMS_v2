import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import '../src/index.css';
import '../src/learner-theme.css';
import { EmployerMeetings } from '../src/pages/employer/EmployerMeetings';
import type { EmployerLearnerCard } from '../src/api/employerPortal';
import type { LearnerCalendarEvent } from '../src/api/learnerCalendar';
import styles from '../src/pages/employer/EmployerPortalPage.module.css';

const learners = [{ id: '11', kind: 'apprenticeship', name: 'Alex Learner' }, { id: '12', kind: 'commercial', name: 'Morgan Learner' }] as EmployerLearnerCard[];
const review = (id: string, extra: Partial<LearnerCalendarEvent> = {}): LearnerCalendarEvent => ({
  id, eventKey: id, title: 'Progress review', source: 'progress-review', type: 'review', sequence: 1,
  status: 'not-scheduled', date: '2026-12-01', targetDate: '2026-12-01', scheduledDate: null, scheduledTime: null,
  durationMinutes: 60, coachName: 'Example Coach', coachEmail: '', meetingProvider: '', meetingLink: '', notes: '', ...extra,
});
const reviews = {
  'apprenticeship:11': { status: 'ready' as const, data: [review('LMS:1', { scheduledDate: '2026-12-02', scheduledTime: '10:00', status: 'scheduled', invited: true, syncState: 'synced', meetingLink: 'https://teams.microsoft.com/synthetic' })] },
  'commercial:12': { status: 'ready' as const, data: [
    review('LMS:2', { scheduledDate: '2026-12-03', scheduledTime: '14:00', status: 'scheduled', invited: true, syncState: 'synced', meetingLink: 'https://teams.microsoft.com/synthetic-2' }),
    review('Aptem:1', { aptemReviewId: '77', title: 'Unbooked imported plan' }),
  ] },
};
if (new URLSearchParams(location.search).get('theme') === 'dark') document.documentElement.dataset.theme = 'dark';
createRoot(document.getElementById('root')!).render(<MemoryRouter>
  <main className={styles.page} data-view="home">
    <EmployerMeetings employerId="8" learners={learners} reviews={reviews} today="2026-11-25" />
  </main>
</MemoryRouter>);
