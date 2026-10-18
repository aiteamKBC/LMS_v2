import { useEffect, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ChevronLeft, ChevronRight, Clock3, Equal, FileText, GraduationCap, Target, TrendingDown, TrendingUp } from 'lucide-react';
import type { LearnerKind } from '@/api/learnerDetail';
import type { DashboardMonthlyPlan, MonthlyAbsenceAction } from '@/api/dashboardMonthly';
import type { LearnerCalendarEvent } from '@/api/learnerCalendar';
import { invalidateLearnerReads } from '@/api/learnerRead';
import { coachFetch } from '@/lib/coachFetch';
import { State } from '@/pages/learner/training-plan-timeline/presentation';
import styles from '@/pages/learner/training-plan-timeline/trainingPlan.module.css';
import board from '@/pages/learner/training-plan-timeline/MonthlyFocusBoard.module.css';
import layout from '@/pages/learner/training-plan-timeline/TrainingPlanDetails.module.css';
import attendanceStyles from '@/pages/learner/attendance/attendance.module.css';
import MeetingBookingDialog, { type MeetingBookingSession } from '@/pages/learner/reviews/MeetingBookingDialog';
import AbsenceReportDialog from '@/pages/learner/attendance/components/AbsenceReportDialog';
import AbsenceReportForm from '@/pages/learner/attendance/components/AbsenceReportForm';
import CatchupBooking from '@/pages/learner/attendance/components/CatchupBooking';

