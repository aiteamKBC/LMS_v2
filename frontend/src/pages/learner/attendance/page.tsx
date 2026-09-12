import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { AppIcon } from '@/components/feature/AppIcon';
import { roleNavMap } from '@/mocks/navigation';
import { RightSlidePanel } from '@/components/feature/RightSlidePanel';
import { useMyLearner } from '@/hooks/useMyLearner';
import { useLiveLearnerRead } from '@/hooks/useLiveLearnerRead';
import { RowsSkeleton } from '@/components/feature/Skeletons';
import { PageContainer } from '@/components/ui/PageContainer';
import { Panel } from '@/components/ui/Panel';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { LearnerLoadError } from '@/components/feature/LearnerLoadError';
import type { PageTabItem } from '@/components/ui/PageTabs';
import { RowAction } from '@/components/ui/ActionRow';
import {
  fetchAttendanceWorkspace, peekAttendanceWorkspace, updateAttendanceMode,
  type AttendanceLecture,
} from '@/api/attendanceLectures';
import AbsenceReportForm from './components/AbsenceReportForm';
import AttendanceModePanel from './components/AttendanceModePanel';
import AttendanceLectureList, { type AttendanceFilter } from './components/AttendanceLectureList';
import styles from './attendance.module.css';

const learnerNav = roleNavMap.learner;

export function lectureCounts(lectures: AttendanceLecture[]) {
  const attended = lectures.filter(row => ['completed', 'late'].includes(row.status)).length;
  const absent = lectures.filter(row => row.status === 'absent').length;
  return { all: lectures.length, attended, absent,
    covered: lectures.filter(row => row.catchupStatus === 'completed').length,
    upcoming: lectures.filter(row => row.status === 'upcoming').length,
    rate: attended + absent ? Math.round(100 * attended / (attended + absent)) : null };
}

