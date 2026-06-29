import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { WorkspaceHeroBanner } from '@/components/feature/WorkspaceHeroBanner';
import { roleNavMap } from '@/mocks/navigation';

const leadershipNav = roleNavMap.leadership;

const ATTENDANCE_MONTHLY = [
  { month: 'Jan', overall: 88, catchupComplete: 82, unrecoveredAbsences: 4, selfPaced: 76 },
  { month: 'Feb', overall: 90, catchupComplete: 85, unrecoveredAbsences: 3, selfPaced: 80 },
  { month: 'Mar', overall: 87, catchupComplete: 79, unrecoveredAbsences: 5, selfPaced: 74 },
  { month: 'Apr', overall: 91, catchupComplete: 88, unrecoveredAbsences: 3, selfPaced: 82 },
  { month: 'May', overall: 89, catchupComplete: 84, unrecoveredAbsences: 4, selfPaced: 78 },
  { month: 'Jun', overall: 93, catchupComplete: 91, unrecoveredAbsences: 2, selfPaced: 86 },
];

const COHORT_ATTENDANCE = [
  { cohort: 'SD-L4 Sep 2024', overall: 98, liveSessions: 97, selfPaced: 99, catchupComplete: 100, absences: 1, mode: 'Mixed' },
  { cohort: 'OM-L5 Jan 2025', overall: 97, liveSessions: 96, selfPaced: 98, catchupComplete: 95, absences: 1, mode: 'Mixed' },
  { cohort: 'BA-L3 June 2026', overall: 96, liveSessions: 98, selfPaced: 92, catchupComplete: 100, absences: 1, mode: 'Self-Paced' },
  { cohort: 'HR-L5 March 2025', overall: 93, liveSessions: 94, selfPaced: 91, catchupComplete: 88, absences: 2, mode: 'Live' },
  { cohort: 'ME-L4 May 2026', overall: 90, liveSessions: 91, selfPaced: 88, catchupComplete: 82, absences: 3, mode: 'Live' },
  { cohort: 'PM-L4 Feb 2026', overall: 71, liveSessions: 68, selfPaced: 76, catchupComplete: 55, absences: 5, mode: 'Mixed' },
  { cohort: 'DA-L4 April 2026', overall: 0, liveSessions: 0, selfPaced: 0, catchupComplete: 0, absences: 5, mode: 'Not Started' },
];

