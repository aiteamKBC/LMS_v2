import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';

const coachNav = roleNavMap.coach;
const ATTENDANCE_ENDPOINT = '/coach_api/coach/attendance';
const DETAILS_ENDPOINT = '/coach_api/coach/attendance/details';

interface AttendanceLearner {
  id: string;
  learner: string;
  initials: string;
  email?: string | null;
  programme: string;
  cohort: string;
  group: string;
  employer: string;
  programStatus?: string;
  attendance: number | null;
  sessions: number | null;
  present: number | null;
  absent: number | null;
  late: number | null;
  catchup: number | null;
  authorisedAbsent?: number | null;
  unauthorisedAbsent?: number | null;
  consecutiveMissed: number | null;
  risk: 'red' | 'amber' | 'green' | null;
}

interface AttendanceSession {
  sessionId: string;
  sessionTitle: string;
  sessionType: string;
  sessionDate: string | null;
  sessionDateLabel: string;
  startTime: string;
  endTime: string;
  status: string;
  reason: string;
  catchupCompleted?: boolean;
}

function formatPercent(value?: number | null) {
  return value === null || value === undefined ? '--' : `${value}%`;
}

function display(value?: string | null) {
  return value?.trim() || '--';
}

function statusClasses(status: string) {
  if (status === 'present') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (status === 'absent') return 'border-red-200 bg-red-50 text-red-700';
  return 'border-foreground-200 bg-background-100 text-foreground-600';
}

function riskLabel(risk: AttendanceLearner['risk']) {
  if (risk === 'green') return 'On Track';
  if (risk === 'amber') return 'Needs Attention';
  if (risk === 'red') return 'At Risk';
  return 'No Data';
}

