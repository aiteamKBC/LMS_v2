import { useCallback, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { AppIcon } from '@/components/feature/AppIcon';
import { roleNavMap } from '@/mocks/navigation';
import { useMyLearner } from '@/hooks/useMyLearner';
import { useLiveLearnerRead } from '@/hooks/useLiveLearnerRead';
import { useLearnerWorkspaceAccess } from '@/hooks/useLearnerWorkspaceAccess';
import { RowsSkeleton } from '@/components/feature/Skeletons';
import { PageContainer } from '@/components/ui/PageContainer';
import { Panel } from '@/components/ui/Panel';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { LearnerLoadError } from '@/components/feature/LearnerLoadError';
import type { PageTabItem } from '@/components/ui/PageTabs';
import { RowAction } from '@/components/ui/ActionRow';
import {
  confirmAttendance, fetchAttendanceWorkspace, peekAttendanceWorkspace, updateAttendanceMode,
  type AttendanceLecture,
} from '@/api/attendanceLectures';
import AbsenceReportForm from './components/AbsenceReportForm';
import AbsenceReportDialog from './components/AbsenceReportDialog';
import AttendanceModePanel from './components/AttendanceModePanel';
import AttendanceLectureList, { type AttendanceFilter } from './components/AttendanceLectureList';
import FeaturedLecture from './components/FeaturedLecture';
import CatchupBooking from './components/CatchupBooking';
import type { LearnerCalendarEvent } from '@/api/learnerCalendar';
import { featuredLecture, useLectureClock } from './liveLecture';
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
  const access = useLearnerWorkspaceAccess(learner.id);
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
  const [catchup, setCatchup] = useState<AttendanceLecture | null>(null);
  const [catchupBooking, setCatchupBooking] = useState<LearnerCalendarEvent | null>(null);
  const [bookingBusy, setBookingBusy] = useState(false);
  const [attendBusy, setAttendBusy] = useState(false);
  const attendInFlight = useRef(false);
  const [attendError, setAttendError] = useState('');
  const [attendNotice, setAttendNotice] = useState('');
  const [confirmations, setConfirmations] = useState<Record<string, number>>({});
  const allLectures = useMemo(() => (data?.lectures || []).map(row => {
    const minutes = confirmations[`${learner.kind}:${learner.id}:${row.id}`];
    return minutes == null ? row : { ...row, status: 'completed' as const, attendanceConfirmed: true,
      creditedMinutes: minutes, canReportAbsence: false, catchupStatus: null };
  }), [data, confirmations, learner.kind, learner.id]);
  const now = useLectureClock(allLectures);
  const featured = featuredLecture(allLectures, now, data?.timeZone);
  const selectedModule = data?.modules.some(module => module.id === moduleId) ? moduleId : 'all';
  const lectures = useMemo(() => allLectures.filter(row => selectedModule === 'all' || row.moduleId === selectedModule), [allLectures, selectedModule]);
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
  const attend = async (row: AttendanceLecture) => {
    if (attendInFlight.current || !access.canProgress) return;
    attendInFlight.current = true;
    setAttendBusy(true); setAttendError(''); setAttendNotice('');
    try {
      const result = await confirmAttendance(learner.kind, learner.id, row.id);
      setConfirmations(current => ({ ...current, [`${learner.kind}:${learner.id}:${row.id}`]: result.creditedMinutes }));
      setAttendNotice(`Attendance recorded for ${row.title}. ${result.creditedHours} ${result.creditedHours === 1 ? 'hour' : 'hours'} credited.`);
      read.refresh();
    } catch (error) { setAttendError(error instanceof Error ? error.message : 'Could not save attendance. Please try again.'); }
    finally { attendInFlight.current = false; setAttendBusy(false); }
  };
  const selectCatchupBooking = useCallback((event: LearnerCalendarEvent | null) => {
    setCatchupBooking(event);
  }, []);

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
        <FeaturedLecture lecture={featured} now={now} timeZone={data.timeZone} busy={attendBusy} canAttend={access.canProgress}
          error={attendError} notice={attendNotice} onAttend={attend} onReport={setReport} />
        <div className={styles.workspace}>
          <div className={styles.mainColumn}>
            <Panel className={styles.overview}>
              <label className={styles.moduleField}><span>Select Module</span>
                <select aria-label="Module" value={selectedModule} onChange={event => { setModuleId(event.target.value); setFilter('all'); }}>
                  <option value="all">All modules</option>
                  {data.modules.map(module => <option key={module.id} value={module.id}>{module.title}</option>)}
                </select>
              </label>
              <div className={styles.moduleOverview}>
                <h2>Module Overview</h2>
                <p className={styles.selectedModule} title={data.modules.find(module => module.id === selectedModule)?.title || 'All modules'}>
                  {data.modules.find(module => module.id === selectedModule)?.title || 'All modules'}
                </p>
                <p className={styles.rateDescription} title="Includes late attendance">{counts.rate == null ? 'No completed attendance records yet' : <>{counts.rate}% attendance<span className="sr-only"> · includes late attendance</span></>}</p>
              </div>
              <div className={styles.metrics}>
                <Stat label="Total Lectures" value={counts.all} total={counts.all} icon="ri-book-open-line" tone="total" />
                <Stat label="Attended" value={counts.attended} total={counts.all} icon="ri-checkbox-circle-line" tone="attended" />
                <Stat label="Absent" value={counts.absent} total={counts.all} icon="ri-close-line" tone="absent" />
                <Stat label="Covered Missed" value={counts.covered} total={counts.all} icon="ri-star-fill" tone="covered" />
              </div>
            </Panel>
            <AttendanceLectureList key={selectedModule} lectures={lectures} moduleId={selectedModule} onModuleChange={setModuleId}
              filter={filter} onFilterChange={setFilter} tabs={tabs} onOpen={openActivities} onReport={setReport}
              onCatchup={row => { setCatchup(row); setCatchupBooking(null); }} />
            <p className={styles.learningNote}><AppIcon className="ri-information-line" />Complete the activities linked to missed lectures to cover your learning. Catch-up is tracked separately from live attendance.</p>
          </div>
          <aside className={styles.sidebar}>
            <AttendanceModePanel mode={data.mode} busy={modeBusy} error={modeError} notice={modeNotice} onChange={changeMode} />
            <Panel className={styles.supportPanel}>
              <div className={styles.sidebarHeading}>
                <span className={styles.sectionIcon}><AppIcon className="ri-group-line" /></span>
                <div><h2>Book Support Session</h2><p>Need extra help? Book a one-to-one support session with your tutor.</p></div>
              </div>
              <Link to="/learner/calendar?book=student-support" className={`primary-action ${styles.supportButton}`}><AppIcon className="ri-calendar-event-line" />Book a Support Session</Link>
              <Link to="/learner/support" className={styles.contactLink}>Contact Support</Link>
            </Panel>
            <Panel className={styles.activityPanel}>
              <div className={styles.activityHeading}><h2><AppIcon className="ri-history-line" />Recent Activity <span>(Audit Trail)</span></h2>
                {data.recentActivity.length > 5 && <button type="button" onClick={() => setShowAllActivity(value => !value)}>{showAllActivity ? 'Show less' : 'View all'} <span aria-hidden="true">→</span></button>}
              </div>
              {!data.recentActivity.length ? <p className="mt-3 text-xs text-foreground-500">Your recent activity will appear here.</p> : <ul className={styles.recentActivity}>{data.recentActivity.slice(0, showAllActivity ? undefined : 5).map(item => <li key={item.id}>
                <span className={styles.activityIcon} data-type={item.type}><AppIcon className={activityIcon(item.type)} /></span>
                <p>{item.title}</p>
                <time dateTime={item.at}><span>{new Date(item.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</span><span>{new Date(item.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span></time>
              </li>)}</ul>}
            </Panel>
          </aside>
        </div>
      </>}
    </PageContainer>
    {report && <AbsenceReportDialog onClose={() => setReport(null)}>
      <AbsenceReportForm key={typeof report === 'string' ? report : report.id}
        preselectMatch={typeof report === 'string' ? null : { id: report.id, dateIso: report.date, title: report.title }}
        onSubmitted={() => read.refresh()} onCancel={() => setReport(null)} showGuidance={false} showHistory={false} compact />
    </AbsenceReportDialog>}
    {catchup && <AbsenceReportDialog title="Book Catchup Session" onClose={() => { setCatchup(null); read.refresh(); }}>
      <p className={styles.catchupLectureTitle}>{catchup.title} · {catchup.date}</p>
      <CatchupBooking key={catchup.id} lecture={{ ...catchup, status: 'absent', dateIso: catchup.date,
        sessionType: 'live_session', coach: catchup.coach || '' }} selectedKey={catchupBooking?.eventKey || ''}
        onSelect={selectCatchupBooking} onBusyChange={setBookingBusy} standalone />
      <button type="button" className={styles.catchupDone} disabled={bookingBusy} onClick={() => { setCatchup(null); read.refresh(); }}>Done</button>
    </AbsenceReportDialog>}
  </WorkspaceShell>;
}

function Stat({ label, value, total, icon, tone }: { label: string; value: number; total: number; icon: string; tone: 'total' | 'attended' | 'absent' | 'covered' }) {
  return <div className={styles.metric} data-tone={tone} style={{ '--metric-progress': `${total ? value / total * 100 : 0}%` } as CSSProperties}>
    <span className={styles.metricRing} aria-hidden="true"><span><AppIcon className={icon} /></span></span>
    <div><p className={styles.value}>{value}</p><p className={styles.metricLabel}>{label}</p></div>
  </div>;
}

function activityIcon(type: string) {
  if (type.includes('absence')) return 'ri-flag-line';
  if (type.includes('support') || type.includes('booking')) return 'ri-calendar-event-line';
  if (type.includes('mode')) return 'ri-toggle-line';
  if (type.includes('attendance')) return 'ri-calendar-check-line';
  return 'ri-book-open-line';
}
