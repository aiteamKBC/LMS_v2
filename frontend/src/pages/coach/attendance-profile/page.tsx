import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { RowsSkeleton } from '@/components/feature/Skeletons';
import { useCoachIdentity } from '@/hooks/useCoachIdentity';
import { coachFetch } from '@/lib/coachFetch';
import { roleNavMap } from '@/mocks/navigation';
import { ATTENDANCE_EXPECTED_RATE, ATTENDANCE_MINIMUM_RATE } from '@/lib/format';
import { statusTone, type StatusTone } from '@/lib/statusTone';
import { PageContainer } from '@/components/ui/PageContainer';
import { PageHeader } from '@/components/ui/PageHeader';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { MetricCard } from '@/components/ui/MetricCard';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyState } from '@/components/ui/EmptyState';
import { DataTable, type DataColumn } from '@/components/ui/DataTable';
import { PageTabs, type PageTabItem } from '@/components/ui/PageTabs';
import { FilterChip } from '@/components/ui/FilterToolbar';
import { Panel } from '@/components/ui/Panel';

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

function sessionStatusTone(status: string): StatusTone {
  if (status === 'present') return 'positive';
  if (status === 'absent') return 'critical';
  return 'neutral';
}

function riskLabel(risk: AttendanceLearner['risk']) {
  if (risk === 'green') return 'On Track';
  if (risk === 'amber') return 'Needs Attention';
  if (risk === 'red') return 'At Risk';
  return 'No Data';
}

/** The learner's risk tone. Plain `statusTone` now that there is no dark hero to contrast against. */
function riskTone(risk: AttendanceLearner['risk']): StatusTone {
  return statusTone(risk);
}

function rateTone(value?: number | null): StatusTone {
  if (value === null || value === undefined) return 'neutral';
  if (value >= ATTENDANCE_EXPECTED_RATE) return 'positive';
  if (value >= ATTENDANCE_MINIMUM_RATE) return 'caution';
  return 'critical';
}

