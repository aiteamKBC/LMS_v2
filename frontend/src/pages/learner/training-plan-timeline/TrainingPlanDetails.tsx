import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CalendarDays, ChevronLeft, ChevronRight, Clock3, Equal, FileText, GraduationCap, RefreshCw, Target, TrendingDown, TrendingUp, Video } from 'lucide-react';
import type { LearnerKind } from '@/api/learnerDetail';
import type { TrainingPlanDashboard, PlanReview } from '@/api/trainingPlanDashboard';
import type { LearnerCalendarEvent } from '@/api/learnerCalendar';
import { fetchAttendanceWorkspace, peekAttendanceWorkspace, type AttendanceLecture } from '@/api/attendanceLectures';
import { invalidateLearnerReads } from '@/api/learnerRead';
import { useLiveLearnerRead } from '@/hooks/useLiveLearnerRead';
import { coachFetch } from '@/lib/coachFetch';
import type { Subject } from '../my-learning/SubjectWorkspace';
import type { PlanActivitySummary, PlanSubjectSummary } from '@/api/learnerOverview';
import { buildPlanModules, dateKey, monthMetrics, moduleVisualEnd, reviewDate, sessionDay, uniquePlanSessions } from './model';
import { dateLabel, hours, monthLabel, sessionTime, State } from './presentation';
import styles from './trainingPlan.module.css';
import layout from './TrainingPlanDetails.module.css';
import board from './MonthlyFocusBoard.module.css';
import { ModuleTimeline } from './ModuleTimeline';
import { ModuleOverview } from './ModuleOverview';
import { ProgressCharts, type ProgrammeProgressSnapshot } from './ProgressCharts';
import { OtjHoursSummary } from './OtjHoursSummary';
import { monthlyHours } from './monthlyHours';
import MeetingBookingDialog from '../reviews/MeetingBookingDialog';
import AbsenceReportDialog from '../attendance/components/AbsenceReportDialog';
import AbsenceReportForm from '../attendance/components/AbsenceReportForm';
import CatchupBooking from '../attendance/components/CatchupBooking';
import attendanceStyles from '../attendance/attendance.module.css';

type Props = {
  data: TrainingPlanDashboard; subjects: (Subject | PlanSubjectSummary)[]; kind: LearnerKind; learnerId: string;
  onRefresh: () => void; refreshing?: boolean; onRetryContract: () => void;
  initialSubjectId?: string; initialMonth?: string; canOpenActivities?: boolean; weeklyFocus?: ReactNode;
  programmeStartDate?: string | null; programmeEndDate?: string | null;
  activityOverviewOnly?: boolean;
  timelineOnly?: boolean;
  monthlyOnly?: boolean;
  trainingOnly?: boolean;
  overviewOnly?: boolean;
  showOtjChart?: boolean;
  programmeSnapshot?: ProgrammeProgressSnapshot;
};

type TimelineModule = ReturnType<typeof buildPlanModules>[number];
type TimelineModuleMonthData = TimelineModule & {
  monthlyActivities?: PlanActivitySummary[];
  ksbCodesByMonth?: Record<string, string[]>;
};

function bookingEvent(review: PlanReview): LearnerCalendarEvent {
  return {
    ...review,
    type: review.source === 'mcr' ? 'coaching' : 'review',
    coachEmail: '',
    meetingProvider: 'teams',
    meetingLink: review.meetingLink || '',
    notes: '',
  };
}

/** Keep the monthly lecture action aligned with Attendance's recovery priority. */
function catchupAction(row: AttendanceLecture): string | null {
  if (row.status !== 'absent' || row.effectiveAttendance === 1) return null;
  const planOpen = Boolean(row.recovery?.calendarKey && (!row.recovery.ended || row.recovery.method === 'recorded')
    && row.catchupStatus !== 'missed');
  if (planOpen && row.recovery) {
    if (row.recovery.method === 'alternative') return null;
    return row.recovery.method === 'catch-up' ? 'Change catch-up' : 'Book catch-up';
  }
  if (row.catchupStatus === 'completed') return null;
  return row.recovery?.method === 'catch-up' && row.catchupStatus === 'pending' ? 'Change catch-up' : 'Book Catchup Session';
}

