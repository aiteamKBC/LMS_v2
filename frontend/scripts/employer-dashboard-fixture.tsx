import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import '../src/index.css';
import '../src/learner-theme.css';
import { EmployerDashboard } from '../src/pages/employer/EmployerDashboard';
import type { EmployerPortal, EmployerDashboardMetrics } from '../src/api/employerPortal';
import type { LearnerCalendarEvent } from '../src/api/learnerCalendar';
import type { DashboardReviews } from '../src/pages/employer/employerDashboardData';

// Isolated, synthetic visual fixture. No authentication or API hooks are mounted.
const params = new URLSearchParams(window.location.search);
const scenario = params.get('scenario');
const viewParam = params.get('view');
const view = viewParam === 'learners' || viewParam === 'reviews' ? viewParam : 'home';
const data: EmployerPortal = {
  employer: { id: '8', name: 'Example employer', email: '', employerGroupNames: ['Example Organisation'] },
  outstandingTotal: 1,
  learners: [
    { id: '11', kind: 'apprenticeship', name: 'Alex Learner', email: 'alex@example.test', programme: 'Data Analysis', cohort: 'Cohort A', programmeStatus: 'Active', onboardingStatus: '', isActive: true, outstandingCount: 1, documentsTotal: 2, otjhProgress: { actual: 90, planned: 200, percent: 45 } },
    { id: '12', kind: 'commercial', name: 'Morgan Learner', email: 'morgan@example.test', programme: 'Marketing Manager Level 6', cohort: 'October 2026', programmeStatus: 'Active', onboardingStatus: '', isActive: true, outstandingCount: 0, documentsTotal: 2, otjhProgress: { actual: 70, planned: 400, percent: 17.5 } },
  ],
};
data.learners[0].learnerStartDate = '2026-10-01';
data.learners[0].learnerEndDate = '2027-10-25';
const metrics: EmployerDashboardMetrics = { asOf: '2026-10-21', learners: {
  '11': { programme: { completed: 68, total: 100, percent: 68, status: 'ready' }, otjh: null, attendance: null, risk: 'on-track' },
  '12': { programme: { completed: 32, total: 100, percent: 32, status: 'ready' }, otjh: null, attendance: null, risk: 'need-attention' },
} };
const reviews: DashboardReviews = {};
for (const learner of data.learners) {
  const dates = view === 'reviews' ? ['2026-09-10', '2026-10-24', '2026-12-10', '2027-02-10', '2027-04-10', '2027-06-10'] : ['2026-09-10', '2026-10-24', '2026-12-10', '2027-02-10'];
  const events = dates.map((date, index): LearnerCalendarEvent => ({
    id: learner.id + '-' + index, eventKey: learner.id + '-' + index,
    title: view === 'reviews' && index === 3 ? 'Progress review and skills development' : 'Progress review', occurrenceNumber: index + 1,
    source: 'progress-review', type: 'review', sequence: index, status: index === 0 ? 'completed' : index === 1 ? 'scheduled' : 'not-scheduled',
    date, targetDate: date, scheduledDate: index < 2 ? date : null, scheduledTime: '09:00', durationMinutes: 60,
    coachName: 'Example coach', coachEmail: '', notes: '', meetingProvider: '', meetingLink: '',
  }));
  if (view === 'reviews' && learner.id === '12') {
    events[1] = { ...events[1], status: 'awaiting-signature', employerSignatureRequired: true, employerSigned: false };
  }
  reviews[learner.kind + ':' + learner.id] = { status: 'ready', data: events };
}
if (scenario === 'reviews-error') reviews['apprenticeship:11'] = { status: 'error' };
if (scenario === 'reviews-loading') reviews['apprenticeship:11'] = { status: 'loading' };
if (scenario === 'empty') data.learners = [];
if (scenario === 'missing') { metrics.learners = {}; data.learners.forEach(learner => { learner.otjhProgress = null; }); }
if (scenario === 'many') {
  data.learners = Array.from({ length: 12 }, (_, index) => ({ ...data.learners[index % 2], id: String(index + 100), name: 'Example Learner ' + (index + 1) }));
  data.learners.forEach(learner => { metrics.learners[learner.id] = metrics.learners['11']; reviews[learner.kind + ':' + learner.id] = { status: 'ready', data: [] }; });
}
createRoot(document.getElementById('root')!).render(<MemoryRouter initialEntries={['/employers/8']}>
  <div className="dashboard-theme" data-workspace-role="learner" style={params.has('sidebar') ? { marginLeft: 228 } : undefined}><main className="workspace-main">
  <EmployerDashboard data={data} metrics={{ status: 'ready', data: metrics }} programmeMetrics={{ status: 'ready', data: metrics }} attendance={scenario === 'missing' ? {} : Object.fromEntries(data.learners.map(learner => [learner.kind + ':' + learner.id, { status: 'ready' as const, data: { present: learner.id === '11' ? 4 : 3, sessions: 5, absent: 1, late: 0, attendanceRate: learner.id === '11' ? 80 : 60 } }]))} reviews={reviews} reviewSummaries={reviews} view={view} today="2026-10-21" onRetry={() => undefined} />
  </main></div>
</MemoryRouter>);

