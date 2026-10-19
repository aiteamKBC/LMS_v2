import type { CoachReviewGenerationIssue } from './calendarEvents';

export function ReviewIdentityNotice({ issues }: { issues: CoachReviewGenerationIssue[] }) {
  const count = new Set(issues.filter(issue => issue.code === 'review_identity_unavailable').map(issue => issue.learnerId)).size;
  if (!count) return null;
  return (
    <div role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-900">
      <p className="font-semibold">Some reviews are unavailable</p>
      <p>
        {count === 1 ? '1 learner needs' : `${count} learners need`} an enrolment record check before their reviews can be loaded.
        {' '}Other available meetings are shown. Ask an administrator to check the affected learner records.
      </p>
    </div>
  );
}
