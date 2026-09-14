import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import '../src/index.css';
import '../src/learner-theme.css';
import { MonthlySubmissionOverview } from '../src/pages/learner/monthly-submission/MonthlySubmissionOverview';
import { groupMonthlyAssignments } from '../src/pages/learner/monthly-submission/model';
import styles from '../src/pages/learner/monthly-submission/monthlySubmission.module.css';
import type { LearnerComponentEntry, LearnerDetail } from '../src/api/learnerDetail';
import { AssignmentSubmissionWizard } from '../src/pages/learner/video-watch/AssignmentSubmissionWizard';

// Synthetic visual fixture only: no real accounts, API hooks or saved submissions.
const assignment = (id: string, title: string, date: string, week: string): LearnerComponentEntry => ({
  componentId: id, component: title, type: 'assignment', moduleId: 'sample-marketing',
  module: 'Marketing foundations', week, expectedOtjh: 2, sessionDate: date,
  assignmentBrief: `For ${title.toLowerCase()}, describe a practical example from your workplace. Explain what you did, what you learned and how you will use it in your next task.`,
});
const real = {
  id: 'sample-learner', name: 'Sample Learner',
  components: [
    assignment('sample-august', 'Understand your customers', '2026-08-20', 'Customer research'),
    assignment('sample-draft', 'Your workplace marketing review', '2026-09-04', 'Week 4'),
    assignment('sample-todo', 'Plan your next campaign', '2026-09-18', 'Week 5'),
    assignment('sample-review', 'Measure your campaign results', '2026-09-21', 'Week 6'),
    assignment('sample-accepted', 'Explore your marketing tools', '2026-09-28', 'Week 7'),
    assignment('sample-october', 'Build a content plan', '2026-10-09', 'Content planning'),
  ],
  componentProgress: [], videoProgress: [], quizAttempts: [],
  componentMarkingStatus: {
    'sample-august': { status: 'returned', feedback: 'Add an example showing how your research changed the plan.', reviewedBy: 'Sample Coach', reviewedAt: '2026-09-02T10:00:00Z' },
    'sample-accepted': { status: 'accepted', feedback: 'You explained the tools clearly and used a relevant example.', reviewedBy: 'Sample Coach', reviewedAt: '2026-09-14T10:00:00Z' },
  },
} as unknown as LearnerDetail;
const groups = groupMonthlyAssignments(real, null, null, {
  'sample-august': 'returned', 'sample-draft': 'draft', 'sample-todo': 'todo',
  'sample-review': 'submitted_for_tutor_review', 'sample-accepted': 'accepted', 'sample-october': 'todo',
});
const scenario = new URLSearchParams(window.location.search).get('scenario');
const fixtureGroups = scenario === 'empty-current' ? groups.filter(group => group.month !== '2026-09') : groups;

createRoot(document.getElementById('root')!).render(
  <MemoryRouter initialEntries={['/learner/monthly-submission']}>
    <main className={styles.page}>
      {scenario?.startsWith('wizard') ? <AssignmentSubmissionWizard
        kind="commercial" learnerId="sample-learner" learnerName="Sample Learner" programmeName="Sample marketing programme"
        componentId={scenario === 'wizard-draft' ? 'sample-wizard-restored' : 'sample-wizard'} title="Your workplace marketing review" moduleTitle="Marketing foundations" weekTitle="Week 4"
        plannedOtjh={2} initialMonth="2026-09" questionText="Describe how you used a marketing tool at work. Explain your choices, what you learned and what you will do next."
        ksbMappings={[]} evidenceFiles={[]} evidenceDetails={{}} timeSeconds={3600}
        timeControl={<p>Recorded learning time: 1 hour</p>}
        outsideWorkingHours={false} outsideWorkingHoursConfirmed={false} submittingProgress={false}
        onEvidenceChanged={() => undefined} onRestoreTime={() => undefined}
        onSubmitProgress={async () => { throw new Error('The synthetic fixture cannot submit real progress.'); }}
      /> : <MonthlySubmissionOverview groups={fixtureGroups} kind="commercial" learnerId="sample-learner" currentMonth="2026-09" />}
    </main>
  </MemoryRouter>,
);
