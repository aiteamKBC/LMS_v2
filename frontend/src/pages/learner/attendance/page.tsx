import { useEffect, useMemo, useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import { RightSlidePanel } from '@/components/feature/RightSlidePanel';
import { fetchLearnerDetail, type LearnerDetail } from '@/api/learnerDetail';
import { fetchLearnerAttendance, type LearnerAttendance, type AttendanceSessionRow, type AttendanceSessionStatus } from '@/api/learnerAttendance';
import { fetchAbsenceReports, type LearnerAbsenceReport } from '@/api/absenceReports';
import { useMyLearner } from '@/hooks/useMyLearner';
import { RowsSkeleton } from '@/components/feature/Skeletons';
import { PageContainer } from '@/components/ui/PageContainer';
import { Panel } from '@/components/ui/Panel';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageTabs, type PageTabItem } from '@/components/ui/PageTabs';
import { ProgressBar } from '@/components/ui/ProgressMetric';
import { RowAction } from '@/components/ui/ActionRow';
import { toneStyle, statusTone, progressTone, type StatusTone } from '@/lib/statusTone';
import { EMPTY_VALUE } from '@/lib/format';
import AbsenceReportForm from './components/AbsenceReportForm';

const learnerNav = roleNavMap.learner;

const RISK_COPY: Record<string, string> = {
  green: 'Your attendance is currently in a healthy range.',
  amber: 'Your attendance needs attention. Review missed sessions below.',
  red: 'Your attendance is at risk. Speak to your coach and address missed sessions.',
};

