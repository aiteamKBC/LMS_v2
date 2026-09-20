import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CalendarDays, ChevronLeft, ChevronRight, FileText, RefreshCw, Video } from 'lucide-react';
import type { LearnerKind } from '@/api/learnerDetail';
import type { TrainingPlanDashboard, PlanReview } from '@/api/trainingPlanDashboard';
import type { LearnerCalendarEvent } from '@/api/learnerCalendar';
import type { Subject } from '../my-learning/SubjectWorkspace';
import type { PlanActivitySummary, PlanSubjectSummary } from '@/api/learnerOverview';
import { buildPlanModules, dateKey, monthMetrics, moduleVisualEnd, reviewDate, sessionDay, uniquePlanSessions } from './model';
import { dateLabel, hours, monthLabel, sessionTime, State } from './presentation';
import styles from './trainingPlan.module.css';
import layout from './TrainingPlanDetails.module.css';
import { ModuleTimeline } from './ModuleTimeline';
import { ModuleOverview } from './ModuleOverview';
import { ProgressCharts, type ProgrammeProgressSnapshot } from './ProgressCharts';
import MeetingBookingDialog from '../reviews/MeetingBookingDialog';

type Props = {
  data: TrainingPlanDashboard; subjects: (Subject | PlanSubjectSummary)[]; kind: LearnerKind; learnerId: string;
  onRefresh: () => void; refreshing?: boolean; onRetryContract: () => void;
  initialSubjectId?: string; initialMonth?: string; canOpenActivities?: boolean; weeklyFocus?: ReactNode;
  programmeStartDate?: string | null; programmeEndDate?: string | null;
  activityOverviewOnly?: boolean;
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

/** Weekly learning and monthly coaching share the dashboard above the linked module panels. */
export function TrainingPlanDetails({ data, subjects, kind, learnerId, onRefresh, refreshing = false,
  onRetryContract, initialSubjectId = '', initialMonth = '', canOpenActivities = true, weeklyFocus, programmeStartDate, programmeEndDate,
  activityOverviewOnly = false, programmeSnapshot }: Props) {
  const modules = useMemo(() => buildPlanModules(subjects, data), [subjects, data]);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const today = new Date(now).toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
  const thisMonth = today.slice(0, 7);
  const programmeStart = dateKey(programmeStartDate) || modules.map(module => dateKey(module.start)).filter(Boolean).sort()[0] || '';
  const programmeEnd = dateKey(programmeEndDate) || modules.map(module => dateKey(moduleVisualEnd(module))).filter(Boolean).sort().at(-1) || '';
  const minMonth = programmeStart.slice(0, 7);
  const maxMonth = programmeEnd.slice(0, 7);
  const clampMonth = (month: string) => {
    if (minMonth && month < minMonth) return minMonth;
    if (maxMonth && month > maxMonth) return maxMonth;
    return month;
  };
  const initialSelectedMonth = clampMonth(/^\d{4}-(0[1-9]|1[0-2])$/.test(initialMonth) ? initialMonth : thisMonth);
  const [selectedMonth, setSelectedMonth] = useState(initialSelectedMonth);
  const [selectedId, setSelectedId] = useState(initialSubjectId);
  const [bookingReview, setBookingReview] = useState<PlanReview | null>(null);
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
  return <div className={`${styles.root} ${layout.root}`}>
    <div className={`${layout.topRow} ${weeklyFocus ? layout.withWeeklyFocus : ''} ${activityOverviewOnly ? layout.activityOverviewTopRow : ''}`}
      data-layout="split">
      {weeklyFocus}
      <section className={layout.engagement} aria-label="Monthly study plan">
        <div className={styles.panelHeading}><div><p className={styles.eyebrow}>Monthly focus</p><h2>{monthLabel(selectedMonth)}</h2></div><div className={styles.controls}><button className={styles.iconButton} onClick={() => shiftMonth(-1)} disabled={!canGoPrevious} aria-label="Previous month"><ChevronLeft size={16} /></button><button className={styles.iconButton} onClick={() => shiftMonth(1)} disabled={!canGoNext} aria-label="Next month"><ChevronRight size={16} /></button></div></div>
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
            <div className={layout.compactRows}>{monthReviews.length ? monthReviews.slice(0, 2).map(review => {
              const needsBooking = review.status === 'not-scheduled';
              const isBooked = ['scheduled', 'in-progress'].includes(review.status);
              const meetingLink = isBooked && /^https?:\/\//i.test(review.meetingLink || '') ? review.meetingLink : null;
              return <article key={review.eventKey} className={layout.compactRow}>
                <span className={layout.rowIcon}><CalendarDays size={16} /></span>
                <strong>{dateLabel(reviewDate(review))}<small>{review.scheduledTime ? `${review.scheduledTime.slice(0, 5)} · UK time` : review.durationMinutes ? `${review.durationMinutes} min` : ''}</small></strong>
                <span>{review.coachName || data.coach.name || 'Coach'}</span>
                <span>{review.title}</span>
                {needsBooking ? <button type="button" className={layout.rowAction} onClick={() => setBookingReview(review)}>Schedule</button>
                  : meetingLink ? <a className={layout.attendAction} href={meetingLink} target="_blank" rel="noopener noreferrer">Attend</a>
                    : <State value={reviewStatus(review)} />}
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
              return <article key={session.id} className={layout.compactRow}>
                <span className={layout.rowIcon}><Video size={16} /></span>
                <strong>{sessionTime(session.start)}<small>{session.minutes} min</small></strong>
                <strong>{displayTitle}<small>{tutor}</small></strong>
                <div className={`${layout.ksbMini} ${layout.rowKsbs}`}>{lecture?.ksbCodes.length ? lecture.ksbCodes.slice(0, 3).map(code => <span key={code}>{code}</span>) : <em>—</em>}</div>
                {attendLink ? <a className={layout.lectureAttendAction} href={attendLink} target="_blank" rel="noopener noreferrer">Attend</a>
                  : isAvailable ? <State value="Link pending" /> : <span className={layout.lectureUnavailable}>—</span>}
              </article>;
            }) : <p className={styles.empty}>No lectures scheduled for this month.</p>}</div>
          </section>
        </div>
        {canOpenActivities && selected && <Link className={`${styles.textLink} ${layout.monthFooterLink}`} to={subjectHref(selected.id)}>View all activities for {monthLabel(selectedMonth)}<ArrowRight size={14} /></Link>}
      </section>
    </div>
    <section id="training-plan-details" aria-label={activityOverviewOnly ? 'Learner progress charts' : 'Monthly learning and coaching'}>
    {!activityOverviewOnly && <>
    <div className={layout.toolbar}>
      <div className={layout.title}><h2>Your training plan</h2><a className={styles.textLink} href="#module-timeline">View full timeline<ArrowRight size={14} /></a></div>
      <div className={layout.filters}>
        <label>Month<input aria-label="Focus month" type="month" min={minMonth || undefined} max={maxMonth || undefined} value={selectedMonth} onChange={event => selectMonth(event.target.value)} /></label>
        <label className={layout.moduleSelect}>Module<select aria-label="Focus module" value={selectedId} onChange={event => setSelectedId(event.target.value)}><option value="">Module for selected month</option>{modules.map(module => <option key={module.id} value={module.id}>{module.title}</option>)}</select></label>
        <button type="button" className={styles.iconButton} onClick={onRefresh} disabled={refreshing} aria-busy={refreshing} aria-label="Refresh monthly learning"><RefreshCw size={17} /></button>
      </div>
    </div>
    {refreshing && <p role="status" className={layout.refreshing}>Refreshing your training plan…</p>}
    </>}
    <div className={`${layout.cards} ${activityOverviewOnly ? layout.activityOverviewCards : ''}`}>
      <div className={layout.learningVisuals}>
      {!activityOverviewOnly && <ModuleTimeline canOpenActivities={canOpenActivities} data={data} modules={modules} kind={kind} learnerId={learnerId} today={today}
        programmeStartDate={programmeStartDate} detailsMode="overview" selectedMonth={selectedMonth} selectedId={selected?.id} onMonthChange={selectMonth} onModuleSelect={module => setSelectedId(module.id)} />}
      <ProgressCharts modules={modules} selected={selected} data={data} onModuleSelect={module => setSelectedId(module.id)}
        programmeStartMonth={minMonth} programmeEndMonth={maxMonth} programmeSnapshot={programmeSnapshot} />
      </div>
      {!activityOverviewOnly && <ModuleOverview module={selected} hasModules={modules.length > 0} coachName={data.coach.name}
        href={selected ? subjectHref(selected.id) : ""} canOpenActivities={canOpenActivities} />}
    </div>
    </section>
    {bookingReview && <MeetingBookingDialog
      session={bookingEvent(bookingReview)}
      title={bookingReview.title}
      learner={{ kind, id: learnerId }}
      rules={null}
      onClose={() => setBookingReview(null)}
      onBooked={() => { setBookingReview(null); onRefresh(); }}
    />}
  </div>;
}
