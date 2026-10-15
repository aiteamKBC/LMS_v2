import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ChevronLeft, ChevronRight, Clock3, Equal, FileText, GraduationCap, RefreshCw, Target, TrendingDown, TrendingUp } from 'lucide-react';
import type { LearnerKind } from '@/api/learnerDetail';
import type { DashboardMonthlyPlan } from '@/api/dashboardMonthly';
import type { PlanReview } from '@/api/trainingPlanDashboard';
import type { LearnerCalendarEvent } from '@/api/learnerCalendar';
import type { AttendanceLecture } from '@/api/attendanceLectures';
import { attendanceWorkspaceForDisplay } from '@/api/attendanceLectures';
import { invalidateLearnerReads } from '@/api/learnerRead';
import { coachFetch } from '@/lib/coachFetch';
import { reviewDate, sessionDay } from '@/pages/learner/training-plan-timeline/model';
import { dateLabel, hours, monthLabel, State } from '@/pages/learner/training-plan-timeline/presentation';
import styles from '@/pages/learner/training-plan-timeline/trainingPlan.module.css';
import board from '@/pages/learner/training-plan-timeline/MonthlyFocusBoard.module.css';
import layout from '@/pages/learner/training-plan-timeline/TrainingPlanDetails.module.css';
import attendanceStyles from '@/pages/learner/attendance/attendance.module.css';
import MeetingBookingDialog from '@/pages/learner/reviews/MeetingBookingDialog';
import AbsenceReportDialog from '@/pages/learner/attendance/components/AbsenceReportDialog';
import AbsenceReportForm from '@/pages/learner/attendance/components/AbsenceReportForm';
import CatchupBooking from '@/pages/learner/attendance/components/CatchupBooking';

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

