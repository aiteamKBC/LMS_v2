import { Link } from 'react-router-dom';
import { ArrowRight, CalendarDays, Clock3, GraduationCap, Layers3, Target, Users, Video } from 'lucide-react';
import type { TimelineModule } from './model';
import { nextSession } from './model';
import { dateLabel, hours, Meter, moduleStatus, sessionTime, State } from './presentation';
import styles from './trainingPlan.module.css';
import layout from './TrainingPlanDetails.module.css';

type Props = { module?: TimelineModule; hasModules: boolean; coachName: string; href: string; canOpenActivities: boolean; now: number };
const activityLabels: Record<string, string> = {
  reading: 'Readings', video: 'Videos', podcast: 'Podcasts', audio: 'Audio activities', powerpoint: 'Presentations',
  quiz: 'Quizzes', reading_quiz: 'Readings & quizzes', assignment: 'Assignments', checkpoint: 'Checkpoints',
  reflection: 'Reflections', live_session: 'Live sessions', activity: 'Other activities',
};

export function ModuleOverview({ module, hasModules, coachName, href, canOpenActivities, now }: Props) {
  const detail = module?.detail;
  const upcoming = module ? nextSession(module.sessions, now) : null;
  const plannedSessions = detail?.sessions_number ?? module?.activityCounts.live_session;
  const nextSessionPlaceholder = module?.sessions.length ? 'No upcoming sessions' : plannedSessions === 0 ? 'No sessions planned' : 'Not booked yet';
  const timetable = [detail?.session_week_day, detail?.session_start_time
    ? `${detail.session_start_time}${detail.session_end_time ? `–${detail.session_end_time}` : ''}` : ''].filter(Boolean).join(' · ');
  const outcomes = detail?.learning_outcomes || [];
  const codes = module?.ksbCodes || [];
  return <section className={`${styles.panel} ${layout.overview}`} aria-label="Module overview">
    <div className={styles.panelHeading}>
      <div><p className={styles.eyebrow}>In focus</p><h2>Module overview</h2></div>
      {canOpenActivities && module && <Link className={styles.primary} to={href}>Go to module<ArrowRight size={15} /></Link>}
    </div>
    {module ? <>
      <h3 className={styles.overviewTitle}>{module.title}</h3>
      <State value={moduleStatus(module)} />
      {(detail?.programme_name || detail?.cohort_name || detail?.group_name) && <div className={layout.moduleContext}>
        {detail.programme_name && <p>{detail.programme_name}</p>}
        <div>{detail.cohort_name && <span>Cohort: {detail.cohort_name}</span>}{detail.group_name && <span>Group: {detail.group_name}</span>}</div>
      </div>}
      {detail?.description && <p className={layout.moduleDescription}>{detail.description}</p>}
      <dl className={`${styles.overviewStats} ${layout.moduleStats}`}>
        <div><CalendarDays size={18} /><dt>Start date</dt><dd>{module.start ? dateLabel(module.start) : 'To be confirmed'}</dd></div>
        <div><CalendarDays size={18} /><dt>Planned end</dt><dd>{module.end ? dateLabel(module.end) : 'To be confirmed'}</dd></div>
        <div><Layers3 size={18} /><dt>Teaching weeks</dt><dd>{detail?.weeks_number ?? (module.weeks || 'To be confirmed')}</dd></div>
        <div><Target size={18} /><dt>Planned OTJH</dt><dd>{detail?.total_otjh == null ? 'Not provided' : `${hours(detail.total_otjh)} hours`}<small>Module training plan</small></dd></div>
        <div><Video size={18} /><dt>{plannedSessions == null ? 'Live sessions' : 'Planned live sessions'}</dt>
          <dd>{plannedSessions ?? module.sessions.length}<small>{module.sessions.length} booked · {module.sessions.filter(session => session.attended === true).length} attended</small></dd></div>
        <div><Clock3 size={18} /><dt>Weekly timetable</dt><dd>{timetable || 'To be confirmed'}{detail?.session_start_time && <small>UK time</small>}</dd></div>
        <div><Users size={18} /><dt>Coach</dt><dd>{detail?.coach_name || coachName || 'To be assigned'}</dd></div>
        <div><GraduationCap size={18} /><dt>Tutor</dt><dd>{detail?.tutor_name || 'To be assigned'}</dd></div>
        <div><Clock3 size={18} /><dt>Hours recorded</dt><dd>{module.actual == null ? 'Unavailable' : `${hours(module.actual)} hours`}<small>Accepted study hours</small></dd></div>
        <div><Video size={18} /><dt>Next session</dt><dd>{upcoming ? sessionTime(upcoming.start) : nextSessionPlaceholder}{upcoming && <small>UK time</small>}</dd></div>
      </dl>
      {Object.keys(module.activityCounts).length > 0 && <div className={layout.moduleSection}>
        <h3>Learning activities <span>{module.activityCount}</span></h3>
        <ul className={layout.activityBreakdown}>{Object.entries(module.activityCounts).map(([type, count]) =>
          <li key={type}><span>{activityLabels[type] || type.replace(/[_-]/g, ' ')}</span><strong>{count}</strong></li>)}</ul>
      </div>}
      <div className={layout.moduleSection}>
        <h3>Knowledge, skills &amp; behaviours <span>{codes.length || ''}</span></h3>
        {codes.length ? <details className={layout.moduleDisclosure}>
          <summary>View {codes.length} mapped KSBs</summary>
          <div className={layout.ksbCodes}>{codes.map(code => <span key={code}>{code}</span>)}</div>
        </details> : <p className={styles.hint}>{module.ksbMappingMissing ? 'KSB mapping is not available yet.' : 'No KSBs mapped yet.'}</p>}
        {codes.length > 0 && module.ksbMappingMissing && <p className={styles.hint}>Some activities are still awaiting KSB mapping.</p>}
      </div>
      {outcomes.length > 0 && <details className={`${layout.moduleSection} ${layout.moduleDisclosure}`}>
        <summary>Learning outcomes ({outcomes.length})</summary>
        <ul>{outcomes.map(outcome => <li key={outcome}>{outcome}</li>)}</ul>
      </details>}
      <div className={`${styles.overviewProgress} ${layout.moduleProgress}`}>
        <div><span>Activity progress</span><strong>{module.progress}%</strong></div>
        <Meter value={module.progress} label="Selected module progress" />
        <p>{module.done} of {module.activityCount} activities completed · {Math.max(0, module.activityCount - module.done)} remaining</p>
      </div>
    </> : <p className={styles.empty}>{hasModules ? 'Choose a module above to see its details.' : 'Your modules will appear when they are assigned.'}</p>}
  </section>;
}
