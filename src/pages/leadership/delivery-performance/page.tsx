import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { WorkspaceHeroBanner } from '@/components/feature/WorkspaceHeroBanner';
import { roleNavMap } from '@/mocks/navigation';

const leadershipNav = roleNavMap.leadership;

const DELIVERY_COHORTS = [
  { cohort: 'ME-L4 May 2026', programme: 'Management L4', sessionsDelivered: 28, sessionsPlanned: 36, modulesComplete: 4, modulesTotal: 12, tutors: 'Helen Curtis', timetableIssues: 1, status: 'on-track' as const, startDate: 'May 2026', health: 78 },
  { cohort: 'BA-L3 June 2026', programme: 'Business Admin L3', sessionsDelivered: 6, sessionsPlanned: 48, modulesComplete: 1, modulesTotal: 14, tutors: 'Crispin Jones', timetableIssues: 0, status: 'on-track' as const, startDate: 'Jun 2026', health: 85 },
  { cohort: 'DA-L4 April 2026', programme: 'Data Analyst L4', sessionsDelivered: 0, sessionsPlanned: 32, modulesComplete: 0, modulesTotal: 10, tutors: 'Rachel Oduya', timetableIssues: 3, status: 'blocked' as const, startDate: 'Apr 2026', health: 0 },
  { cohort: 'OM-L5 Jan 2025', programme: 'Ops Manager L5', sessionsDelivered: 52, sessionsPlanned: 54, modulesComplete: 11, modulesTotal: 12, tutors: 'Crispin Jones', timetableIssues: 0, status: 'on-track' as const, startDate: 'Jan 2025', health: 96 },
  { cohort: 'HR-L5 March 2025', programme: 'HR Consultant L5', sessionsDelivered: 44, sessionsPlanned: 48, modulesComplete: 9, modulesTotal: 12, tutors: 'Crispin Jones', timetableIssues: 1, status: 'on-track' as const, startDate: 'Mar 2025', health: 92 },
  { cohort: 'PM-L4 Feb 2026', programme: 'Project Manager L4', sessionsDelivered: 8, sessionsPlanned: 28, modulesComplete: 1, modulesTotal: 10, tutors: 'Crispin Jones', timetableIssues: 2, status: 'at-risk' as const, startDate: 'Feb 2026', health: 29 },
  { cohort: 'SD-L4 Sep 2024', programme: 'Software Dev L4', sessionsDelivered: 60, sessionsPlanned: 60, modulesComplete: 12, modulesTotal: 12, tutors: 'Rachel Oduya', timetableIssues: 0, status: 'completed' as const, startDate: 'Sep 2024', health: 100 },
];

const TUTOR_ALLOCATION = [
  { tutor: 'Helen Curtis', cohorts: 1, learners: 8, sessionsWeek: 3, modulesAssigned: 12, deliveryRating: 4.8 },
  { tutor: 'Crispin Jones', cohorts: 3, learners: 14, sessionsWeek: 8, modulesAssigned: 36, deliveryRating: 4.7 },
  { tutor: 'Rachel Oduya', cohorts: 2, learners: 11, sessionsWeek: 6, modulesAssigned: 22, deliveryRating: 4.5 },
];