export default function AttendanceTrendsPage() {
  const avgAtt = Math.round(COHORT_ATTENDANCE.filter(c => c.overall > 0).reduce((s, c) => s + c.overall, 0) / COHORT_ATTENDANCE.filter(c => c.overall > 0).length);

  return (
    <WorkspaceShell role="leadership" roleLabel={leadershipNav.label} navItems={leadershipNav.items} workspaceLabel={leadershipNav.workspaceLabel} pageTitle="Attendance Trends" pageSubtitle="Live attendance, catch-up completion, unrecovered absences, attendance mode performance and self-paced completion" userName="Dr. Helen Park" userRole="Director of Apprenticeships">
      <div className="p-6 space-y-5">
        <WorkspaceHeroBanner title="Attendance Trends" description={`${COHORT_ATTENDANCE.length} cohorts · Avg attendance ${avgAtt}% · Real-time attendance intelligence`} icon="ri-calendar-check-line" stats={[{ label: 'Avg Attendance', value: `${avgAtt}%` }, { label: 'Cohorts Below 85%', value: '2' }, { label: 'Unrecovered Absences', value: '21' }]} />

        {/* Monthly Attendance Chart */}
        <div className="bg-background-50 rounded-xl border border-background-200/50 p-5">
          <h3 className="text-sm font-heading font-semibold text-foreground-900 mb-4">Monthly Attendance & Catch-up Trends</h3>
          <div className="relative h-52">
            <div className="absolute inset-0 flex items-end justify-between px-1">
              {ATTENDANCE_MONTHLY.map(m => (
                <div key={m.month} className="flex-1 flex flex-col items-center gap-0.5 group">
                  <div className="flex gap-[2px] items-end">
                    <div className="w-[8px] bg-emerald-500/70 rounded-t-sm" style={{ height: `${m.overall * 1.5}px` }}></div>
                    <div className="w-[8px] bg-primary-500/70 rounded-t-sm" style={{ height: `${m.catchupComplete * 1.5}px` }}></div>
                    <div className="w-[8px] bg-red-300/70 rounded-t-sm" style={{ height: `${m.unrecoveredAbsences * 8}px` }}></div>
                  </div>
                  <span className="text-[7px] text-foreground-400 mt-1">{m.month}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-center gap-5 mt-3 text-[10px]">
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-500/70"></span> Overall</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-primary-500/70"></span> Catch-up</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-red-300/70"></span> Unrecovered</span>
          </div>
        </div>

        {/* Cohort Attendance Table */}
        <div className="bg-background-50 rounded-xl border border-background-200/50 overflow-hidden">
          <h3 className="text-sm font-heading font-semibold text-foreground-900 p-5 pb-3">Attendance by Cohort</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="bg-background-100/50 border-y border-background-200/30 text-[10px] font-semibold text-foreground-400 uppercase tracking-wider">
                  <th className="text-left py-2.5 px-4">Cohort</th>
                  <th className="text-center py-2.5">Overall</th>
                  <th className="text-center py-2.5">Live Sessions</th>
                  <th className="text-center py-2.5">Self-Paced</th>
                  <th className="text-center py-2.5">Catch-up</th>
                  <th className="text-center py-2.5">Absences</th>
                  <th className="text-center py-2.5">Mode</th>
                  <th className="text-center py-2.5">Health</th>
                </tr>
              </thead>
              <tbody>
                {COHORT_ATTENDANCE.map(c => (
                  <tr key={c.cohort} className="border-b border-foreground-200/60 hover:bg-background-100/30 transition-smooth">
                    <td className="py-2.5 px-4 font-medium text-foreground-700">{c.cohort}</td>
                    <td className={`text-center font-semibold ${c.overall >= 90 ? 'text-emerald-600' : c.overall >= 80 ? 'text-amber-600' : c.overall > 0 ? 'text-red-600' : 'text-foreground-300'}`}>{c.overall > 0 ? `${c.overall}%` : '—'}</td>
                    <td className="text-center text-foreground-600">{c.liveSessions > 0 ? `${c.liveSessions}%` : '—'}</td>
                    <td className="text-center text-foreground-600">{c.selfPaced > 0 ? `${c.selfPaced}%` : '—'}</td>
                    <td className={`text-center font-medium ${c.catchupComplete >= 90 ? 'text-emerald-600' : c.catchupComplete >= 70 ? 'text-amber-600' : c.catchupComplete > 0 ? 'text-red-600' : 'text-foreground-300'}`}>{c.catchupComplete > 0 ? `${c.catchupComplete}%` : '—'}</td>
                    <td className={`text-center font-semibold ${c.absences <= 2 ? 'text-emerald-600' : c.absences <= 4 ? 'text-amber-600' : 'text-red-600'}`}>{c.absences}</td>
                    <td className="text-center"><span className="text-[10px] bg-background-100 px-2 py-0.5 rounded text-foreground-500">{c.mode}</span></td>
                    <td className="text-center"><div className="w-8 h-8 mx-auto rounded-full flex items-center justify-center text-[9px] font-bold" style={{ background: `conic-gradient(${c.overall >= 90 ? '#10b981' : c.overall >= 80 ? '#f59e0b' : c.overall > 0 ? '#ef4444' : '#d1d5db'} ${(c.overall || 0) * 3.6}deg, #e5e7eb ${(c.overall || 0) * 3.6}deg)` }}><span className="bg-background-50 w-6 h-6 rounded-full flex items-center justify-center text-[9px]">{c.overall || '—'}</span></div></td>
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