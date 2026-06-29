import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { WorkspaceHeroBanner } from '@/components/feature/WorkspaceHeroBanner';
import { roleNavMap } from '@/mocks/navigation';

const leadershipNav = roleNavMap.leadership;

const COACHES_DETAIL = [
  { name: 'Martin Reeves', caseload: 5, maxCaseload: 6, sessionsWeek: 8, markingBacklog: 6, atRiskLearners: 3, utilisation: 88, meetingsOverdue: 2, reviewsDue: 4, actionPlanFollowUps: 3, email: 'martin.reeves@kbc.ac.uk', cohorts: 'ME-L4 / BA-L3 / PM-L4' },
  { name: 'Sarah Collins', caseload: 3, maxCaseload: 5, sessionsWeek: 5, markingBacklog: 2, atRiskLearners: 0, utilisation: 62, meetingsOverdue: 0, reviewsDue: 1, actionPlanFollowUps: 1, email: 'sarah.collins@kbc.ac.uk', cohorts: 'OM-L5 / SD-L4' },
  { name: 'Daniel Foster', caseload: 2, maxCaseload: 5, sessionsWeek: 4, markingBacklog: 3, atRiskLearners: 0, utilisation: 55, meetingsOverdue: 0, reviewsDue: 1, actionPlanFollowUps: 0, email: 'daniel.foster@kbc.ac.uk', cohorts: 'HR-L5' },
];

const WORKLOAD_TRENDS = [
  { week: 'Wk 1', totalSessions: 17, totalMarking: 15, totalMeetings: 8, totalReviews: 6 },
  { week: 'Wk 2', totalSessions: 18, totalMarking: 12, totalMeetings: 6, totalReviews: 5 },
  { week: 'Wk 3', totalSessions: 16, totalMarking: 18, totalMeetings: 9, totalReviews: 7 },
  { week: 'Wk 4', totalSessions: 15, totalMarking: 11, totalMeetings: 5, totalReviews: 4 },
  { week: 'Wk 5', totalSessions: 19, totalMarking: 14, totalMeetings: 7, totalReviews: 8 },
  { week: 'Wk 6', totalSessions: 17, totalMarking: 16, totalMeetings: 10, totalReviews: 6 },
];

export default function CoachWorkloadPage() {
  const totalLearners = COACHES_DETAIL.reduce((s, c) => s + c.caseload, 0);
  const totalAtRisk = COACHES_DETAIL.reduce((s, c) => s + c.atRiskLearners, 0);
  const avgUtilisation = Math.round(COACHES_DETAIL.reduce((s, c) => s + c.utilisation, 0) / COACHES_DETAIL.length);

  return (
    <WorkspaceShell role="leadership" roleLabel={leadershipNav.label} navItems={leadershipNav.items} workspaceLabel={leadershipNav.workspaceLabel} pageTitle="Coach Workload" pageSubtitle="Caseload size, coaching meetings due, progress reviews due, learner risk load and action plan follow-up" userName="Dr. Helen Park" userRole="Director of Apprenticeships">
      <div className="p-6 space-y-5">
        <WorkspaceHeroBanner title="Coach Workload Analysis" description={`${COACHES_DETAIL.length} coaches · ${totalLearners} learners · Avg ${avgUtilisation}% utilisation · ${totalAtRisk} at-risk`} icon="ri-heart-line" stats={[{ label: 'Coaches', value: String(COACHES_DETAIL.length) }, { label: 'Total Learners', value: String(totalLearners) }, { label: 'Avg Utilisation', value: `${avgUtilisation}%` }]} />

        {/* Coach Cards */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {COACHES_DETAIL.map(c => (
            <div key={c.name} className={`bg-background-50 rounded-xl border p-5 ${c.atRiskLearners > 0 ? 'border-red-200/60' : 'border-foreground-200'}`}>
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="text-[13px] font-heading font-semibold text-foreground-900">{c.name}</h3>
                  <p className="text-[9px] text-foreground-400">{c.email}</p>
                </div>
                <span className={`px-2.5 py-1 rounded-full text-[9px] font-bold ${c.utilisation >= 90 ? 'bg-red-100 text-red-700' : c.utilisation >= 80 ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>{c.utilisation}%</span>
              </div>
              <div className="grid grid-cols-2 gap-2 mb-3">
                {[
                  { l: 'Caseload', v: `${c.caseload}/${c.maxCaseload}` },
                  { l: 'Sessions/wk', v: String(c.sessionsWeek) },
                  { l: 'Marking Queue', v: String(c.markingBacklog) },
                  { l: 'At-Risk', v: String(c.atRiskLearners), warn: c.atRiskLearners > 0 },
                  { l: 'Meetings Overdue', v: String(c.meetingsOverdue), warn: c.meetingsOverdue > 0 },
                  { l: 'Reviews Due', v: String(c.reviewsDue) },
                  { l: 'Action Plans', v: String(c.actionPlanFollowUps) },
                  { l: 'Cohorts', v: c.cohorts },
                ].map(m => (
                  <div key={m.l} className={`rounded-lg p-2 text-center ${m.warn ? 'bg-red-100/60' : 'bg-background-100/60'}`}>
                    <p className={`text-[12px] font-bold ${m.warn ? 'text-red-700' : 'text-foreground-900'} truncate`}>{m.v}</p>
                    <p className="text-[7px] text-foreground-400">{m.l}</p>
                  </div>
                ))}
              </div>
              <div className="w-full bg-background-200 rounded-full h-2.5">
                <div className={`h-2.5 rounded-full ${c.utilisation >= 90 ? 'bg-red-500' : c.utilisation >= 80 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${c.utilisation}%` }}></div>
              </div>
            </div>
          ))}
        </div>

        {/* Weekly Workload Trends */}
        <div className="bg-background-50 rounded-xl border border-background-200/50 overflow-hidden">
          <h3 className="text-sm font-heading font-semibold text-foreground-900 p-5 pb-3">Weekly Workload Trends (All Coaches)</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="bg-background-100/50 border-y border-background-200/30 text-[10px] font-semibold text-foreground-400 uppercase tracking-wider">
                  <th className="text-left py-2.5 px-4">Week</th>
                  <th className="text-center py-2.5">Sessions</th>
                  <th className="text-center py-2.5">Marking</th>
                  <th className="text-center py-2.5">Meetings</th>
                  <th className="text-center py-2.5">Reviews</th>
                  <th className="text-center py-2.5">Total</th>
                </tr>
              </thead>
              <tbody>
                {WORKLOAD_TRENDS.map(w => {
                  const total = w.totalSessions + w.totalMarking + w.totalMeetings + w.totalReviews;
                  return (
                    <tr key={w.week} className="border-b border-foreground-200/60 hover:bg-background-100/30 transition-smooth">
                      <td className="py-2.5 px-4 font-medium text-foreground-700">{w.week}</td>
                      <td className="text-center text-foreground-600">{w.totalSessions}</td>
                      <td className="text-center text-foreground-600">{w.totalMarking}</td>
                      <td className="text-center text-foreground-600">{w.totalMeetings}</td>
                      <td className="text-center text-foreground-600">{w.totalReviews}</td>
                      <td className="text-center"><span className={`font-semibold ${total >= 40 ? 'text-red-600' : total >= 35 ? 'text-amber-600' : 'text-emerald-600'}`}>{total}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </WorkspaceShell>
  );
}