export default function DeliveryPerformancePage() {
  const totalSessions = DELIVERY_COHORTS.reduce((s, c) => s + c.sessionsDelivered, 0);
  const plannedSessions = DELIVERY_COHORTS.reduce((s, c) => s + c.sessionsPlanned, 0);
  const avgHealth = Math.round(DELIVERY_COHORTS.filter(c => c.health > 0).reduce((s, c) => s + c.health, 0) / DELIVERY_COHORTS.filter(c => c.health > 0).length);
  const blocked = DELIVERY_COHORTS.filter(c => c.status === 'blocked' || c.status === 'at-risk').length;

  return (
    <WorkspaceShell role="leadership" roleLabel={leadershipNav.label} navItems={leadershipNav.items} workspaceLabel={leadershipNav.workspaceLabel} pageTitle="Delivery Performance" pageSubtitle="Session delivery, tutor allocation, module delivery status, timetable issues and cohort delivery health" userName="Dr. Helen Park" userRole="Director of Apprenticeships">
      <div className="p-6 space-y-5">
        <WorkspaceHeroBanner title="Delivery Performance" description={`${totalSessions}/${plannedSessions} sessions delivered · Avg health ${avgHealth}% · ${blocked} cohorts need attention`} icon="ri-presentation-line" stats={[{ label: 'Sessions Delivered', value: `${totalSessions}/${plannedSessions}` }, { label: 'Avg Health', value: `${avgHealth}%` }, { label: 'Blocked/At-Risk', value: String(blocked) }]} />

        {/* Cohort Delivery Cards */}
        <div className="space-y-3">
          {DELIVERY_COHORTS.map(c => (
            <div key={c.cohort} className={`bg-background-50 rounded-xl border p-5 ${c.status === 'blocked' ? 'border-red-200/60 bg-red-50/20' : c.status === 'at-risk' ? 'border-amber-200/60 bg-amber-50/20' : c.status === 'completed' ? 'border-emerald-200/60' : 'border-foreground-200'}`}>
              <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="text-[13px] font-heading font-semibold text-foreground-900">{c.cohort}</h3>
                    <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold ${c.status === 'blocked' ? 'bg-red-100 text-red-700' : c.status === 'at-risk' ? 'bg-amber-100 text-amber-700' : c.status === 'completed' ? 'bg-emerald-100 text-emerald-700' : 'bg-primary-100 text-primary-700'}`}>{c.status.replace('-', ' ').toUpperCase()}</span>
                  </div>
                  <p className="text-[10px] text-foreground-400">{c.programme} · Started {c.startDate} · Tutor: {c.tutors}</p>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {[
                    { l: 'Sessions', v: `${c.sessionsDelivered}/${c.sessionsPlanned}` },
                    { l: 'Modules', v: `${c.modulesComplete}/${c.modulesTotal}` },
                    { l: 'Timetable Issues', v: String(c.timetableIssues), warn: c.timetableIssues > 0 },
                    { l: 'Health', v: `${c.health}%` },
                  ].map(m => (
                    <div key={m.l} className={`rounded-lg p-2 text-center ${m.warn ? 'bg-red-100/60' : 'bg-background-100/60'}`}>
                      <p className={`text-[12px] font-bold ${m.warn ? 'text-red-700' : 'text-foreground-900'}`}>{m.v}</p>
                      <p className="text-[8px] text-foreground-400">{m.l}</p>
                    </div>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 mt-3">
                <div>
                  <div className="flex justify-between text-[9px] text-foreground-500 mb-1"><span>Session Delivery</span><span>{c.sessionsPlanned > 0 ? Math.round((c.sessionsDelivered / c.sessionsPlanned) * 100) : 0}%</span></div>
                  <div className="w-full bg-background-200 rounded-full h-1.5">
                    <div className={`h-1.5 rounded-full ${c.sessionsPlanned > 0 && c.sessionsDelivered / c.sessionsPlanned >= 0.85 ? 'bg-emerald-500' : c.sessionsPlanned > 0 && c.sessionsDelivered / c.sessionsPlanned >= 0.5 ? 'bg-amber-500' : c.sessionsPlanned > 0 ? 'bg-red-500' : 'bg-background-300'}`} style={{ width: `${c.sessionsPlanned > 0 ? (c.sessionsDelivered / c.sessionsPlanned) * 100 : 0}%` }}></div>
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-[9px] text-foreground-500 mb-1"><span>Module Completion</span><span>{c.modulesTotal > 0 ? Math.round((c.modulesComplete / c.modulesTotal) * 100) : 0}%</span></div>
                  <div className="w-full bg-background-200 rounded-full h-1.5">
                    <div className={`h-1.5 rounded-full ${c.modulesTotal > 0 && c.modulesComplete / c.modulesTotal >= 0.7 ? 'bg-emerald-500' : c.modulesTotal > 0 && c.modulesComplete / c.modulesTotal >= 0.3 ? 'bg-amber-500' : c.modulesTotal > 0 ? 'bg-red-500' : 'bg-background-300'}`} style={{ width: `${c.modulesTotal > 0 ? (c.modulesComplete / c.modulesTotal) * 100 : 0}%` }}></div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Tutor Allocation Summary */}
        <div className="bg-background-50 rounded-xl border border-background-200/50 overflow-hidden">
          <h3 className="text-sm font-heading font-semibold text-foreground-900 p-5 pb-3">Tutor Allocation & Delivery</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="bg-background-100/50 border-y border-background-200/30 text-[10px] font-semibold text-foreground-400 uppercase tracking-wider">
                  <th className="text-left py-2.5 px-4">Tutor</th>
                  <th className="text-center py-2.5">Cohorts</th>
                  <th className="text-center py-2.5">Learners</th>
                  <th className="text-center py-2.5">Sessions/wk</th>
                  <th className="text-center py-2.5">Modules</th>
                  <th className="text-center py-2.5">Rating</th>
                </tr>
              </thead>
              <tbody>
                {TUTOR_ALLOCATION.map(t => (
                  <tr key={t.tutor} className="border-b border-foreground-200/60 hover:bg-background-100/30 transition-smooth">
                    <td className="py-2.5 px-4 font-medium text-foreground-700">{t.tutor}</td>
                    <td className="text-center text-foreground-600">{t.cohorts}</td>
                    <td className="text-center text-foreground-600">{t.learners}</td>
                    <td className="text-center text-foreground-600">{t.sessionsWeek}</td>
                    <td className="text-center text-foreground-600">{t.modulesAssigned}</td>
                    <td className="text-center"><span className={`font-semibold ${t.deliveryRating >= 4.7 ? 'text-emerald-600' : t.deliveryRating >= 4.5 ? 'text-amber-600' : 'text-red-600'}`}>{t.deliveryRating}/5</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </WorkspaceShell>
  );
}