/** Weekly learning and monthly coaching share the dashboard above the linked module panels. */
export function TrainingPlanDetails({ data, subjects, kind, learnerId, onRefresh, refreshing = false,
  onRetryContract, initialSubjectId = '', initialMonth = '', canOpenActivities = true, weeklyFocus, programmeStartDate, programmeEndDate,
  activityOverviewOnly = false, timelineOnly = false, monthlyOnly = false, trainingOnly = false, overviewOnly = false,
  showOtjChart = true, programmeSnapshot }: Props) {
  const modules = useMemo(() => buildPlanModules(subjects, data), [subjects, data]);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const today = new Date(now).toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
  const thisMonth = today.slice(0, 7);
  const programmeStart = dateKey(programmeStartDate) || modules.map(module => dateKey(module.start)).filter(Boolean).sort()[0] || '';
  // The learner-detail bound can lag behind the current contract/activity
  // projection.  Keep it as a lower-priority bound when the payload already
  // contains a later valid month, so an absent URL month defaults to the real
  // current month instead of being clamped into stale history.
  const payloadEndMonths = [
    ...Object.keys(data.months),
    ...data.actual.map(row => row.month),
    ...data.reviews.map(review => reviewDate(review).slice(0, 7)),
  ].filter(month => /^\d{4}-(0[1-9]|1[0-2])$/.test(month));
  const payloadEnd = payloadEndMonths.sort().at(-1);
  const moduleEnd = modules.map(module => dateKey(moduleVisualEnd(module))).filter(Boolean).sort().at(-1);
  const programmeEnd = [dateKey(programmeEndDate), moduleEnd, payloadEnd ? `${payloadEnd}-28` : '']
    .filter(Boolean).sort().at(-1) || '';
  const minMonth = programmeStart.slice(0, 7);
  const maxMonth = programmeEnd.slice(0, 7);
  const clampMonth = (month: string) => {
    if (minMonth && month < minMonth) return minMonth;
    if (maxMonth && month > maxMonth) return maxMonth;
    return month;
  };
  const explicitMonth = /^\d{4}-(0[1-9]|1[0-2])$/.test(initialMonth) ? initialMonth : '';
  // An explicit URL month represents deliberate navigation. Bounds apply to
  // the implicit current-month default and to subsequent month controls, not
  // to a month the user requested directly.
  const initialSelectedMonth = explicitMonth || clampMonth(thisMonth);
  const [selectedMonth, setSelectedMonth] = useState(initialSelectedMonth);
  const [selectedId, setSelectedId] = useState(initialSubjectId);
  const [bookingReview, setBookingReview] = useState<PlanReview | null>(null);
  const [absenceLecture, setAbsenceLecture] = useState<AttendanceLecture | null>(null);
  const [catchupLecture, setCatchupLecture] = useState<AttendanceLecture | null>(null);
  const [catchupBooking, setCatchupBooking] = useState<LearnerCalendarEvent | null>(null);
  const [catchupBusy, setCatchupBusy] = useState(false);
  const [catchupError, setCatchupError] = useState('');
  const attendance = useLiveLearnerRead(kind, learnerId, monthlyOnly && canOpenActivities, fetchAttendanceWorkspace, peekAttendanceWorkspace);
  const monthData = (module: TimelineModule) => module as TimelineModuleMonthData;
  useEffect(() => {
    setSelectedMonth(current => {
      if (minMonth && current < minMonth) return minMonth;
      if (maxMonth && current > maxMonth) return maxMonth;
      return current;
    });
  }, [minMonth, maxMonth]);
  const selected = modules.find(module => module.id === selectedId)
    || modules.find(module => module.start && module.start.slice(0, 7) <= selectedMonth && module.end.slice(0, 7) >= selectedMonth);
  const sessions = uniquePlanSessions(modules);
  const metrics = monthMetrics(selectedMonth, modules, data);
  const month = data.months[selectedMonth];
  const monthSessions = sessions.filter(session => sessionDay(session.start).startsWith(selectedMonth));
  const attendanceForSession = (session: (typeof sessions)[number]) => attendance.data?.lectures.find(row =>
    row.source === 'microsoft-teams' && row.sessionId === `teams:${session.id}` && row.date === sessionDay(session.start));
  const openCatchup = (row: AttendanceLecture) => {
    setCatchupBooking(null);
    setCatchupError('');
    setCatchupLecture(row);
  };
  const closeCatchup = () => { setCatchupLecture(null); attendance.refresh(); };
  const saveCatchup = async () => {
    if (!catchupLecture?.absenceReport || !catchupBooking) return;
    setCatchupBusy(true);
    setCatchupError('');
    try {
      const response = await coachFetch(`/learner_api/session-catchup/${kind}/${learnerId}/`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reportId: catchupLecture.absenceReport.id, eventKey: catchupBooking.eventKey }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not link catch-up.');
      invalidateLearnerReads();
      closeCatchup();
    } catch (reason) { setCatchupError(reason instanceof Error ? reason.message : 'Could not link catch-up.'); }
    finally { setCatchupBusy(false); }
  };
  const monthReviews = data.reviews.filter(review => review.source !== 'student-support' && review.status !== 'cancelled' && reviewDate(review).startsWith(selectedMonth))
    .sort((a, b) => reviewDate(a).localeCompare(reviewDate(b)));
  const monthActivities = modules.flatMap(module => (monthData(module).monthlyActivities || []).map(activity => ({ module, activity })))
    .filter(item => item.activity.date.startsWith(selectedMonth))
    .sort((a, b) => a.activity.date.localeCompare(b.activity.date) || a.activity.title.localeCompare(b.activity.title));
  const monthAssignments = monthActivities.filter(({ activity }) => {
    return activity.type.toLowerCase().includes('assignment');
  });
  const exactMonthKsbCodes = modules.flatMap(module => monthData(module).ksbCodesByMonth?.[selectedMonth] || []);
  const monthKsbCodes = [...new Set(exactMonthKsbCodes.length ? exactMonthKsbCodes
    : modules.filter(module => module.dates.some(date => date.startsWith(selectedMonth))).flatMap(module => module.ksbCodes || []))].sort().slice(0, 4);
  const subjectHref = (id: string) => `/learner/modules/${kind}/${learnerId}?subject=${encodeURIComponent(id)}`;
  const assignmentHref = (moduleId: string, componentId?: string | null, weekTitle?: string | null) => componentId
    ? `/learner/component/${kind}/${learnerId}/${encodeURIComponent(componentId)}?week=${encodeURIComponent(weekTitle || '')}`
    : subjectHref(moduleId);
  const selectMonth = (key: string) => { if (!key) return; setSelectedMonth(clampMonth(key)); setSelectedId(''); };
  const shiftMonth = (step: number) => { const date = new Date(`${selectedMonth}-01T12:00:00Z`); date.setUTCMonth(date.getUTCMonth() + step); selectMonth(date.toISOString().slice(0, 7)); };
  const canGoPrevious = !minMonth || selectedMonth > minMonth;
  const canGoNext = !maxMonth || selectedMonth < maxMonth;
  const reviewStatus = (review: TrainingPlanDashboard['reviews'][number]) => ({ completed: 'Attended', scheduled: review.invited === false ? 'Booking pending' : 'Booked',
    'not-scheduled': reviewDate(review) && reviewDate(review) < today ? 'Overdue' : 'Not booked',
    'awaiting-signature': 'Awaiting signatures', 'in-progress': 'In progress' }[review.status] || 'Not booked');
  const lectureDetails = (session: (typeof sessions)[number]) => {
    const module = modules.find(m => m.moduleId === session.moduleId);
    const lecture = (module ? monthData(module).monthlyActivities || [] : [])
      .find(activity => activity.type === 'live_session' && activity.date === sessionDay(session.start));
    const moduleTitle = module?.title?.trim();
    const lectureTitle = lecture?.title?.trim();
    const sessionTitle = session.title?.trim();
    const displayTitle = lectureTitle || moduleTitle || sessionTitle || 'Live session';
    const tutor = module?.detail?.tutor_name || module?.detail?.coach_name || data.coach.name || 'Tutor';
    const sessionEnd = session.end ? Date.parse(session.end) : NaN;
    const isAvailable = !['cancelled', 'deleted', 'completed'].includes(session.status)
      && (Number.isFinite(sessionEnd) ? sessionEnd > now : Date.parse(session.start) > now);
    const attendLink = isAvailable && /^https?:\/\//i.test(session.joinUrl || '') ? session.joinUrl : null;
    return { lecture, displayTitle, tutor, isAvailable, attendLink };
  };
  // The learner's own review pages hold the form for the matching event.
  const reviewFormHref = (review: PlanReview) => {
    if (!review.reviewTemplateId && !review.reviewInstanceId) return null;
    const base = review.source === 'mcr' ? '/learner/monthly-coaching' : review.source === 'progress-review' ? '/learner/progress-reviews' : '';
    return base ? `${base}/${encodeURIComponent(review.eventKey || review.id)}?${new URLSearchParams({ kind, learner: learnerId })}` : null;
  };
  const clockTime = (value: string) => new Date(value).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });
  const difference = metrics.planned == null || metrics.actual == null ? null : metrics.actual - metrics.planned;
  const monthMetricCells: { label: string; value: number | null; tone?: string; icon: ReactNode }[] = [
    { label: 'Required hours', value: metrics.planned, icon: <Target size={20} /> },
    { label: 'Achieved hours', value: metrics.actual, tone: 'positive', icon: <Clock3 size={20} /> },
    { label: 'Difference', value: difference, tone: metrics.actual != null && metrics.planned != null && metrics.actual >= metrics.planned ? 'positive' : undefined, icon: difference != null && difference < 0 ? <TrendingDown size={20} /> : difference != null && difference > 0 ? <TrendingUp size={20} /> : <Equal size={20} /> },
  ];
  // Monthly Plan tab only (monthlyOnly): same data and actions as the section
  // below, laid out as the dashboard reference.
  const monthlyBoard = <section className={board.root} aria-label="Monthly study plan">
    <div className={board.header}>
      <div className={board.heading}><p>Monthly Focus</p><h2>{monthLabel(selectedMonth)}</h2></div>
      <div className={board.monthNav}>
        <button type="button" onClick={() => shiftMonth(-1)} disabled={!canGoPrevious}><ChevronLeft size={15} aria-hidden="true" />Previous month</button>
        <button type="button" onClick={() => shiftMonth(1)} disabled={!canGoNext}>Next month<ChevronRight size={15} aria-hidden="true" /></button>
      </div>
    </div>
    {!!month?.topics.length && <p className={board.topics}>{month.topics.join(' · ')}</p>}
    {data.contractStatus === 'loading' && <p role="status" className={board.hint}>Loading study hour targets…</p>}
    {data.contractStatus === 'unavailable' && <p role="status" className={board.hint}>Study hour targets could not be loaded. <button type="button" className={board.retry} onClick={onRetryContract}>Retry study hours</button></p>}
    <section className={`${board.card} ${board.metrics}`} aria-label="Progress this month">
      {monthMetricCells.map(cell => <div key={cell.label} className={board.metric}>
        <span className={board.metricRing} data-empty={cell.value == null || undefined} aria-hidden="true">{cell.value == null ? '--' : cell.icon}</span>
        <div><span>{cell.label}</span><strong data-tone={cell.value == null ? undefined : cell.tone}>{cell.value == null ? 'Not available' : `${cell.label === 'Difference' && cell.value > 0 ? '+' : ''}${hours(cell.value)} hrs`}</strong></div>
      </div>)}
      <div className={board.metric}>
        <span className={`${board.metricRing} ${board.metricIcon}`} aria-hidden="true"><GraduationCap size={20} /></span>
        <div><span>KSBs this month</span><div className={board.ksbs}>{monthKsbCodes.length ? monthKsbCodes.map(code => <span key={code}>{code}</span>) : <em>—</em>}</div></div>
      </div>
    </section>
    <div className={board.pair}>
      <section className={board.card} aria-label="Reviews this month">
        <h3 className={board.cardTitle}>Reviews this month</h3>
        <div className={board.reviewRows}>{monthReviews.length ? monthReviews.map(review => {
          const needsBooking = review.status === 'not-scheduled';
          const isBooked = ['scheduled', 'in-progress'].includes(review.status);
          const meetingLink = isBooked && /^https?:\/\//i.test(review.meetingLink || '') ? review.meetingLink : null;
          const timeNote = review.scheduledTime ? `${review.scheduledTime.slice(0, 5)} · UK time` : review.durationMinutes ? `${review.durationMinutes} min` : '';
          return <article key={review.eventKey} className={board.reviewRow} title={review.coachName || data.coach.name || undefined}>
            <span className={board.reviewDate}>{dateLabel(reviewDate(review))}</span>
            <span className={board.reviewTime}>{timeNote || '—'}</span>
            <span className={board.reviewTitle}>{review.title}</span>
            <span className={board.reviewState}>{canOpenActivities ? <>{reviewFormHref(review) && <Link className={board.outlineAction} to={reviewFormHref(review)!}>View form</Link>}{needsBooking ? <button type="button" className={board.pillAction} onClick={() => setBookingReview(review)}>Schedule</button>
              : meetingLink ? <a className={board.pillAction} href={meetingLink} target="_blank" rel="noopener noreferrer">Attend</a>
                : <State value={reviewStatus(review)} />}</> : <State value={reviewStatus(review)} />}</span>
          </article>;
        }) : <p className={board.empty}>No reviews planned for this month.</p>}</div>
      </section>
      <section className={board.card} aria-label="Assignments this month">
        <h3 className={board.cardTitle}>Assignments</h3>
        <div className={board.assignments}>{monthAssignments.length ? monthAssignments.slice(0, 2).map(({ module, activity }) => {
          const assignmentPercent = activity.completed ? 100 : 0;
          return <article key={`${module.id}:${activity.id}`} className={board.assignment}>
            <div className={board.assignmentHead}><span className={board.assignmentIcon}><FileText size={18} /></span><div><strong>{activity.title}</strong><small>{activity.weekTitle || module.title}</small></div></div>
            <div className={board.assignmentStats}>
              <div><span>Required hours</span><b>{hours(activity.expectedHours)} hrs</b></div>
              <div><span>Achieved hours</span><b>{activity.completed ? hours(activity.expectedHours) : '0'} hrs</b></div>
              <div className={board.assignmentProgress}><span>Progress</span><i role="img" aria-label={`${assignmentPercent}% complete`} style={{ '--assignment-progress': `${assignmentPercent}%` } as CSSProperties}><b>{assignmentPercent}%</b></i></div>
              {canOpenActivities ? <Link className={board.primaryAction} to={assignmentHref(module.id, activity.componentId, activity.weekTitle)}>{activity.completed ? 'View' : 'Start'}<ArrowRight size={15} aria-hidden="true" /></Link> : <State value={activity.completed ? 'Completed' : 'Not started'} />}
            </div>
          </article>;
        }) : <p className={board.empty}>No assignments found for this month.</p>}</div>
      </section>
    </div>
    <section className={board.card} aria-label="Lectures this month">
      <div className={board.cardHeader}><h3 className={board.cardTitle}>Lectures this month</h3>
        {canOpenActivities && selected && <Link className={board.viewAll} to={subjectHref(selected.id)} aria-label={`View all activities for ${monthLabel(selectedMonth)}`}>View all activities<ArrowRight size={15} aria-hidden="true" /></Link>}
      </div>
      {attendance.error && !attendance.data && <p role="alert" className={board.hint}>Absence actions could not load. <button type="button" className={board.retry} onClick={attendance.refresh}>Retry</button></p>}
      {monthSessions.length ? <div className={board.tableScroll}><table className={board.table}>
        <thead><tr><th scope="col">Date</th><th scope="col">Time</th><th scope="col">Session</th><th scope="col">Tutor</th><th scope="col">Duration</th>{canOpenActivities && <th scope="col"><span className={board.srOnly}>Join</span></th>}</tr></thead>
        <tbody>{monthSessions.slice(0, 3).map(session => {
          const { displayTitle, tutor, isAvailable, attendLink } = lectureDetails(session);
          const attendanceRow = attendanceForSession(session);
          const catchupLabel = attendanceRow ? catchupAction(attendanceRow) : null;
          return <tr key={session.id}>
            <td>{dateLabel(sessionDay(session.start))}</td>
            <td>{clockTime(session.start)}</td>
            <td>{displayTitle}</td>
            <td>{tutor}</td>
            <td>{session.minutes} min</td>
            {canOpenActivities && <td><div className={board.lectureActions}>
              {attendLink ? <a className={`${board.pillAction} ${board.attendAction}`} href={attendLink} target="_blank" rel="noopener noreferrer">Attend</a> : isAvailable ? <State value="Link pending" /> : null}
              {catchupLabel && attendanceRow ? <button type="button" className={`${board.pillAction} ${board.catchupAction}`} onClick={() => openCatchup(attendanceRow)}>{catchupLabel}</button>
                : attendanceRow?.status !== 'absent' && attendanceRow?.canReportAbsence && <button type="button" className={`${board.pillAction} ${board.absenceAction}`} onClick={() => setAbsenceLecture(attendanceRow)}>Report absence</button>}
            </div></td>}
          </tr>;
        })}</tbody>
      </table></div> : <p className={board.empty}>No lectures scheduled for this month.</p>}
    </section>
  </section>;
  const progressCharts = <ProgressCharts modules={modules} selected={selected} data={data} onModuleSelect={module => setSelectedId(module.id)}
    programmeStartMonth={minMonth} programmeEndMonth={maxMonth} programmeSnapshot={programmeSnapshot} showOtjChart={showOtjChart} />;
  // Off-the-job hours summary for the sidebar beside Monthly focus. Values come
  // from the same month-by-month source the OTJH chart below uses, so the card
  // agrees with it. Minimum required and Forecast are not carried by the learner
  // data path (only the coach caseload API has them) and render as unavailable.
  const otjMonths = useMemo(() => monthlyHours(data, minMonth, maxMonth), [data, minMonth, maxMonth]);
  const otjSubmitted = otjMonths.length && otjMonths.every(row => row.submitted != null) ? otjMonths.reduce((sum, row) => sum + row.submitted!, 0) : null;
  const otjCompleted = otjMonths.length && otjMonths.every(row => row.completed != null) ? otjMonths.reduce((sum, row) => sum + row.completed!, 0) : null;
  const otjPlanned = data.requiredOtjh ?? null;
  // Off-the-job hours only apply to apprenticeships; hide for commercial learners
  // and when the learner has no OTJH figures to show.
  const showOtjSummary = kind === 'apprenticeship' && (otjPlanned != null || otjSubmitted != null || otjCompleted != null);
  const otjSummaryCard = showOtjSummary
    ? <OtjHoursSummary plannedIlr={otjPlanned} submitted={otjSubmitted} completed={otjCompleted} minimumRequired={null} forecast={null} />
    : null;
  if (timelineOnly) {
    return <div className={`${styles.root} ${layout.root}`}>
      <ModuleTimeline canOpenActivities={canOpenActivities} data={data} modules={modules} kind={kind} learnerId={learnerId} today={today}
        programmeStartDate={programmeStartDate} detailsMode="overview" selectedMonth={selectedMonth} selectedId={selected?.id}
        onMonthChange={selectMonth} onModuleSelect={module => setSelectedId(module.id)} />
    </div>;
  }
  const showMonthly = !trainingOnly && !overviewOnly;
  const showTraining = !monthlyOnly && !overviewOnly;
  return <div className={`${styles.root} ${layout.root}`}>
    {!trainingOnly && <div className={`${layout.topRow} ${weeklyFocus && !monthlyOnly ? layout.withWeeklyFocus : ''} ${activityOverviewOnly ? layout.activityOverviewTopRow : ''} ${activityOverviewOnly && !showMonthly ? layout.overviewSingle : ''}`}
      data-layout="split">
      {activityOverviewOnly
        ? <div className={layout.activityOverviewMain}>{overviewOnly ? null : weeklyFocus}{progressCharts}</div>
        : !monthlyOnly ? weeklyFocus : null}
      {showMonthly && monthlyOnly && monthlyBoard}
      {showMonthly && !monthlyOnly && (() => { const monthlyFocusPanel = <section className={layout.engagement} aria-label="Monthly study plan">
        <div className={styles.panelHeading}><div className={layout.focusHeading}><p className={styles.eyebrow}>Monthly focus</p><h2>{monthLabel(selectedMonth)}</h2></div><div className={styles.controls}><button className={styles.iconButton} onClick={() => shiftMonth(-1)} disabled={!canGoPrevious} aria-label="Previous month"><ChevronLeft size={16} /></button><button className={styles.iconButton} onClick={() => shiftMonth(1)} disabled={!canGoNext} aria-label="Next month"><ChevronRight size={16} /></button></div></div>
        {!!month?.topics.length && <p className={styles.focusTitle}>{month.topics.join(' · ')}</p>}
        {data.contractStatus === 'loading' && <p role="status" className={styles.hint}>Loading study hour targets…</p>}
        {data.contractStatus === 'unavailable' && <p role="status" className={styles.hint}>Study hour targets could not be loaded. <button className={styles.secondary} onClick={onRetryContract}>Retry study hours</button></p>}
        <div className={layout.monthSections}>
          <section className={layout.monthBlock} aria-label="Progress this month">
            <div className={layout.monthBlockHeader}><div><h3>Progress this month</h3></div><span>Compared to your plan</span></div>
            <div className={layout.progressGrid}>
              {[
                ['Required hours', metrics.planned, ''],
                ['Achieved hours', metrics.actual, 'positive'],
                ['Difference', metrics.planned == null || metrics.actual == null ? null : metrics.actual - metrics.planned, metrics.actual != null && metrics.planned != null && metrics.actual >= metrics.planned ? 'positive' : ''],
              ].map(([label, value, tone]) => <div key={String(label)}><span>{label}</span><strong data-tone={tone || undefined}>{typeof value === 'number' && label === 'Difference' && value > 0 ? '+' : ''}{hours(value as number | null)} <small>hrs</small></strong></div>)}
              <div><span>KSBs this month</span><div className={layout.ksbMini}>{monthKsbCodes.length ? monthKsbCodes.map(code => <span key={code}>{code}</span>) : <em>—</em>}</div></div>
            </div>
          </section>

          <section className={layout.monthBlock} aria-label="Reviews this month">
            <div className={layout.monthBlockHeader}><div><h3>Reviews this month</h3><p>Schedule and attend your reviews</p></div></div>
            <div className={layout.compactRows}>{monthReviews.length ? monthReviews.map(review => {
              const needsBooking = review.status === 'not-scheduled';
              const isBooked = ['scheduled', 'in-progress'].includes(review.status);
              const meetingLink = isBooked && /^https?:\/\//i.test(review.meetingLink || '') ? review.meetingLink : null;
              return <article key={review.eventKey} className={layout.compactRow}>
                <span className={layout.rowIcon}><CalendarDays size={16} /></span>
                <strong>{dateLabel(reviewDate(review))}<small>{review.scheduledTime ? `${review.scheduledTime.slice(0, 5)} · UK time` : review.durationMinutes ? `${review.durationMinutes} min` : ''}</small></strong>
                <span>{review.coachName || data.coach.name || 'Coach'}</span>
                <span>{review.title}</span>
                {canOpenActivities ? needsBooking ? <button type="button" className={layout.rowAction} onClick={() => setBookingReview(review)}>Schedule</button>
                  : meetingLink ? <a className={layout.attendAction} href={meetingLink} target="_blank" rel="noopener noreferrer">Attend</a>
                    : <State value={reviewStatus(review)} /> : <State value={reviewStatus(review)} />}
              </article>;
            }) : <p className={styles.empty}>No reviews planned for this month.</p>}</div>
          </section>

          <section className={layout.monthBlock} aria-label="Assignments this month">
            <div className={layout.monthBlockHeader}><div><h3>Assignments</h3><p>Complete your assignments for this month</p></div></div>
            <div className={layout.compactRows}>{monthAssignments.length ? monthAssignments.slice(0, 2).map(({ module, activity }) => {
              const assignmentPercent = activity.completed ? 100 : 0;
              return <article key={`${module.id}:${activity.id}`} className={`${layout.compactRow} ${layout.assignmentRow}`}>
              <span className={layout.rowIcon}><FileText size={16} /></span>
              <strong>{activity.title}<small>{activity.weekTitle || module.title}</small></strong>
              <span>Required<br /><b>{hours(activity.expectedHours)} hrs</b></span>
              <span>Achieved<br /><b>{activity.completed ? hours(activity.expectedHours) : '0'} hrs</b></span>
              <div className={layout.assignmentProgress} aria-label={`${assignmentPercent}% complete`}>
                <span><i style={{ width: `${assignmentPercent}%` }} /></span><b>{assignmentPercent}%</b>
              </div>
              {canOpenActivities ? <Link className={layout.softAction} to={assignmentHref(module.id, activity.componentId, activity.weekTitle)}>{activity.completed ? 'View' : 'Start'}</Link> : <State value={activity.completed ? 'Completed' : 'Not started'} />}
            </article>;
            }) : <p className={styles.empty}>No assignments found for this month.</p>}</div>
          </section>

          <section className={layout.monthBlock} aria-label="Lectures this month">
            <div className={layout.monthBlockHeader}><div><h3>Lectures this month</h3><p>Your live and recorded lectures</p></div></div>
            <div className={layout.compactRows}>{monthSessions.length ? monthSessions.slice(0, 3).map(session => {
              const { lecture, displayTitle, tutor, isAvailable, attendLink } = lectureDetails(session);
              return <article key={session.id} className={layout.compactRow}>
                <span className={layout.rowIcon}><Video size={16} /></span>
                <strong>{sessionTime(session.start)}<small>{session.minutes} min</small></strong>
                <strong>{displayTitle}<small>{tutor}</small></strong>
                <div className={`${layout.ksbMini} ${layout.rowKsbs}`}>{lecture?.ksbCodes.length ? lecture.ksbCodes.slice(0, 3).map(code => <span key={code}>{code}</span>) : <em>—</em>}</div>
                {canOpenActivities && (attendLink ? <a className={layout.lectureAttendAction} href={attendLink} target="_blank" rel="noopener noreferrer">Attend</a>
                  : isAvailable ? <State value="Link pending" /> : <span className={layout.lectureUnavailable}>—</span>)}
              </article>;
            }) : <p className={styles.empty}>No lectures scheduled for this month.</p>}</div>
          </section>
        </div>
        {canOpenActivities && selected && <Link className={`${styles.textLink} ${layout.monthFooterLink}`} to={subjectHref(selected.id)}>View all activities for {monthLabel(selectedMonth)}<ArrowRight size={14} /></Link>}
      </section>; return otjSummaryCard ? <div className={layout.focusStack}>{monthlyFocusPanel}{otjSummaryCard}</div> : monthlyFocusPanel; })()}
    </div>}
    {showTraining && !activityOverviewOnly && <section id="training-plan-details" aria-label="Monthly learning and coaching">
    {!activityOverviewOnly && <>
    <div className={layout.toolbar}>
      <div className={layout.title}><h2>Your training plan</h2>{!trainingOnly && <a className={styles.textLink} href="#module-timeline">View full timeline<ArrowRight size={14} /></a>}</div>
      {!trainingOnly && <div className={layout.filters}>
        <label>Month<input aria-label="Focus month" type="month" min={minMonth || undefined} max={maxMonth || undefined} value={selectedMonth} onChange={event => selectMonth(event.target.value)} /></label>
        <label className={layout.moduleSelect}>Module<select aria-label="Focus module" value={selectedId} onChange={event => setSelectedId(event.target.value)}><option value="">Module for selected month</option>{modules.map(module => <option key={module.id} value={module.id}>{module.title}</option>)}</select></label>
        <button type="button" className={styles.iconButton} onClick={onRefresh} disabled={refreshing} aria-busy={refreshing} aria-label="Refresh monthly learning"><RefreshCw size={17} /></button>
      </div>}
    </div>
    {refreshing && <p role="status" className={layout.refreshing}>Refreshing your training plan…</p>}
    </>}
    <div className={`${layout.cards} ${activityOverviewOnly ? layout.activityOverviewCards : ''} ${trainingOnly ? layout.trainingCards : ''}`}>
      <div className={layout.learningVisuals}>
      {!activityOverviewOnly && <ModuleTimeline canOpenActivities={canOpenActivities} data={data} modules={modules} kind={kind} learnerId={learnerId} today={today}
        programmeStartDate={programmeStartDate} detailsMode="overview" selectedMonth={selectedMonth} selectedId={selected?.id} onMonthChange={selectMonth} onModuleSelect={module => setSelectedId(module.id)} />}
      {!trainingOnly && progressCharts}
      </div>
      {!activityOverviewOnly && <ModuleOverview module={selected} hasModules={modules.length > 0} coachName={data.coach.name}
        href={selected ? subjectHref(selected.id) : ""} canOpenActivities={canOpenActivities} showSchedule={!trainingOnly} />}
    </div>
    </section>}
    {canOpenActivities && bookingReview && <MeetingBookingDialog
      session={bookingEvent(bookingReview)}
      title={bookingReview.title}
      learner={{ kind, id: learnerId }}
      rules={null}
      onClose={() => setBookingReview(null)}
      onBooked={() => { setBookingReview(null); onRefresh(); }}
    />}
    {canOpenActivities && absenceLecture && <AbsenceReportDialog onClose={() => setAbsenceLecture(null)}>
      <AbsenceReportForm key={absenceLecture.id}
        preselectMatch={{ id: absenceLecture.id, dateIso: absenceLecture.date, title: absenceLecture.title }}
        onSubmitted={attendance.refresh} onCancel={() => setAbsenceLecture(null)}
        showGuidance={false} showHistory compact />
    </AbsenceReportDialog>}
    {canOpenActivities && catchupLecture && <AbsenceReportDialog title="Book Catchup Session" onClose={closeCatchup}>
      {catchupLecture.absenceReport ? <>
        <p className={attendanceStyles.catchupLectureTitle}>{catchupLecture.title} · {catchupLecture.date}</p>
        <CatchupBooking key={catchupLecture.id} lecture={{ ...catchupLecture, status: 'absent', dateIso: catchupLecture.date,
          sessionType: 'live_session', coach: catchupLecture.coach || '' }} selectedKey={catchupBooking?.eventKey || ''}
          onSelect={setCatchupBooking} onBusyChange={setCatchupBusy} standalone />
        {catchupError && <p role="alert">{catchupError}</p>}
        <button type="button" className={attendanceStyles.catchupDone} disabled={catchupBusy || !catchupBooking} onClick={() => void saveCatchup()}>Link catch-up to this absence</button>
        <button type="button" className={attendanceStyles.catchupDone} disabled={catchupBusy} onClick={closeCatchup}>Close</button>
      </> : <AbsenceReportForm key={catchupLecture.id} initialRecoveryMethod="catch-up"
        preselectMatch={{ id: catchupLecture.id, dateIso: catchupLecture.date, title: catchupLecture.title }}
        onSubmitted={closeCatchup} onCancel={closeCatchup} showGuidance={false} showHistory={false} compact />}
    </AbsenceReportDialog>}
  </div>;
}
