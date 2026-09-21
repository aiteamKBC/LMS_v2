import React from 'react';
import { createRoot } from 'react-dom/client';
import '../src/index.css';
import '../src/learner-theme.css';
import { LearnerReviewInstanceForm } from '../src/pages/learner/reviews/LearnerReviewInstanceForm';
import { createTypedSignature } from '../src/lib/typedSignature';
import type { LearnerReviewDefinition } from '../src/api/learnerCalendar';

// Synthetic visual fixture only. No real accounts, API hooks, or signing actions.
const makeDefinition = (signature: string): LearnerReviewDefinition => ({
  instance: {
    id: 'sample-review', reviewTemplateId: 'sample-template', learnerId: 0,
    programmeId: 'sample-programme', occurrenceNumber: 1, targetDate: '2026-09-14',
    status: 'awaiting-signature', startedAt: '2026-09-14T09:00:00Z', completedAt: null,
  },
  template: {
    id: 'sample-template', name: 'Monthly coaching review',
    signatures: { advisor: true, participant: true, employer: false, referrer: false },
    visibleTo: { advisor: true, participant: true, employer: false, referrer: false },
    recurrence: { interval: 1, unit: 'months' }, notifications: {}, allowEditingPriorDays: 0,
  },
  sections: [
    {
      id: 'progress', title: 'Your progress and achievements', displayOrder: 1, estimatedMinutes: 10, enabled: true,
      fields: [{
        id: 'progress-notes', title: 'What went well this month?', fieldType: 'text_multiline', required: true,
        displayOrder: 1, configuration: {},
        answer: 'We reviewed the learning activities completed this month and discussed how they apply at work.\n\nThe learner shared a practical example and agreed to collect further evidence before the next meeting.',
      }, {
        id: 'coach-support', title: 'How will the coach support the next steps?', fieldType: 'text_multiline', required: true,
        displayOrder: 2, configuration: {},
        answer: 'Share the agreed learning resources and review the evidence at the next coaching meeting.',
      }],
    },
    {
      id: 'next-meeting', title: 'Confirm the next meeting', displayOrder: 2, estimatedMinutes: 5, enabled: true,
      fields: [{ id: 'next-date', title: 'Date of the next coaching meeting', fieldType: 'date', required: true,
        displayOrder: 1, configuration: {}, answer: '2026-10-14' }],
    },
  ],
  signatures: {
    advisor: { required: true, signed: false, signature: null },
    participant: { required: true, signed: true, signedBy: 'sample@example.test', signedName: 'Sample Learner',
      signedAt: '2026-09-14T14:30:00Z', signature },
    employer: { required: false, signed: false, signature: null },
    referrer: { required: false, signed: false, signature: null },
  },
});

function Fixture() {
  const [definition, setDefinition] = React.useState<LearnerReviewDefinition | null>(null);
  React.useEffect(() => {
    void createTypedSignature('Sample Learner').then(signature => setDefinition(makeDefinition(signature)));
  }, []);
  return <main style={{ minHeight: '100vh', background: '#f7f9fc', padding: 'clamp(12px, 3vw, 40px)' }}>
    <div style={{ maxWidth: 1120, margin: '0 auto' }}>
      <p style={{ margin: '0 0 20px', color: '#64748b', fontSize: 13 }}>Synthetic review preview — no learner data</p>
      {definition ? <LearnerReviewInstanceForm definition={definition}/> : <p>Loading preview…</p>}
    </div>
  </main>;
}

createRoot(document.getElementById('root')!).render(<Fixture/>);
