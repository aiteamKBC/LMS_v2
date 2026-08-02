import { useEffect, useMemo, useRef, useState } from 'react';
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

function riskClasses(risk: AttendanceLearner['risk']) {
  if (risk === 'green') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (risk === 'amber') return 'border-amber-200 bg-amber-50 text-amber-700';
  if (risk === 'red') return 'border-red-200 bg-red-50 text-red-700';
  return 'border-white/20 bg-white/10 text-white/70';
}

export default function CoachAttendanceProfile() {
  const navigate = useNavigate();
  const { learnerId = '' } = useParams();
  const historySectionRef = useRef<HTMLDivElement>(null);
  const [learner, setLearner] = useState<AttendanceLearner | null>(null);
  const [sessions, setSessions] = useState<AttendanceSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [historyFilter, setHistoryFilter] = useState<'all' | 'present' | 'absent' | 'catchup'>('all');
  const [historyMonth, setHistoryMonth] = useState<string | null>(null);

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
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-8).map(([key, item]) => ({
      key,
      label: item.label,
      value: item.total ? Math.round((item.present / item.total) * 100) : 0,
    }));
  }, [sessions]);

  const absenceTimeline = useMemo(() => sessions
    .filter((session) => session.status === 'absent')
    .map((session) => ({
      date: session.sessionDateLabel,
      month: session.sessionDate?.slice(0, 7) || null,
      reason: display(session.reason),
      title: display(session.sessionTitle),
    })),
  [sessions]);

  const catchupCompletedCount = sessions.filter((session) => session.catchupCompleted).length;
  const filteredSessions = useMemo(() => sessions.filter((session) => {
    if (historyFilter === 'present' && session.status !== 'present') return false;
    if (historyFilter === 'absent' && session.status !== 'absent') return false;
    if (historyFilter === 'catchup' && !session.catchupCompleted) return false;
    if (historyMonth && session.sessionDate?.slice(0, 7) !== historyMonth) return false;
    return true;
  }), [historyFilter, historyMonth, sessions]);

  const openHistory = (filter: 'all' | 'present' | 'absent' | 'catchup', month: string | null = null) => {
    setHistoryFilter(filter);
    setHistoryMonth(month);
    window.setTimeout(() => historySectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  };

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
          {loading && <div className="rounded-2xl border border-foreground-200 bg-white p-12 text-center text-sm text-foreground-400">Loading attendance profile...</div>}
          {error && <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">{error}</div>}

          {!loading && !error && learner && (
            <>
              <section
                className="overflow-hidden rounded-2xl border border-white/10 px-5 py-5 text-white shadow-[0_14px_32px_rgba(20,4,46,0.16)] md:px-6"
                style={{ background: 'linear-gradient(180deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 50%, oklch(var(--primary-800)) 100%)' }}
              >
                <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                  <div className="flex items-center gap-4">
                    <span className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/20 bg-white/15 text-base font-bold text-white shadow-inner">{learner.initials}</span>
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h1 className="text-xl font-heading font-bold text-white">{learner.learner}</h1>
                        <span className={`rounded-full border px-2.5 py-1 text-[9px] font-semibold ${riskClasses(learner.risk)}`}>{riskLabel(learner.risk)}</span>
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

              <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <ProfileMetric icon="ri-percent-line" label="Overall attendance" value={formatPercent(learner.attendance)} onClick={() => openHistory('all')} />
                <ProfileMetric icon="ri-calendar-check-line" label={`Present from ${learner.sessions ?? '--'} sessions`} value={String(learner.present ?? '--')} tone="emerald" onClick={() => openHistory('present')} />
                <ProfileMetric icon="ri-calendar-close-line" label={`${learner.authorisedAbsent ?? 0} authorised · ${learner.unauthorisedAbsent ?? 0} unauthorised`} value={String(learner.absent ?? '--')} tone="red" onClick={() => openHistory('absent')} />
                <ProfileMetric icon="ri-history-line" label="Catch-ups completed" value={String(catchupCompletedCount)} tone="amber" onClick={() => openHistory('catchup')} />
              </section>

              <div className="grid gap-4 lg:grid-cols-2">
                <ProfileSection title="Monthly Attendance Trend" icon="ri-line-chart-line">
                  <div className="relative flex h-[240px] items-end justify-center gap-10 overflow-hidden rounded-xl border border-foreground-100 bg-background-50/50 px-6 pb-4 pt-5">
                    <div className="pointer-events-none absolute inset-x-5 top-1/4 border-t border-dashed border-foreground-200"></div>
                    <div className="pointer-events-none absolute inset-x-5 top-1/2 border-t border-dashed border-foreground-200"></div>
                    <div className="pointer-events-none absolute inset-x-5 top-3/4 border-t border-dashed border-foreground-200"></div>
                    {monthlyTrend.length ? monthlyTrend.map((item) => (
                      <button type="button" key={item.key} onClick={() => openHistory('all', item.key)} className="group relative z-10 flex h-full w-20 cursor-pointer flex-col items-center justify-end rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400">
                        <span className="mb-2 rounded-full bg-primary-50 px-2 py-0.5 text-[9px] font-bold text-primary-700">{item.value}%</span>
                        <div className="w-11 rounded-t-lg bg-gradient-to-t from-primary-700 to-primary-500 shadow-sm transition group-hover:brightness-110 group-hover:shadow-md" style={{ height: `${Math.max(5, (item.value / 100) * 165)}px` }}></div>
                        <span className="mt-2 text-[9px] font-medium text-foreground-500 group-hover:text-primary-700">{item.label}</span>
                      </button>
                    )) : <div className="flex h-full w-full items-center justify-center text-[11px] text-foreground-400">No monthly attendance records.</div>}
                  </div>
                </ProfileSection>

                <ProfileSection title="Absence Timeline" icon="ri-calendar-close-line">
                  <div className="max-h-[240px] space-y-2.5 overflow-y-auto pr-1">
                    {absenceTimeline.length ? absenceTimeline.map((item, index) => (
                      <button type="button" key={`${item.date}-${index}`} onClick={() => openHistory('absent', item.month)} className="group flex w-full cursor-pointer gap-3 rounded-xl border border-red-100 bg-red-50/50 p-3.5 text-left transition hover:border-red-200 hover:bg-red-50 hover:shadow-sm">
                        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-red-500 ring-1 ring-red-100"><i className="ri-close-line"></i></span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-3">
                            <p className="truncate text-[11px] font-bold text-foreground-900 group-hover:text-red-700">{item.title}</p>
                            <p className="shrink-0 text-[9px] text-foreground-400">{item.date}</p>
                          </div>
                          <span className="mt-2 inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-[8px] font-semibold text-amber-700">{item.reason}</span>
                        </div>
                        <i className="ri-arrow-right-s-line self-center text-foreground-300 transition group-hover:translate-x-0.5 group-hover:text-red-500"></i>
                      </button>
                    )) : <EmptyText text="No absences are recorded for this learner." />}
                  </div>
                </ProfileSection>
              </div>

              <div ref={historySectionRef} className="scroll-mt-4">
              <ProfileSection title="Session History" icon="ri-table-line">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    {([
                      ['all', 'All sessions'],
                      ['present', 'Present'],
                      ['absent', 'Absent'],
                      ['catchup', 'Catch-ups'],
                    ] as const).map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => openHistory(value, null)}
                        className={`rounded-full px-3 py-1.5 text-[9px] font-semibold transition ${
                          historyFilter === value && !historyMonth
                            ? 'bg-primary-600 text-white shadow-sm'
                            : 'bg-background-100 text-foreground-500 hover:bg-background-200'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  {historyMonth && (
                    <button type="button" onClick={() => setHistoryMonth(null)} className="inline-flex items-center gap-1.5 rounded-full border border-primary-200 bg-primary-50 px-3 py-1.5 text-[9px] font-semibold text-primary-700 hover:bg-primary-100">
                      {new Date(`${historyMonth}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}
                      <i className="ri-close-line"></i>
                    </button>
                  )}
                </div>
                <div className="overflow-hidden rounded-xl border border-foreground-100">
                  <div className="overflow-x-auto">
                  <table className="w-full min-w-[900px] text-left">
                    <thead className="bg-background-100/70"><tr className="border-b border-foreground-200">
                      {['Date', 'Session Type', 'Title', 'Time', 'Status', 'Reason', 'Catch-Up'].map((heading) => <th key={heading} className="px-4 py-3.5 text-[9px] font-bold uppercase tracking-wide text-foreground-500">{heading}</th>)}
                    </tr></thead>
                    <tbody className="divide-y divide-foreground-100">
                      {filteredSessions.map((session, index) => (
                        <tr key={`${session.sessionId}-${index}`} className="transition-colors hover:bg-background-50">
                          <td className="px-4 py-3.5 text-[10px] font-semibold text-foreground-700">{display(session.sessionDateLabel)}</td>
                          <td className="px-4 py-3.5 text-[10px] capitalize text-foreground-600">{display(session.sessionType).replaceAll('_', ' ')}</td>
                          <td className="px-4 py-3.5 text-[10px] font-medium text-foreground-700">{display(session.sessionTitle)}</td>
                          <td className="px-4 py-3.5 text-[10px] text-foreground-500">{display(session.startTime)} – {display(session.endTime)}</td>
                          <td className="px-4 py-3.5"><span className={`rounded-full border px-2.5 py-1 text-[8px] font-semibold capitalize ${statusClasses(session.status)}`}>{display(session.status)}</span></td>
                          <td className="px-4 py-3.5 text-[10px] text-foreground-500">{display(session.reason)}</td>
                          <td className="px-4 py-3.5 text-[10px] text-foreground-500">{session.catchupCompleted ? <span className="inline-flex items-center gap-1 text-emerald-600"><i className="ri-check-line"></i> Completed</span> : '--'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!filteredSessions.length && <EmptyText text="No sessions match the selected filter." />}
                  </div>
                </div>
              </ProfileSection>
              </div>
            </>
          )}
        </div>
      </main>
    </WorkspaceShell>
  );
}

function ProfileMetric({ icon, label, value, tone = 'primary', onClick }: { icon: string; label: string; value: string; tone?: 'primary' | 'emerald' | 'red' | 'amber'; onClick: () => void }) {
  const styles = {
    primary: {
      card: 'border-primary-200/70 bg-gradient-to-br from-white via-white to-primary-50/80',
      accent: 'bg-primary-500',
      icon: 'bg-primary-100 text-primary-700 ring-primary-200/70',
      value: 'text-primary-800',
      action: 'group-hover:bg-primary-600 group-hover:text-white',
    },
    emerald: {
      card: 'border-emerald-200/70 bg-gradient-to-br from-white via-white to-emerald-50/80',
      accent: 'bg-emerald-500',
      icon: 'bg-emerald-100 text-emerald-700 ring-emerald-200/70',
      value: 'text-emerald-700',
      action: 'group-hover:bg-emerald-600 group-hover:text-white',
    },
    red: {
      card: 'border-red-200/70 bg-gradient-to-br from-white via-white to-red-50/80',
      accent: 'bg-red-500',
      icon: 'bg-red-100 text-red-700 ring-red-200/70',
      value: 'text-red-600',
      action: 'group-hover:bg-red-600 group-hover:text-white',
    },
    amber: {
      card: 'border-amber-200/70 bg-gradient-to-br from-white via-white to-amber-50/80',
      accent: 'bg-amber-500',
      icon: 'bg-amber-100 text-amber-700 ring-amber-200/70',
      value: 'text-amber-700',
      action: 'group-hover:bg-amber-600 group-hover:text-white',
    },
  } as const;
  const style = styles[tone];

  return (
    <button type="button" onClick={onClick} className={`group relative flex min-h-[118px] w-full cursor-pointer flex-col overflow-hidden rounded-2xl border p-4 text-left shadow-sm transition duration-200 hover:-translate-y-1 hover:shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 ${style.card}`}>
      <span className={`absolute inset-x-0 top-0 h-1 ${style.accent}`} />
      <div className="flex items-start justify-between">
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1 ${style.icon}`}>
          <i className={`${icon} text-lg`}></i>
        </span>
        <span className={`flex h-7 w-7 items-center justify-center rounded-full bg-white text-foreground-300 shadow-sm ring-1 ring-foreground-100 transition ${style.action}`}>
          <i className="ri-arrow-right-line text-[11px] transition group-hover:translate-x-0.5"></i>
        </span>
      </div>
      <div className="mt-auto pt-3">
        <p className={`text-3xl font-heading font-bold leading-none tracking-tight ${style.value}`}>{value}</p>
        <p className="mt-2 truncate text-[10px] font-semibold text-foreground-600">{label}</p>
      </div>
    </button>
  );
}

function ProfileSection({ title, icon, children }: { title: string; icon?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-foreground-200/60 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center gap-2.5">
        {icon && <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-50 text-primary-700"><i className={icon}></i></span>}
        <h2 className="text-sm font-heading font-bold text-foreground-900">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function EmptyText({ text }: { text: string }) {
  return <div className="flex min-h-[90px] items-center justify-center rounded-xl border border-dashed border-foreground-200 px-4 text-center text-[10px] text-foreground-400">{text}</div>;
}
