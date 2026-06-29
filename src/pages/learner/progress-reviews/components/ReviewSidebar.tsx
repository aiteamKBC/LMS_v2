import { PROGRESS_REVIEWS_DATA } from '@/mocks/progress-reviews';

export default function ReviewSidebar() {
  const d = PROGRESS_REVIEWS_DATA;

  return (
    <div className="space-y-6">
      {/* ── SECTION 7: SMART SUMMARY ── */}
      <section className="bg-background-50 rounded-xl border border-background-200/70 p-5">
        <h3 className="text-sm font-heading font-semibold text-foreground-900 mb-4">SMART Review Summary</h3>
        <div className="space-y-3">
          {[
            { label: 'Learning Completed', value: `${d.smartSummary.learningCompleted} items` },
            { label: 'Assignments Submitted', value: String(d.smartSummary.assignmentsSubmitted) },
            { label: 'Evidence Uploaded', value: `${d.smartSummary.evidenceUploaded} items` },
            { label: 'OTJH Progress', value: `${d.smartSummary.otjhProgress} / ${d.smartSummary.otjhTarget} hrs` },
            { label: 'KSB Progress', value: `${d.smartSummary.ksbProgress}%` },
            { label: 'Attendance', value: `${d.smartSummary.attendance}%` },
            { label: 'Quiz Results', value: `${d.smartSummary.quizResults}% avg` },
            { label: 'Coaching Activity', value: `${d.smartSummary.coachingActivity} sessions` },
          ].map((item) => (
            <div key={item.label} className="flex items-center justify-between text-sm">
              <span className="text-foreground-600">{item.label}</span>
              <span className="font-semibold text-foreground-900">{item.value}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ── SECTION 9: EMPLOYER READINESS ── */}
      <section className="bg-background-50 rounded-xl border border-background-200/70 p-5">
        <h3 className="text-sm font-heading font-semibold text-foreground-900 mb-3">Employer Readiness</h3>
        <div className="space-y-2">
          {[
            { label: 'Employer Invitation Sent', done: d.employerReadiness.invitationSent },
            { label: 'Employer Attendance Confirmed', done: d.employerReadiness.attendanceConfirmed },
            { label: 'Employer Feedback Submitted', done: d.employerReadiness.feedbackSubmitted },
            { label: 'Workplace Comments Provided', done: d.employerReadiness.workplaceComments },
          ].map((item) => (
            <div key={item.label} className="flex items-center justify-between text-sm">
              <span className="text-foreground-600">{item.label}</span>
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${item.done ? 'bg-emerald-100 text-emerald-700' : 'bg-foreground-100 text-foreground-500'}`}>
                {item.done ? 'Complete' : 'Pending'}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* ── SECTION 10: EMPLOYER CONTRIBUTION ── */}
      <section className="bg-background-50 rounded-xl border border-background-200/70 p-5">
        <h3 className="text-sm font-heading font-semibold text-foreground-900 mb-3">Employer Contribution</h3>
        <div className="space-y-3">
          {[
            { label: 'Workplace Application', value: d.employerContribution.workplaceApplication },
            { label: 'Performance', value: d.employerContribution.performance },
            { label: 'Support Needed', value: d.employerContribution.supportNeeded },
            { label: 'Manager Comments', value: d.employerContribution.managerComments },
            { label: 'Employer Feedback', value: d.employerContribution.employerFeedback },
          ].map((item) => (
            <div key={item.label}>
              <p className="text-xs font-semibold text-foreground-500 uppercase tracking-wider mb-1">{item.label}</p>
              <p className="text-sm text-foreground-700 leading-relaxed">{item.value}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}