export default function AttendancePage() {
  const learner = useMyLearner();
  const navigate = useNavigate();
  const read = useLiveLearnerRead(learner.kind, learner.id, true, fetchAttendanceWorkspace, peekAttendanceWorkspace);
  const data = read.data;
  const [moduleId, setModuleId] = useState('all');
  const [filter, setFilter] = useState<AttendanceFilter>('all');
  const [report, setReport] = useState<AttendanceLecture | 'choose' | null>(null);
  const [showAllActivity, setShowAllActivity] = useState(false);
  const [modeBusy, setModeBusy] = useState(false);
  const [modeError, setModeError] = useState('');
  const [modeNotice, setModeNotice] = useState('');
  const selectedModule = data?.modules.some(module => module.id === moduleId) ? moduleId : 'all';
  const lectures = useMemo(() => (data?.lectures || []).filter(row => selectedModule === 'all' || row.moduleId === selectedModule), [data, selectedModule]);
  const counts = useMemo(() => lectureCounts(lectures), [lectures]);
  const tabs: PageTabItem[] = [
    { value: 'all', label: 'All', count: counts.all },
    { value: 'attended', label: 'Attended', count: counts.attended, tone: 'positive' },
    { value: 'absent', label: 'Absent', count: counts.absent, tone: 'critical' },
    { value: 'covered', label: 'Covered', count: counts.covered, tone: 'positive' },
    { value: 'upcoming', label: 'Upcoming', count: counts.upcoming },
  ];
  const changeMode = async (mode: 'live' | 'lazy') => {
    setModeBusy(true); setModeError(''); setModeNotice('');
    try {
      const result = await updateAttendanceMode(learner.kind, learner.id, mode);
      setModeNotice(mode === 'live' ? 'Live Sessions is active. Absence reminders are enabled.' :
        result.emailSent ? 'Your request has been emailed to your manager for approval.' :
          'Your request was saved, but the approval email could not be sent. Please retry.');
      read.refresh();
    } catch (error) { setModeError(error instanceof Error ? error.message : 'Could not update attendance mode.'); }
    finally { setModeBusy(false); }
  };
  const openActivities = (row: AttendanceLecture) => {
    const log = row.monthlyLog ?? {
      month: row.date.slice(0, 7),
      sourceRef: row.source === 'kbc-attendance' ? `att:${row.sessionId}` : `attendance:${row.sessionId.replace(/^teams:/, '')}`,
    };
    const search = new URLSearchParams({ source: log.sourceRef });
    navigate(`/learner/monthly-logs/${learner.kind}/${learner.id}/${log.month}?${search}`);
  };

  return <WorkspaceShell role="learner" roleLabel={learnerNav.label} navItems={learnerNav.items} workspaceLabel={learnerNav.workspaceLabel}
    pageTitle="Attendance" pageSubtitle="Your lectures, attendance and learning activities"
    userName={data?.summary?.learnerName || 'Learner'} userRole="Learner">
    <PageContainer className={styles.page}>
      <SectionHeader title="Attendance" description="Your scheduled lectures, attendance status and learning resources." icon="ri-calendar-check-line"
        actions={data ? <RowAction label="Report absence" icon="ri-calendar-close-line" emphasis="primary" onClick={() => setReport('choose')} /> : undefined} />
      {read.error && data && <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm">
        Lectures could not refresh. Showing the last loaded record. <button onClick={read.refresh} className="font-semibold underline">Retry</button>
      </div>}
      {read.loading ? <Panel><RowsSkeleton rows={6} /></Panel> : !data ? <LearnerLoadError error={read.error || 'Could not load lectures.'} onRetry={read.refresh} /> : <>
        <div className={styles.overview}>
          <Panel className={styles.rateCard}>
            <p className={styles.rateLabel}>Attendance rate</p>
            <p className={styles.rateValue}>{counts.rate == null ? '—' : `${counts.rate}%`}</p>
            <div className={styles.rateTrack} role="progressbar" aria-label="Attendance rate" aria-valuemin={0} aria-valuemax={100}
              aria-valuenow={counts.rate ?? undefined} aria-valuetext={counts.rate == null ? 'No completed attendance records yet' : `${counts.rate}%`}>
              <span style={{ width: `${counts.rate ?? 0}%` }} />
            </div>
            <p className={styles.rateDescription}>{counts.rate == null ? 'No completed attendance records yet' : `${counts.rate}% attendance · includes late attendance`}</p>
          </Panel>
          <Stat label="Total Lectures" value={counts.all} icon="ri-book-open-line" tone="total" />
          <Stat label="Attended" value={counts.attended} icon="ri-checkbox-circle-line" tone="attended" />
          <Stat label="Absent" value={counts.absent} icon="ri-close-circle-line" tone="absent" />
          <Stat label="Caught up" value={counts.covered} icon="ri-play-circle-line" tone="covered" />
        </div>
        <div className={styles.workspace}>
          <div className="min-w-0 space-y-4">
            <AttendanceLectureList lectures={lectures} modules={data.modules} moduleId={selectedModule} onModuleChange={setModuleId}
              filter={filter} onFilterChange={setFilter} tabs={tabs} onOpen={openActivities} onReport={setReport} />
            <Panel><p className="text-sm font-semibold">Keep learning at your own pace</p><p className="mt-1 text-xs text-foreground-500">Complete the activities linked to missed lectures to cover your learning. Catch-up completion is tracked separately from live attendance.</p></Panel>
          </div>
          <aside className={styles.sidebar}>
            <AttendanceModePanel mode={data.mode} busy={modeBusy} error={modeError} notice={modeNotice} onChange={changeMode} />
            <Panel><SectionHeader title="Here to help" icon="ri-customer-service-2-line" />
              <p className="mt-2 text-xs leading-5 text-foreground-500">Get support with your lectures, attendance or catching up.</p>
              <Link to="/learner/support" className={styles.supportLink}><AppIcon className="ri-chat-3-line" />Contact Support<span aria-hidden="true">↗</span></Link>
              <Link to="/learner/calendar?book=student-support" className={styles.supportLink}><AppIcon className="ri-calendar-event-line" />Book a Support Session<span aria-hidden="true">→</span></Link>
            </Panel>
            <Panel><SectionHeader title="Recent Activity" icon="ri-history-line" actions={data.recentActivity.length > 5 ? <button className="text-xs font-semibold text-primary-600" onClick={() => setShowAllActivity(value => !value)}>{showAllActivity ? 'Show less' : 'View all'}</button> : undefined} />
              {!data.recentActivity.length ? <p className="mt-3 text-xs text-foreground-500">Your recent activity will appear here.</p> : <ul className={styles.recentActivity}>{data.recentActivity.slice(0, showAllActivity ? undefined : 5).map(item => <li key={item.id} className="text-xs"><p>{item.title}</p><time dateTime={item.at} className="mt-1 block text-foreground-400">{new Date(item.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</time></li>)}</ul>}
            </Panel>
          </aside>
        </div>
      </>}
    </PageContainer>
    <RightSlidePanel isOpen={report !== null} onClose={() => setReport(null)} title="Report Absence" width="w-[520px]">
      {report && <AbsenceReportForm key={typeof report === 'string' ? report : report.id}
        preselectMatch={typeof report === 'string' ? null : { id: report.id, dateIso: report.date, title: report.title }}
        onSubmitted={() => read.refresh()} onCancel={() => setReport(null)} showGuidance={false} showHistory={false} />}
    </RightSlidePanel>
  </WorkspaceShell>;
}

function Stat({ label, value, icon, tone }: { label: string; value: number; icon: string; tone: 'total' | 'attended' | 'absent' | 'covered' }) {
  return <div className={`coach-metric-card flex items-center gap-3 ${styles.metric}`} data-tone={tone}>
    <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${styles.icon}`}><AppIcon className={`${icon} text-2xl`} /></span>
    <div><p className={`text-2xl font-semibold tabular-nums ${styles.value}`}>{value}</p><p className="mt-1 text-xs text-foreground-500">{label}</p></div>
  </div>;
}