function formatRowDate(iso: string) {
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatDate(value: string | null, includeTime = false) {
  if (!value) return EMPTY_VALUE;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('en-GB', includeTime ? { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' } : { day: 'numeric', month: 'short', year: 'numeric' });
}

function humanizeType(type: string) {
  if (!type) return EMPTY_VALUE;
  return type.replaceAll('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

const ROW_STATUS_TONE: Record<AttendanceSessionStatus, StatusTone> = {
  attended: 'positive',
  late: 'caution',
  missed: 'critical',
};

const ROW_STATUS_LABEL: Record<AttendanceSessionStatus, string> = {
  attended: 'Attended',
  late: 'Late',
  missed: 'Missed',
};

type HistoryFilter = 'all' | AttendanceSessionStatus;

interface DrawerState {
  open: boolean;
  preselect: { dateIso: string; title: string } | null;
}

export default function AttendancePage() {
  const myLearner = useMyLearner();
  const [learner, setLearner] = useState<LearnerDetail | null>(null);
  const [attendance, setAttendance] = useState<LearnerAttendance | null>(null);
  const [reports, setReports] = useState<LearnerAbsenceReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<HistoryFilter>('all');
  const [drawer, setDrawer] = useState<DrawerState>({ open: false, preselect: null });

  const loadReports = () => {
    fetchAbsenceReports(myLearner.kind, myLearner.id)
      .then((data) => setReports(data.results))
      .catch(() => { /* the history table degrades gracefully without reported-status */ });
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError('');
    Promise.all([
      fetchLearnerDetail(myLearner.kind, myLearner.id),
      fetchLearnerAttendance(myLearner.kind, myLearner.id),
      fetchAbsenceReports(myLearner.kind, myLearner.id).catch(() => ({ count: 0, results: [], missedSessions: [] })),
    ])
      .then(([detail, record, absence]) => {
        if (cancelled) return;
        setLearner(detail);
        setAttendance(record);
        setReports(absence.results);
      })
      .catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : 'Could not load attendance.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [myLearner.id, myLearner.kind]);

  const reportedKeys = useMemo(() => new Set(
    reports
      .filter((report) => !['declined', 'rejected'].includes(report.status.trim().toLowerCase()))
      .map((report) => `${report.sessionDate}|${report.sessionTitle.trim().toLowerCase()}`),
  ), [reports]);

  const history = useMemo(() => attendance?.sessionHistory || [], [attendance]);
  const counts = useMemo(() => ({
    all: history.length,
    attended: history.filter((row) => row.status === 'attended').length,
    missed: history.filter((row) => row.status === 'missed').length,
    late: history.filter((row) => row.status === 'late').length,
  }), [history]);

  const filteredHistory = filter === 'all' ? history : history.filter((row) => row.status === filter);

  const tabs: PageTabItem[] = [
    { value: 'all', label: 'All', count: counts.all },
    { value: 'attended', label: 'Attended', count: counts.attended, tone: 'positive' },
    { value: 'missed', label: 'Missed', count: counts.missed, tone: 'critical' },
    { value: 'late', label: 'Late', count: counts.late, tone: 'caution', hideWhenEmpty: true },
  ];

  const risk = attendance?.risk || '';
  const rateStyle = toneStyle(statusTone(risk));

  const openReportDrawer = (row?: AttendanceSessionRow) => {
    setDrawer({ open: true, preselect: row ? { dateIso: row.date, title: row.title } : null });
  };
  const closeDrawer = () => setDrawer({ open: false, preselect: null });
  const handleAbsenceSubmitted = () => loadReports();

  return (
    <WorkspaceShell role="learner" roleLabel={learnerNav.label} navItems={learnerNav.items} workspaceLabel={learnerNav.workspaceLabel} pageTitle="Attendance" pageSubtitle="Your live attendance record and current risk status" userName={learner?.name || 'Learner'} userRole={learner?.programme ? `${learner.programme} Apprentice` : 'Apprentice'}>
      <PageContainer>
        <SectionHeader
          title="Attendance"
          description={RISK_COPY[risk] || 'Only live sessions with a synced Microsoft Teams attendance report are counted.'}
          icon="ri-calendar-check-line"
          actions={!loading && !error ? <RowAction label="Report absence" icon="ri-calendar-close-line" emphasis="primary" onClick={() => openReportDrawer()} /> : undefined}
        />

        {loading ? (
          <Panel><RowsSkeleton rows={5} /></Panel>
        ) : error ? (
          <Panel><EmptyState variant="error" size="sm" title={error} /></Panel>
        ) : !attendance ? (
          <Panel>
            <EmptyState
              size="sm"
              icon="ri-calendar-check-line"
              title="No verified attendance yet"
              description="Attendance appears here once a completed live session has been synced with its Microsoft Teams attendance report."
            />
          </Panel>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-1.5 px-0.5">
              <StatusBadge tone={statusTone(risk)} label={risk ? `${risk === 'green' ? 'Good standing' : risk === 'amber' ? 'Needs attention' : 'At risk'}` : 'Not set'} />
              <span className="flex items-center gap-1.5 text-[12px]">
                <AppIcon className="ri-calendar-check-line text-[13px] text-foreground-400" />
                <span className="text-foreground-400">Last session</span>
                <span className="font-semibold text-foreground-700">{formatDate(attendance.lastSessionDate)}</span>
              </span>
              <span className="flex items-center gap-1.5 text-[12px]">
                <AppIcon className="ri-refresh-line text-[13px] text-foreground-400" />
                <span className="text-foreground-400">Record updated</span>
                <span className="font-semibold text-foreground-700">{formatDate(attendance.updatedAt, true)}</span>
              </span>
              {attendance.consecutiveMissed > 0 && (
                <span className="flex items-center gap-1.5 text-[12px] text-red-600">
                  <AppIcon className="ri-alert-line text-[13px]" />
                  {attendance.consecutiveMissed} consecutive missed
                </span>
              )}
            </div>

            <div className={`grid grid-cols-1 gap-3 sm:grid-cols-2 ${attendance.late > 0 ? 'lg:grid-cols-4' : 'lg:grid-cols-3'}`}>
              <StatTile icon="ri-percent-line" label="Attendance Rate" value={`${attendance.attendanceRate}%`} percent={attendance.attendanceRate} tone={rateStyle} progressToneClass={progressTone(attendance.attendanceRate)} />
              <StatTile icon="ri-checkbox-circle-line" label="Sessions Attended" value={String(attendance.present)} tone={toneStyle('positive')} />
              <StatTile icon="ri-close-circle-line" label="Missed Sessions" value={String(attendance.absent)} tone={toneStyle('critical')} />
              {attendance.late > 0 && (
                <StatTile icon="ri-time-line" label="Late Sessions" value={String(attendance.late)} tone={toneStyle('caution')} />
              )}
            </div>

            <div className="space-y-3">
              <SectionHeader title="Attendance history" description="Every synced session, with the action you can take on it" icon="ri-history-line" />
              <PageTabs items={tabs} value={filter} onChange={(v) => setFilter(v as HistoryFilter)} label="Filter attendance history" />

              {filteredHistory.length === 0 ? (
                <Panel><EmptyState size="sm" variant="no-matches" title="No sessions match this filter" /></Panel>
              ) : (
                <Panel padding="none">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left">
                      <thead>
                        <tr className="border-b border-foreground-200/60 bg-background-100/60">
                          <th className="whitespace-nowrap px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-foreground-400">Date</th>
                          <th className="whitespace-nowrap px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-foreground-400">Session</th>
                          <th className="whitespace-nowrap px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-foreground-400">Type</th>
                          <th className="whitespace-nowrap px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-foreground-400">Status</th>
                          <th className="px-4 py-2.5"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-foreground-100">
                        {filteredHistory.map((row) => (
                          <HistoryRow
                            key={row.id}
                            row={row}
                            reported={reportedKeys.has(`${row.date}|${row.title.trim().toLowerCase()}`)}
                            onReportAbsence={() => openReportDrawer(row)}
                          />
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Panel>
              )}
            </div>
          </>
        )}
      </PageContainer>

      <RightSlidePanel isOpen={drawer.open} onClose={closeDrawer} title="Report absence" width="w-[520px]">
        <AbsenceReportForm preselectMatch={drawer.preselect} onSubmitted={handleAbsenceSubmitted} showGuidance={false} showHistory />
      </RightSlidePanel>
    </WorkspaceShell>
  );
}

function StatTile({ icon, label, value, percent, tone, progressToneClass }: {
  icon: string; label: string; value: string; percent?: number; tone: ReturnType<typeof toneStyle>; progressToneClass?: string;
}) {
  return (
    <div className="coach-metric-card">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[12px] font-semibold uppercase tracking-[0.06em] text-foreground-400">{label}</p>
        <AppIcon className={`${icon} shrink-0 text-[15px] ${tone.text}`} />
      </div>
      <p className={`mt-1.5 text-[22px] font-semibold leading-none tabular-nums ${tone.text}`}>{value}</p>
      {typeof percent === 'number' && <ProgressBar percent={percent} tone={progressToneClass} className="mt-2.5" />}
    </div>
  );
}

function HistoryRow({ row, reported, onReportAbsence }: {
  row: AttendanceSessionRow;
  reported: boolean;
  onReportAbsence: () => void;
}) {
  return (
    <tr className="transition-colors hover:bg-background-100/40">
      <td className="whitespace-nowrap px-4 py-3 text-[12px] text-foreground-600">{formatRowDate(row.date)}</td>
      <td className="px-4 py-3">
        <p className="text-[13px] font-semibold text-foreground-900">{row.title}</p>
        {row.module && <p className="text-[11px] text-foreground-400">{row.module}</p>}
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-[12px] text-foreground-600">{humanizeType(row.sessionType)}</td>
      <td className="whitespace-nowrap px-4 py-3">
        <StatusBadge tone={ROW_STATUS_TONE[row.status]} label={ROW_STATUS_LABEL[row.status]} />
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-right">
        {row.status === 'missed' ? (
          reported
            ? <span className="text-[11px] font-semibold text-foreground-400">Reported</span>
            : <RowAction label="Report absence" icon="ri-calendar-close-line" onClick={onReportAbsence} />
        ) : (
          <span className="text-[11px] text-foreground-300">{EMPTY_VALUE}</span>
        )}
      </td>
    </tr>
  );
}