/** The existing Monthly board, driven directly by a selected-month projection. */
export function MonthlyPlanBoard({ payload, kind, learnerId, onRefresh, onMonthChange, refreshing, active = true }: {
  payload: DashboardMonthlyPlan; kind: LearnerKind; learnerId: string; onRefresh: () => void;
  refreshing: boolean; onMonthChange: (month: string) => void;
  active?: boolean;
}) {
  useEffect(() => {
    if (!active || refreshing) return;
    const deadline = Date.parse(payload.refreshAt);
    const timer = window.setTimeout(onRefresh, Math.min(Math.max(0, deadline - Date.now()), 2_147_483_647));
    return () => window.clearTimeout(timer);
  }, [payload.refreshAt, onRefresh, active, refreshing]);
  const canGoPrevious = !!payload.navigation.previous;
  const canGoNext = !!payload.navigation.next;
  const shiftMonth = (step: number) => { const month = step < 0 ? payload.navigation.previous : payload.navigation.next; if (month) onMonthChange(month); };
  const summary = payload.summary;
  const differenceIcons = { down: <TrendingDown size={20} />, up: <TrendingUp size={20} />, equal: <Equal size={20} /> };
  const monthMetricCells = [
    { label: 'Required hours', value: summary.requiredHours, icon: <Target size={20} />, tone: undefined },
    { label: 'Achieved hours', value: summary.achievedHours, tone: 'positive', icon: <Clock3 size={20} /> },
    { label: 'Difference', value: summary.difference, tone: summary.differenceTone ?? undefined, icon: differenceIcons[summary.differenceDirection] },
  ];
  const [bookingReview, setBookingReview] = useState<MeetingBookingSession | null>(null);
  const [absenceLecture, setAbsenceLecture] = useState<MonthlyAbsenceAction | null>(null);
  const [catchupLecture, setCatchupLecture] = useState<MonthlyAbsenceAction | null>(null);
  const [catchupBooking, setCatchupBooking] = useState<LearnerCalendarEvent | null>(null);
  const [catchupBusy, setCatchupBusy] = useState(false);
  const [catchupError, setCatchupError] = useState('');
  const openCatchup = (row: MonthlyAbsenceAction) => { setCatchupBooking(null); setCatchupError(''); setCatchupLecture(row); };
  const closeCatchup = () => { setCatchupLecture(null); onRefresh(); };
  const saveCatchup = async () => {
    if (!catchupLecture?.reportId || !catchupBooking) return;
    setCatchupBusy(true); setCatchupError('');
    try {
      const response = await coachFetch(`/learner_api/session-catchup/${kind}/${learnerId}/`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reportId: catchupLecture.reportId, eventKey: catchupBooking.eventKey }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not link catch-up.');
      invalidateLearnerReads(); closeCatchup();
    } catch (reason) { setCatchupError(reason instanceof Error ? reason.message : 'Could not link catch-up.'); }
    finally { setCatchupBusy(false); }
  };
  const monthlyBoard = <section className={board.root} aria-label="Monthly study plan">
    <div className={board.header}>
      <div className={board.heading}><p>Monthly Focus</p><h2>{payload.title}</h2></div>
      <div className={board.monthNav}>
        <button type="button" onClick={() => shiftMonth(-1)} disabled={!canGoPrevious}><ChevronLeft size={15} aria-hidden="true" />Previous month</button>
        <button type="button" onClick={() => shiftMonth(1)} disabled={!canGoNext}>Next month<ChevronRight size={15} aria-hidden="true" /></button>
      </div>
    </div>
    <section className={`${board.card} ${board.metrics}`} aria-label="Progress this month">
      {monthMetricCells.map(cell => <div key={cell.label} className={board.metric}>
        <span className={board.metricRing} data-empty={cell.value === 'Not available' || undefined} aria-hidden="true">{cell.value === 'Not available' ? '--' : cell.icon}</span>
        <div><span>{cell.label}</span><strong data-tone={cell.value === 'Not available' ? undefined : cell.tone}>{cell.value}</strong></div>
      </div>)}
      <div className={board.metric}>
        <span className={`${board.metricRing} ${board.metricIcon}`} aria-hidden="true"><GraduationCap size={20} /></span>
        <div><span>KSBs this month</span><div className={board.ksbs}>{summary.ksbs.length ? summary.ksbs.map(code => <span key={code}>{code}</span>) : <em>—</em>}</div></div>
      </div>
    </section>
    <div className={board.pair}>
      <section className={board.card} aria-label="Reviews this month">
        <h3 className={board.cardTitle}>Reviews this month</h3>
        <div className={board.reviewRows}>{payload.reviews.length ? payload.reviews.map(review => <article key={review.id} className={board.reviewRow} title={review.tooltip || undefined}>
          <span className={board.reviewDate}>{review.date}</span>
          <span className={board.reviewTime}>{review.time}</span>
          <span className={board.reviewTitle}>{review.title}</span>
          <span className={board.reviewState}>{review.formHref && <Link className={board.outlineAction} to={review.formHref}>View form</Link>}
            {review.booking ? <button type="button" className={board.pillAction} onClick={() => setBookingReview(review.booking)}>Schedule</button>
              : review.attendHref ? <a className={board.pillAction} href={review.attendHref} target="_blank" rel="noopener noreferrer">Attend</a>
                : <State value={review.status} />}</span>
        </article>) : <p className={board.empty}>No reviews planned for this month.</p>}</div>
      </section>
      <section className={board.card} aria-label="Assignments this month">
        <h3 className={board.cardTitle}>Assignments</h3>
        <div className={board.assignments}>{payload.assignments.length ? payload.assignments.map(assignment => <article key={assignment.id} className={board.assignment}>
          <div className={board.assignmentHead}><span className={board.assignmentIcon}><FileText size={18} /></span><div><strong>{assignment.title}</strong><small>{assignment.subtitle}</small></div></div>
          <div className={board.assignmentStats}>
            <div><span>Required hours</span><b>{assignment.requiredHours}</b></div>
            <div><span>Achieved hours</span><b>{assignment.achievedHours}</b></div>
            <div className={board.assignmentProgress}><span>Progress</span><i role="img" aria-label={assignment.progressLabel} style={{ '--assignment-progress': assignment.progress } as CSSProperties}><b>{assignment.progress}</b></i></div>
            <Link className={board.primaryAction} to={assignment.href}>{assignment.actionLabel}<ArrowRight size={15} aria-hidden="true" /></Link>
          </div>
        </article>) : <p className={board.empty}>No assignments found for this month.</p>}</div>
      </section>
    </div>
    <section className={board.card} aria-label="Lectures this month">
      <div className={board.cardHeader}><h3 className={board.cardTitle}>Lectures this month</h3>
        {payload.activitiesHref && <Link className={board.viewAll} to={payload.activitiesHref} aria-label={`View all activities for ${payload.title}`}>View all activities<ArrowRight size={15} aria-hidden="true" /></Link>}
      </div>
      {payload.lectures.length ? <div className={board.tableScroll}><table className={board.table}>
        <thead><tr><th scope="col">Date</th><th scope="col">Time</th><th scope="col">Session</th><th scope="col">Tutor</th><th scope="col">Duration</th><th scope="col"><span className={board.srOnly}>Join</span></th></tr></thead>
        <tbody>{payload.lectures.map(lecture => <tr key={lecture.id}>
          <td>{lecture.date}</td><td>{lecture.time}</td><td>{lecture.title}</td><td>{lecture.tutor}</td><td>{lecture.duration}</td>
          <td><div className={board.lectureActions}>
            {lecture.attendHref ? <a className={`${board.pillAction} ${board.attendAction}`} href={lecture.attendHref} target="_blank" rel="noopener noreferrer">Attend</a> : lecture.status ? <State value={lecture.status} /> : null}
            {lecture.absence && lecture.absenceAction && <button type="button" className={`${board.pillAction} ${lecture.absenceAction === 'catchup' ? board.catchupAction : board.absenceAction}`}
              onClick={() => lecture.absenceAction === 'catchup' ? openCatchup(lecture.absence!) : setAbsenceLecture(lecture.absence)}>{lecture.absenceLabel}</button>}
          </div></td>
        </tr>)}</tbody>
      </table></div> : <p className={board.empty}>No lectures scheduled for this month.</p>}
    </section>
  </section>;
  return <div className={`${styles.root} ${layout.root}`}>
    <div className={layout.topRow} data-layout="split">{monthlyBoard}</div>
    {bookingReview && <MeetingBookingDialog
      session={bookingReview}
      title={bookingReview.title}
      learner={{ kind, id: learnerId }}
      rules={null}
      onClose={() => setBookingReview(null)}
      onBooked={() => { setBookingReview(null); onRefresh(); }}
    />}
    {absenceLecture && <AbsenceReportDialog onClose={() => setAbsenceLecture(null)}>
      <AbsenceReportForm key={absenceLecture.id}
        preselectMatch={{ id: absenceLecture.id, dateIso: absenceLecture.date, title: absenceLecture.title }}
        onSubmitted={onRefresh} onCancel={() => setAbsenceLecture(null)}
        showGuidance={false} showHistory compact />
    </AbsenceReportDialog>}
    {catchupLecture && <AbsenceReportDialog title="Book Catchup Session" onClose={closeCatchup}>
      {catchupLecture.reportId ? <>
        <p className={attendanceStyles.catchupLectureTitle}>{catchupLecture.title} · {catchupLecture.date}</p>
        <CatchupBooking key={catchupLecture.id} lecture={{ id: catchupLecture.id, sessionId: catchupLecture.id, title: catchupLecture.title, status: 'absent', dateIso: catchupLecture.date,
          sessionType: 'live_session', coach: '', module: '', startTime: '', endTime: '' }} selectedKey={catchupBooking?.eventKey || ''}
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