/** The existing Monthly board, driven directly by a selected-month projection. */
export function MonthlyPlanBoard({ payload, kind, learnerId, onRefresh, refreshing, onMonthChange }: {
  payload: DashboardMonthlyPlan; kind: LearnerKind; learnerId: string; onRefresh: () => void;
  refreshing: boolean; onMonthChange: (month: string) => void;
}) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 30_000); return () => window.clearInterval(timer); }, []);
  const today = new Date(now).toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
  const selectedMonth = payload.month;
  const month = { topics: payload.topics };
  const data = { contractStatus: payload.contractStatus, coach: { name: payload.coachName } };
  const canOpenActivities = true;
  const onRetryContract = onRefresh;
  const monthKsbCodes = payload.summary.ksbs;
  const monthReviews = payload.reviews;
  const monthAssignments = payload.assignments.map(row => ({ module: { id: row.moduleId, title: row.moduleTitle }, activity: row.activity }));
  const monthSessions = payload.lectures.map(row => row.session);
  const selected = payload.selectedSubjectId ? { id: payload.selectedSubjectId } : null;
  const canGoPrevious = !!payload.navigation.previous;
  const canGoNext = !!payload.navigation.next;
  const shiftMonth = (step: number) => { const month = step < 0 ? payload.navigation.previous : payload.navigation.next; if (month) onMonthChange(month); };
  const subjectHref = (id: string) => `/learner/modules/${kind}/${learnerId}?subject=${encodeURIComponent(id)}`;
  const assignmentHref = (moduleId: string, componentId?: string | null, weekTitle?: string | null) => componentId
    ? `/learner/component/${kind}/${learnerId}/${encodeURIComponent(componentId)}?week=${encodeURIComponent(weekTitle || '')}` : subjectHref(moduleId);
  const attendanceForSession = (session: (typeof monthSessions)[number]) => {
    const row = payload.lectures.find(row => row.session.id === session.id)?.attendance;
    // Match the canonical wire 'present' label to Attendance's established UI.
    return row ? attendanceWorkspaceForDisplay({ lectures: [row] } as Parameters<typeof attendanceWorkspaceForDisplay>[0]).lectures[0] : undefined;
  };
  const lectureDetails = (session: (typeof monthSessions)[number]) => {
    const row = payload.lectures.find(row => row.session.id === session.id)!;
    const sessionEnd = session.end ? Date.parse(session.end) : NaN;
    const isAvailable = !['cancelled', 'deleted', 'completed'].includes(session.status)
      && (Number.isFinite(sessionEnd) ? sessionEnd > now : Date.parse(session.start) > now);
    const attendLink = isAvailable && /^https?:\/\//i.test(session.joinUrl || '') ? session.joinUrl : null;
    return { displayTitle: row.title, tutor: row.tutor, isAvailable, attendLink };
  };
  const reviewStatus = (review: PlanReview) => ({ completed: 'Attended', scheduled: review.invited === false ? 'Booking pending' : 'Booked',
    'not-scheduled': reviewDate(review) && reviewDate(review) < today ? 'Overdue' : 'Not booked',
    'awaiting-signature': 'Awaiting signatures', 'in-progress': 'In progress' }[review.status] || 'Not booked');
  const reviewFormHref = (review: PlanReview) => {
    if (!review.reviewTemplateId && !review.reviewInstanceId) return null;
    const base = review.source === 'mcr' ? '/learner/monthly-coaching' : review.source === 'progress-review' ? '/learner/progress-reviews' : '';
    return base ? `${base}/${encodeURIComponent(review.eventKey || review.id)}?${new URLSearchParams({ kind, learner: learnerId })}` : null;
  };
  const clockTime = (value: string) => new Date(value).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });
  const metrics = { planned: payload.summary.requiredHours, actual: payload.summary.achievedHours };
  const difference = metrics.planned == null || metrics.actual == null ? null : metrics.actual - metrics.planned;
  const monthMetricCells: { label: string; value: number | null; tone?: string; icon: ReactNode }[] = [
    { label: 'Required hours', value: metrics.planned, icon: <Target size={20} /> },
    { label: 'Achieved hours', value: metrics.actual, tone: 'positive', icon: <Clock3 size={20} /> },
    { label: 'Difference', value: difference, tone: metrics.actual != null && metrics.planned != null && metrics.actual >= metrics.planned ? 'positive' : undefined, icon: difference != null && difference < 0 ? <TrendingDown size={20} /> : difference != null && difference > 0 ? <TrendingUp size={20} /> : <Equal size={20} /> },
  ];
  const [bookingReview, setBookingReview] = useState<PlanReview | null>(null);
  const [absenceLecture, setAbsenceLecture] = useState<AttendanceLecture | null>(null);
  const [catchupLecture, setCatchupLecture] = useState<AttendanceLecture | null>(null);
  const [catchupBooking, setCatchupBooking] = useState<LearnerCalendarEvent | null>(null);
  const [catchupBusy, setCatchupBusy] = useState(false);
  const [catchupError, setCatchupError] = useState('');
  const openCatchup = (row: AttendanceLecture) => { setCatchupBooking(null); setCatchupError(''); setCatchupLecture(row); };
  const closeCatchup = () => { setCatchupLecture(null); onRefresh(); };
  const saveCatchup = async () => {
    if (!catchupLecture?.absenceReport || !catchupBooking) return;
    setCatchupBusy(true); setCatchupError('');
    try {
      const response = await coachFetch(`/learner_api/session-catchup/${kind}/${learnerId}/`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reportId: catchupLecture.absenceReport.id, eventKey: catchupBooking.eventKey }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not link catch-up.');
      invalidateLearnerReads(); closeCatchup();
    } catch (reason) { setCatchupError(reason instanceof Error ? reason.message : 'Could not link catch-up.'); }
    finally { setCatchupBusy(false); }
  };
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
  return <div className={`${styles.root} ${layout.root}`}>
    <div className={layout.topRow} data-layout="split">{monthlyBoard}</div>
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
        onSubmitted={onRefresh} onCancel={() => setAbsenceLecture(null)}
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