export default function CoachAttendanceProfile() {
  const coach = useCoachIdentity();
  const { learnerId = '' } = useParams();
  const historySectionRef = useRef<HTMLDivElement>(null);
  const [learner, setLearner] = useState<AttendanceLearner | null>(null);
  const [sessions, setSessions] = useState<AttendanceSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [historyFilter, setHistoryFilter] = useState<'all' | 'present' | 'absent' | 'catchup'>('all');
  const [historyMonth, setHistoryMonth] = useState<string | null>(null);

  useEffect(() => {
    if (!coach.isInitialized) return;
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      if (!coach.email) {
        setError('Coach access is required to load this attendance profile.');
        setLearner(null);
        setSessions([]);
        setLoading(false);
        return;
      }
      try {
        const attendanceResponse = await coachFetch(ATTENDANCE_ENDPOINT);
        if (!attendanceResponse.ok) throw new Error('Unable to load learner attendance.');
        const attendancePayload = await attendanceResponse.json();
        const selected = (attendancePayload.learners || []).find((item: AttendanceLearner) => String(item.id) === String(learnerId));
        if (!selected) throw new Error('Learner attendance record was not found.');

        const params = new URLSearchParams({ learner_id: String(selected.id) });
        if (selected.email) params.set('learner_email', selected.email);
        const detailsResponse = await coachFetch(`${DETAILS_ENDPOINT}?${params.toString()}`);
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
  }, [coach.email, coach.isInitialized, learnerId]);

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

  const historyRows = useMemo(
    () => filteredSessions.map((session, index) => ({ ...session, rowKey: `${session.sessionId}-${index}` })),
    [filteredSessions],
  );

  const openHistory = (filter: 'all' | 'present' | 'absent' | 'catchup', month: string | null = null) => {
    setHistoryFilter(filter);
    setHistoryMonth(month);
    window.setTimeout(() => historySectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  };

  const historyTabs: PageTabItem[] = [
    { value: 'all', label: 'All sessions', count: sessions.length },
    { value: 'present', label: 'Present', count: sessions.filter((s) => s.status === 'present').length },
    { value: 'absent', label: 'Absent', count: sessions.filter((s) => s.status === 'absent').length },
    { value: 'catchup', label: 'Catch-ups', count: catchupCompletedCount },
  ];

  const historyColumns: DataColumn<AttendanceSession & { rowKey: string }>[] = [
    { key: 'date', label: 'Date', widthClass: 'w-[130px] min-w-[120px]', render: (s) => <span className="font-semibold text-foreground-700">{display(s.sessionDateLabel)}</span> },
    { key: 'type', label: 'Session Type', widthClass: 'w-[150px] min-w-[130px]', render: (s) => <span className="capitalize text-foreground-600">{display(s.sessionType).replaceAll('_', ' ')}</span> },
    { key: 'title', label: 'Title', widthClass: 'w-[220px] min-w-[180px]', render: (s) => <span className="font-medium text-foreground-700">{display(s.sessionTitle)}</span> },
    { key: 'time', label: 'Time', widthClass: 'w-[160px] min-w-[140px]', render: (s) => <span className="text-foreground-500">{display(s.startTime)} – {display(s.endTime)}</span> },
    { key: 'status', label: 'Status', widthClass: 'w-[120px] min-w-[110px]', render: (s) => <StatusBadge tone={sessionStatusTone(s.status)} label={display(s.status)} size="sm" /> },
    { key: 'reason', label: 'Reason', widthClass: 'w-[180px] min-w-[150px]', render: (s) => <span className="text-foreground-500">{display(s.reason)}</span> },
    {
      key: 'catchup',
      label: 'Catch-Up',
      widthClass: 'w-[130px] min-w-[110px]',
      render: (s) => (s.catchupCompleted
        ? <span className="inline-flex items-center gap-1 text-emerald-600"><AppIcon className="ri-check-line"></AppIcon> Completed</span>
        : <span className="text-foreground-400">--</span>),
    },
  ];

  return (
    <WorkspaceShell
      role="coach"
      roleLabel={coachNav.label}
      navItems={coachNav.items}
      workspaceLabel={coachNav.workspaceLabel}
      pageTitle="Learner Attendance"
      pageSubtitle="Attendance history and absence insights"
      userName={coach.name}
      userRole="Progress Coach"
    >
      <PageContainer>
        {loading && (
          <Panel>
            <RowsSkeleton rows={5} />
          </Panel>
        )}
        {error && <EmptyState variant="error" title="Unable to load this attendance profile." description={error} />}

        {!loading && !error && learner && (
          <>
            <PageHeader
              title={learner.learner}
              description={`${display(learner.programme)} · ${display(learner.cohort)} · ${display(learner.employer)}`}
              icon="ri-user-line"
              backTo={{ to: '/coach/attendance', label: 'Back to Attendance' }}
              meta={(
                <>
                  <StatusBadge tone={riskTone(learner.risk)} label={riskLabel(learner.risk)} size="sm" />
                  <span className="text-[12px] text-foreground-500">{display(learner.email)}</span>
                </>
              )}
            />

            <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <MetricCard
                label="Overall attendance"
                value={formatPercent(learner.attendance)}
                tone={rateTone(learner.attendance)}
                icon="ri-percent-line"
                onClick={() => openHistory('all')}
              />
              <MetricCard
                label={`Present from ${learner.sessions ?? '--'} sessions`}
                value={String(learner.present ?? '--')}
                tone="positive"
                icon="ri-calendar-check-line"
                onClick={() => openHistory('present')}
              />
              <MetricCard
                label={`${learner.authorisedAbsent ?? 0} authorised · ${learner.unauthorisedAbsent ?? 0} unauthorised`}
                value={String(learner.absent ?? '--')}
                tone="critical"
                icon="ri-calendar-close-line"
                onClick={() => openHistory('absent')}
              />
              <MetricCard
                label="Catch-ups completed"
                value={String(catchupCompletedCount)}
                tone="caution"
                icon="ri-history-line"
                onClick={() => openHistory('catchup')}
              />
            </section>

            <div className="grid gap-4 lg:grid-cols-2">
              <Panel>
                <SectionHeader title="Monthly attendance trend" icon="ri-line-chart-line" />
                <div className="relative mt-4 flex h-[240px] items-end justify-center gap-10 overflow-hidden rounded-xl border border-foreground-100 bg-background-100/50 px-6 pb-4 pt-5">
                  <div className="pointer-events-none absolute inset-x-5 top-1/4 border-t border-dashed border-foreground-200"></div>
                  <div className="pointer-events-none absolute inset-x-5 top-1/2 border-t border-dashed border-foreground-200"></div>
                  <div className="pointer-events-none absolute inset-x-5 top-3/4 border-t border-dashed border-foreground-200"></div>
                  {monthlyTrend.length ? monthlyTrend.map((item) => (
                    <button type="button" key={item.key} onClick={() => openHistory('all', item.key)} className="group relative z-10 flex h-full w-20 cursor-pointer flex-col items-center justify-end rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400">
                      <span className="mb-2 rounded-full bg-primary-50 px-2 py-0.5 text-[12px] font-bold text-primary-700">{item.value}%</span>
                      <div className="w-11 rounded-t-lg bg-gradient-to-t from-primary-700 to-primary-500 shadow-sm transition group-hover:brightness-110" style={{ height: `${Math.max(5, (item.value / 100) * 165)}px` }}></div>
                      <span className="mt-2 text-[12px] font-medium text-foreground-500 group-hover:text-primary-700">{item.label}</span>
                    </button>
                  )) : (
                    <EmptyState variant="empty" size="sm" title="No monthly attendance records." />
                  )}
                </div>
              </Panel>

              <Panel>
                <SectionHeader title="Absence timeline" icon="ri-calendar-close-line" />
                <div className="mt-4 max-h-[240px] space-y-2.5 overflow-y-auto pr-1">
                  {absenceTimeline.length ? absenceTimeline.map((item, index) => (
                    <button type="button" key={`${item.date}-${index}`} onClick={() => openHistory('absent', item.month)} className="group flex w-full cursor-pointer gap-3 rounded-xl border border-red-100 bg-red-50/50 p-3.5 text-left transition hover:border-red-200 hover:bg-red-50 hover:shadow-sm">
                      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-background-50 text-red-500 ring-1 ring-red-100"><AppIcon className="ri-close-line"></AppIcon></span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-3">
                          <p className="truncate text-[13px] font-bold text-foreground-900 group-hover:text-red-700">{item.title}</p>
                          <p className="shrink-0 text-[12px] text-foreground-400">{item.date}</p>
                        </div>
                        <span className="mt-2 inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-[12px] font-semibold text-amber-700">{item.reason}</span>
                      </div>
                      <AppIcon className="ri-arrow-right-s-line self-center text-foreground-300 transition group-hover:translate-x-0.5 group-hover:text-red-500"></AppIcon>
                    </button>
                  )) : (
                    <EmptyState variant="empty" size="sm" title="No absences are recorded for this learner." />
                  )}
                </div>
              </Panel>
            </div>

            <div ref={historySectionRef} className="scroll-mt-4">
              <Panel padding="none">
                <div className="space-y-3 p-4">
                  <SectionHeader title="Session history" icon="ri-table-line" />
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <PageTabs
                      items={historyTabs}
                      value={historyFilter}
                      onChange={(next) => openHistory(next as 'all' | 'present' | 'absent' | 'catchup', null)}
                      label="Filter session history"
                    />
                    {historyMonth ? (
                      <FilterChip
                        label="Month"
                        value={new Date(`${historyMonth}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}
                        onRemove={() => setHistoryMonth(null)}
                      />
                    ) : null}
                  </div>
                </div>

                <DataTable
                  columns={historyColumns}
                  rows={historyRows}
                  rowKey={(row) => row.rowKey}
                  minWidthClass="min-w-[900px]"
                  empty={<EmptyState variant="no-matches" size="sm" title="No sessions match the selected filter." />}
                  className="rounded-none border-0 border-t border-foreground-100 shadow-none"
                />
              </Panel>
            </div>
          </>
        )}
      </PageContainer>
    </WorkspaceShell>
  );
}