export default function CoachAttendanceProfile() {
  const navigate = useNavigate();
  const { learnerId = '' } = useParams();
  const [learner, setLearner] = useState<AttendanceLearner | null>(null);
  const [sessions, setSessions] = useState<AttendanceSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const attendanceResponse = await fetch(ATTENDANCE_ENDPOINT);
        if (!attendanceResponse.ok) throw new Error('Unable to load learner attendance.');
        const attendancePayload = await attendanceResponse.json();
        const selected = (attendancePayload.learners || []).find((item: AttendanceLearner) => String(item.id) === String(learnerId));
        if (!selected) throw new Error('Learner attendance record was not found.');

        const params = new URLSearchParams({ learner_id: String(selected.id) });
        if (selected.email) params.set('learner_email', selected.email);
        const detailsResponse = await fetch(`${DETAILS_ENDPOINT}?${params.toString()}`);
        if (!detailsResponse.ok) throw new Error('Unable to load attendance sessions.');
        const detailsPayload = await detailsResponse.json();
        if (!cancelled) {
          setLearner(selected);
          setSessions(detailsPayload.sessions || []);
        }
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Unable to load attendance profile.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [learnerId]);

  const monthlyTrend = useMemo(() => {
    const groups = new Map<string, { label: string; present: number; total: number }>();
    sessions.forEach((session) => {
      if (!session.sessionDate || !['present', 'absent'].includes(session.status)) return;
      const date = new Date(`${session.sessionDate}T00:00:00`);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      const item = groups.get(key) || {
        label: date.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }),
        present: 0,
        total: 0,
      };
      item.total += 1;
      if (session.status === 'present') item.present += 1;
      groups.set(key, item);
    });
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-8).map(([, item]) => ({
      label: item.label,
      value: item.total ? Math.round((item.present / item.total) * 100) : 0,
    }));
  }, [sessions]);

  const absenceReasons = useMemo(() => {
    const counts = new Map<string, number>();
    sessions.filter((session) => session.status === 'absent').forEach((session) => {
      const reason = session.reason && session.reason !== '--' ? session.reason : 'No Reason Provided';
      counts.set(reason, (counts.get(reason) || 0) + 1);
    });
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [sessions]);

  const absenceTimeline = useMemo(() => sessions
    .filter((session) => session.status === 'absent')
    .map((session) => ({ date: session.sessionDateLabel, reason: display(session.reason), title: display(session.sessionTitle) })),
  [sessions]);

  const recentRate = (days: number) => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const recent = sessions.filter((session) => session.sessionDate && new Date(`${session.sessionDate}T00:00:00`) >= cutoff && ['present', 'absent'].includes(session.status));
    if (!recent.length) return '--';
    return `${Math.round((recent.filter((session) => session.status === 'present').length / recent.length) * 100)}%`;
  };

  const catchupSessions = sessions.filter((session) => session.catchupCompleted);
  const maxBar = Math.max(...monthlyTrend.map((item) => item.value), 100);

  return (
    <WorkspaceShell
      role="coach"
      roleLabel={coachNav.label}
      navItems={coachNav.items}
      workspaceLabel={coachNav.workspaceLabel}
      pageTitle="Learner Attendance"
      pageSubtitle="Attendance history and absence insights"
      userName="Med Maher"
      userRole="Progress Coach"
    >
      <main className="min-h-screen bg-[#f7f6fb] p-3 md:p-5">
        <div className="w-full space-y-4">
          <button type="button" onClick={() => navigate('/coach/attendance')} className="inline-flex items-center gap-2 text-[10px] font-semibold text-foreground-500 hover:text-primary-700">
            <i className="ri-arrow-left-line"></i> Attendance
          </button>

          {loading && <div className="rounded-2xl border border-foreground-200 bg-white p-12 text-center text-sm text-foreground-400">Loading attendance profile...</div>}
          {error && <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">{error}</div>}

          {!loading && !error && learner && (
            <>
              <section
                className="rounded-2xl border border-white/10 px-6 py-6 text-white shadow-[0_14px_32px_rgba(20,4,46,0.16)]"
                style={{ background: 'linear-gradient(180deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 50%, oklch(var(--primary-800)) 100%)' }}
              >
                <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                  <div className="flex items-center gap-4">
                    <span className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/20 bg-white/15 text-base font-bold text-white">{learner.initials}</span>
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h1 className="text-xl font-heading font-bold text-white">{learner.learner}</h1>
                        <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[8px] font-semibold text-emerald-700">{riskLabel(learner.risk)}</span>
                      </div>
                      <p className="mt-1 text-[11px] text-white/70">{display(learner.programme)} <span className="mx-1.5">·</span> {display(learner.cohort)} <span className="mx-1.5">·</span> {display(learner.employer)}</p>
                      <p className="mt-1 text-[10px] text-white/55">{display(learner.email)}</p>
                    </div>
                  </div>
                  <button type="button" onClick={() => navigate('/coach/attendance')} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-white px-4 text-[10px] font-bold text-primary-800 shadow-sm hover:bg-primary-50">
                    <i className="ri-arrow-left-line"></i> Back to Attendance
                  </button>
                </div>
              </section>

              <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
                <ProfileMetric label="Attendance" value={formatPercent(learner.attendance)} />
                <ProfileMetric label="Present Sessions" value={String(learner.present ?? '--')} tone="emerald" />
                <ProfileMetric label="Absent Sessions" value={String(learner.absent ?? '--')} tone="red" />
                <ProfileMetric label="Authorised" value={String(learner.authorisedAbsent ?? '--')} />
                <ProfileMetric label="Unauthorised" value={String(learner.unauthorisedAbsent ?? '--')} tone="red" />
                <ProfileMetric label="Catch-Up Recorded" value={String(learner.catchup ?? '--')} tone="amber" />
              </section>

              <ProfileSection title="Attendance Overview">
                <div className="grid grid-cols-2 gap-x-8 gap-y-5 md:grid-cols-4">
                  <OverviewValue label="Overall Attendance" value={formatPercent(learner.attendance)} />
                  <OverviewValue label="Last 30 Days" value={recentRate(30)} />
                  <OverviewValue label="Last 90 Days" value={recentRate(90)} />
                  <OverviewValue label="Consecutive Absences" value={String(learner.consecutiveMissed ?? 0)} tone="red" />
                  <OverviewValue label="Total Sessions" value={String(learner.sessions ?? '--')} />
                  <OverviewValue label="Catch-Ups Completed" value={String(catchupSessions.length)} tone="emerald" />
                  <OverviewValue label="Current Risk" value={riskLabel(learner.risk)} />
                </div>
              </ProfileSection>

              <div className="grid gap-4 lg:grid-cols-2">
                <ProfileSection title="Monthly Attendance Trend">
                  <div className="flex h-[220px] items-end gap-4 border-b border-l border-dashed border-foreground-200 px-5 pt-4">
                    {monthlyTrend.length ? monthlyTrend.map((item) => (
                      <div key={item.label} className="flex h-full flex-1 flex-col items-center justify-end">
                        <span className="mb-1 text-[9px] font-semibold text-primary-700">{item.value}%</span>
                        <div className="w-full max-w-[42px] rounded-t bg-primary-600" style={{ height: `${Math.max(5, (item.value / maxBar) * 165)}px` }}></div>
                        <span className="mt-2 text-[8px] text-foreground-400">{item.label}</span>
                      </div>
                    )) : <div className="flex h-full w-full items-center justify-center text-[11px] text-foreground-400">No monthly attendance records.</div>}
                  </div>
                </ProfileSection>

                <ProfileSection title="Absence Timeline">
                  <div className="max-h-[220px] space-y-2 overflow-y-auto pr-1">
                    {absenceTimeline.length ? absenceTimeline.map((item, index) => (
                      <div key={`${item.date}-${index}`} className="rounded-xl border border-red-100 bg-red-50/60 p-3">
                        <p className="text-[11px] font-bold text-foreground-900">{item.title}</p>
                        <p className="mt-1 text-[9px] text-foreground-500">{item.date}</p>
                        <span className="mt-2 inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-[8px] font-semibold text-amber-700">{item.reason}</span>
                      </div>
                    )) : <EmptyText text="No absences are recorded for this learner." />}
                  </div>
                </ProfileSection>
              </div>

              <ProfileSection title="Session History">
                <div className="overflow-x-auto">
                  <table className="min-w-[850px] w-full text-left">
                    <thead><tr className="border-b border-foreground-100">
                      {['Date', 'Session Type', 'Title', 'Time', 'Status', 'Reason', 'Catch-Up'].map((heading) => <th key={heading} className="px-3 py-3 text-[8px] font-semibold uppercase tracking-wide text-foreground-400">{heading}</th>)}
                    </tr></thead>
                    <tbody className="divide-y divide-foreground-100">
                      {sessions.map((session, index) => (
                        <tr key={`${session.sessionId}-${index}`}>
                          <td className="px-3 py-3 text-[10px] text-foreground-700">{display(session.sessionDateLabel)}</td>
                          <td className="px-3 py-3 text-[10px] text-foreground-600">{display(session.sessionType)}</td>
                          <td className="px-3 py-3 text-[10px] text-foreground-600">{display(session.sessionTitle)}</td>
                          <td className="px-3 py-3 text-[10px] text-foreground-500">{display(session.startTime)} – {display(session.endTime)}</td>
                          <td className="px-3 py-3"><span className={`rounded-full border px-2 py-0.5 text-[8px] font-semibold ${statusClasses(session.status)}`}>{display(session.status)}</span></td>
                          <td className="px-3 py-3 text-[10px] text-foreground-500">{display(session.reason)}</td>
                          <td className="px-3 py-3 text-[10px] text-foreground-500">{session.catchupCompleted ? 'Completed' : '--'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!sessions.length && <EmptyText text="No session history is available." />}
                </div>
              </ProfileSection>

              <ProfileSection title="Absence Reasons">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {absenceReasons.length ? absenceReasons.map(([reason, count]) => (
                    <div key={reason} className="rounded-xl bg-background-100/70 p-4 text-center">
                      <p className="text-lg font-bold text-foreground-900">{count}</p>
                      <p className="mt-1 text-[9px] text-foreground-500">{reason}</p>
                    </div>
                  )) : <EmptyText text="No absence reasons are recorded." />}
                </div>
              </ProfileSection>

              <ProfileSection title="Catch-Up Sessions">
                <div className="grid gap-3 md:grid-cols-2">
                  {catchupSessions.length ? catchupSessions.map((session, index) => (
                    <div key={`${session.sessionId}-${index}`} className="rounded-xl border border-foreground-200 bg-background-50 p-4">
                      <p className="text-[11px] font-bold text-foreground-900">{display(session.sessionTitle)}</p>
                      <p className="mt-1 text-[9px] text-foreground-400">{display(session.sessionDateLabel)}</p>
                      <span className="mt-2 inline-flex rounded-full bg-emerald-50 px-2 py-0.5 text-[8px] font-semibold text-emerald-700">Completed</span>
                    </div>
                  )) : <EmptyText text="No completed catch-up sessions are recorded." />}
                </div>
              </ProfileSection>
            </>
          )}
        </div>
      </main>
    </WorkspaceShell>
  );
}

function ProfileMetric({ label, value, tone = 'primary' }: { label: string; value: string; tone?: 'primary' | 'emerald' | 'red' | 'amber' }) {
  const toneClass = tone === 'emerald' ? 'text-emerald-600' : tone === 'red' ? 'text-red-600' : tone === 'amber' ? 'text-amber-600' : 'text-primary-700';
  return <div className="rounded-xl border border-foreground-200/60 bg-white p-4 text-center"><p className={`text-2xl font-bold ${toneClass}`}>{value}</p><p className="mt-1 text-[9px] text-foreground-500">{label}</p></div>;
}

function ProfileSection({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="rounded-xl border border-foreground-200/60 bg-white p-5"><h2 className="mb-4 text-sm font-heading font-bold text-foreground-900">{title}</h2>{children}</section>;
}

function OverviewValue({ label, value, tone = 'default' }: { label: string; value: string; tone?: 'default' | 'red' | 'amber' | 'emerald' }) {
  const toneClass = tone === 'red' ? 'text-red-600' : tone === 'amber' ? 'text-amber-600' : tone === 'emerald' ? 'text-emerald-600' : 'text-foreground-900';
  return <div><p className="text-[9px] text-foreground-400">{label}</p><p className={`mt-1 text-sm font-bold ${toneClass}`}>{value}</p></div>;
}

function EmptyText({ text }: { text: string }) {
  return <div className="flex min-h-[90px] items-center justify-center rounded-xl border border-dashed border-foreground-200 px-4 text-center text-[10px] text-foreground-400">{text}</div>;
}
