import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import { fetchLearnerDetail, type LearnerDetail } from '@/api/learnerDetail';
import { fetchLearnerAttendance, type LearnerAttendance } from '@/api/learnerAttendance';
import { useMyLearner } from '@/hooks/useMyLearner';

const learnerNav = roleNavMap.learner;

const riskConfig: Record<string, { label: string; text: string; badge: string; colour: string; soft: string }> = {
  green: { label: 'Good standing', text: 'Your attendance is currently in a healthy range.', badge: 'bg-emerald-400/15 text-emerald-200 ring-emerald-300/20', colour: '#34d399', soft: 'bg-emerald-50 text-emerald-700' },
  amber: { label: 'Needs attention', text: 'Your attendance needs attention. Review missed sessions with your coach.', badge: 'bg-amber-400/15 text-amber-200 ring-amber-300/20', colour: '#fbbf24', soft: 'bg-amber-50 text-amber-700' },
  red: { label: 'At risk', text: 'Your attendance is at risk. Speak to your coach and address missed sessions.', badge: 'bg-red-400/15 text-red-200 ring-red-300/20', colour: '#fb7185', soft: 'bg-red-50 text-red-700' },
};

function formatDate(value: string | null, includeTime = false) {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('en-GB', includeTime ? { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' } : { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function AttendancePage() {
  const myLearner = useMyLearner();
  const [learner, setLearner] = useState<LearnerDetail | null>(null);
  const [attendance, setAttendance] = useState<LearnerAttendance | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError('');
    Promise.all([fetchLearnerDetail(myLearner.kind, myLearner.id), fetchLearnerAttendance(myLearner.kind, myLearner.id)])
      .then(([detail, record]) => { if (!cancelled) { setLearner(detail); setAttendance(record); } })
      .catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : 'Could not load attendance.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [myLearner.id, myLearner.kind]);

  const risk = riskConfig[attendance?.risk || ''] || riskConfig.amber;
  const presentWidth = attendance?.sessions ? (attendance.present / attendance.sessions) * 100 : 0;
  const absentWidth = attendance?.sessions ? (attendance.absent / attendance.sessions) * 100 : 0;

  return (
    <WorkspaceShell role="learner" roleLabel={learnerNav.label} navItems={learnerNav.items} workspaceLabel={learnerNav.workspaceLabel} pageTitle="Attendance" pageSubtitle="Your live attendance record and current risk status" userName={learner?.name || 'Learner'} userRole={learner?.programme ? `${learner.programme} Apprentice` : 'Apprentice'}>
      <main className="w-full space-y-5 p-4 md:p-6">
        {loading ? <Loading /> : error ? <ErrorState message={error} /> : !attendance ? <EmptyState /> : <>
          <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#17032d] via-[#33105e] to-[#6a2ca0] p-6 text-white shadow-[0_18px_50px_rgba(39,12,73,0.18)] md:p-7">
            <div className="pointer-events-none absolute -right-20 -top-32 h-80 w-80 rounded-full bg-secondary-300/15 blur-3xl"></div>
            <div className="relative grid gap-6 lg:grid-cols-[minmax(0,1fr)_420px] lg:items-center">
              <div><div className="flex flex-wrap items-center gap-2"><span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.15em] text-secondary-100"><i className="ri-calendar-check-line text-secondary-300"></i>Attendance overview</span><span className={`rounded-full px-3 py-1 text-[10px] font-bold capitalize ring-1 ring-inset ${risk.badge}`}>{risk.label}</span></div><h1 className="mt-3 text-2xl font-bold text-white md:text-3xl">{learner?.programme || 'Learning'} attendance</h1><p className="mt-2 max-w-xl text-sm leading-6 text-white/65">{risk.text}</p><div className="mt-5 flex flex-wrap gap-2"><Link to="/learner/report-absence" className="inline-flex h-10 items-center gap-2 rounded-xl bg-white px-4 text-xs font-bold text-primary-800 shadow-md transition hover:bg-primary-50"><i className="ri-calendar-close-line"></i>Report absence</Link><Link to="/learner/profile" className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/15 bg-white/10 px-4 text-xs font-semibold text-white transition hover:bg-white/15"><i className="ri-user-line"></i>View profile</Link></div></div>
              <div className="flex items-center gap-5 rounded-3xl border border-white/10 bg-white/[0.08] p-5 backdrop-blur-sm"><div className="relative flex h-28 w-28 shrink-0 items-center justify-center rounded-full" style={{ background: `conic-gradient(${risk.colour} ${attendance.attendanceRate * 3.6}deg, rgba(255,255,255,.1) 0deg)` }}><div className="flex h-[86px] w-[86px] flex-col items-center justify-center rounded-full bg-[#35105e]"><span className="text-2xl font-bold text-white">{attendance.attendanceRate}%</span><span className="text-[9px] text-white/45">Attendance</span></div></div><div className="min-w-0 flex-1 space-y-3"><HeroStat colour="bg-emerald-400" value={attendance.present} label="Present" /><HeroStat colour="bg-red-400" value={attendance.absent} label="Absent" /><HeroStat colour="bg-amber-400" value={attendance.late} label="Late" /></div></div>
            </div>
          </section>

          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <StatCard icon="ri-calendar-2-line" label="Total sessions" value={attendance.sessions} colour="bg-primary-50 text-primary-600" />
            <StatCard icon="ri-checkbox-circle-line" label="Present" value={attendance.present} colour="bg-emerald-50 text-emerald-600" />
            <StatCard icon="ri-close-circle-line" label="Absent" value={attendance.absent} colour="bg-red-50 text-red-600" />
            <StatCard icon="ri-time-line" label="Late" value={attendance.late} colour="bg-amber-50 text-amber-600" />
            <StatCard icon="ri-loop-left-line" label="Catch-ups" value={attendance.catchup} colour="bg-secondary-50 text-secondary-600" />
            <StatCard icon="ri-error-warning-line" label="Consecutive missed" value={attendance.consecutiveMissed} colour="bg-rose-50 text-rose-600" />
          </section>

          <div className="grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(300px,.6fr)]">
            <section className="rounded-3xl border border-background-200 bg-white p-5 shadow-[0_5px_24px_rgba(28,10,55,0.05)] md:p-6"><div className="flex items-center justify-between"><div><h2 className="text-base font-bold text-foreground-900">Attendance breakdown</h2><p className="mt-1 text-xs text-foreground-400">Present and absent sessions from your current record</p></div><span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${risk.soft}`}>{risk.label}</span></div><div className="mt-7"><div className="flex h-4 overflow-hidden rounded-full bg-background-100"><div className="bg-emerald-500 transition-all" style={{ width: `${presentWidth}%` }}></div><div className="bg-red-400 transition-all" style={{ width: `${absentWidth}%` }}></div></div><div className="mt-3 flex flex-wrap gap-5 text-xs"><span className="flex items-center gap-2 text-foreground-600"><span className="h-2.5 w-2.5 rounded-full bg-emerald-500"></span><strong>{attendance.present}</strong> present</span><span className="flex items-center gap-2 text-foreground-600"><span className="h-2.5 w-2.5 rounded-full bg-red-400"></span><strong>{attendance.absent}</strong> absent</span><span className="flex items-center gap-2 text-foreground-600"><span className="h-2.5 w-2.5 rounded-full bg-amber-400"></span><strong>{attendance.late}</strong> late arrivals</span></div></div><div className="mt-7 grid gap-3 sm:grid-cols-2"><InfoBox icon="ri-calendar-check-line" label="Last session" value={formatDate(attendance.lastSessionDate)} /><InfoBox icon="ri-refresh-line" label="Record updated" value={formatDate(attendance.updatedAt, true)} /></div></section>
            <section className="rounded-3xl border border-background-200 bg-white p-5 shadow-[0_5px_24px_rgba(28,10,55,0.05)] md:p-6"><span className={`flex h-11 w-11 items-center justify-center rounded-2xl ${risk.soft}`}><i className="ri-heart-pulse-line text-lg"></i></span><h2 className="mt-4 text-base font-bold text-foreground-900">Attendance status</h2><p className="mt-2 text-sm leading-6 text-foreground-500">{risk.text}</p><div className="mt-5 rounded-2xl bg-background-100/70 p-4"><p className="text-[9px] font-bold uppercase tracking-wider text-foreground-400">Current risk</p><p className="mt-1 text-lg font-bold capitalize text-foreground-900">{attendance.risk || 'Not set'}</p></div>{attendance.consecutiveMissed > 0 && <p className="mt-4 rounded-xl bg-red-50 p-3 text-xs leading-5 text-red-700"><i className="ri-alert-line mr-1.5"></i>{attendance.consecutiveMissed} consecutive session{attendance.consecutiveMissed === 1 ? '' : 's'} missed.</p>}</section>
          </div>
        </>}
      </main>
    </WorkspaceShell>
  );
}

function HeroStat({ colour, value, label }: { colour: string; value: number; label: string }) { return <div className="flex items-center gap-2 text-xs text-white/55"><span className={`h-2 w-2 rounded-full ${colour}`}></span><strong className="text-white">{value}</strong>{label}</div>; }
function StatCard({ icon, label, value, colour }: { icon: string; label: string; value: number; colour: string }) { return <article className="rounded-2xl border border-background-200 bg-white p-4 shadow-sm"><span className={`flex h-9 w-9 items-center justify-center rounded-xl ${colour}`}><i className={icon}></i></span><p className="mt-3 text-2xl font-bold text-foreground-900">{value}</p><p className="mt-1 text-[10px] text-foreground-400">{label}</p></article>; }
function InfoBox({ icon, label, value }: { icon: string; label: string; value: string }) { return <div className="flex items-center gap-3 rounded-2xl border border-background-200 p-4"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-50 text-primary-600"><i className={icon}></i></span><div><p className="text-[9px] uppercase tracking-wider text-foreground-400">{label}</p><p className="mt-1 text-xs font-semibold text-foreground-700">{value}</p></div></div>; }
function Loading() { return <div className="rounded-3xl border border-background-200 bg-white p-16 text-center text-sm text-foreground-400"><i className="ri-loader-4-line mr-2 animate-spin text-primary-600"></i>Loading attendance from the database…</div>; }
function ErrorState({ message }: { message: string }) { return <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700"><i className="ri-error-warning-line mr-2"></i>{message}</div>; }
function EmptyState() { return <div className="rounded-3xl border border-dashed border-foreground-300 bg-white px-6 py-16 text-center"><span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary-50 text-primary-500"><i className="ri-calendar-check-line text-xl"></i></span><h2 className="mt-3 text-sm font-bold text-foreground-800">No attendance record yet</h2><p className="mt-1 text-xs text-foreground-400">Attendance will appear here when a record is added for this learner.</p></div>; }
