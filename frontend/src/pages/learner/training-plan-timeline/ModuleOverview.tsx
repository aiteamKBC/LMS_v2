import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';
import { ArrowRight, CalendarDays, Clock3, GraduationCap, Layers3, Target, Users, type LucideIcon } from 'lucide-react';
import type { TimelineModule } from './model';
import { dateLabel, hours, Meter, moduleStatus, State } from './presentation';
import styles from './trainingPlan.module.css';
import layout from './TrainingPlanDetails.module.css';

type Props = { module?: TimelineModule; hasModules: boolean; coachName: string; href: string; canOpenActivities: boolean };
const activityLabels: Record<string, string> = {
  reading: 'Readings', video: 'Videos', podcast: 'Podcasts', audio: 'Audio activities', powerpoint: 'Presentations',
  quiz: 'Quizzes', reading_quiz: 'Readings & quizzes', assignment: 'Assignments', checkpoint: 'Checkpoints',
  reflection: 'Reflections', live_session: 'Live sessions', activity: 'Other activities',
};

export function ModuleOverview({ module, hasModules, coachName, href, canOpenActivities }: Props) {
  const detail = module?.detail;
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
      <div className={layout.moduleIdentity}><h3 className={styles.overviewTitle}>{module.title}</h3><State value={moduleStatus(module)} /></div>
      {(detail?.programme_name || detail?.cohort_name || detail?.group_name) && <div className={layout.moduleContext}>
        {detail.programme_name && <p>{detail.programme_name}</p>}
        <div>{detail.cohort_name && <span>Cohort: {detail.cohort_name}</span>}{detail.group_name && <span>Group: {detail.group_name}</span>}</div>
      </div>}
      {detail?.description && <p className={layout.moduleDescription}>{detail.description}</p>}
      <div className={layout.overviewGroups}>
        <div className={layout.overviewGroup}><h3>Schedule</h3><dl className={layout.factGrid}>
          <OverviewFact icon={CalendarDays} label="Start date">{module.start ? dateLabel(module.start) : 'To be confirmed'}</OverviewFact>
          <OverviewFact icon={CalendarDays} label="Planned end">{module.end ? dateLabel(module.end) : 'To be confirmed'}</OverviewFact>
          <OverviewFact icon={Layers3} label="Teaching weeks">{detail?.weeks_number ?? (module.weeks || 'To be confirmed')}</OverviewFact>
          <OverviewFact icon={Clock3} label="Weekly timetable">{timetable || 'To be confirmed'}{detail?.session_start_time && <small>UK time</small>}</OverviewFact>
        </dl></div>
        <div className={layout.overviewGroup}><h3>People</h3><dl className={layout.factGrid}>
          <OverviewFact icon={Users} label="Coach">{detail?.coach_name || coachName || 'To be assigned'}</OverviewFact>
          <OverviewFact icon={GraduationCap} label="Tutor">{detail?.tutor_name || 'To be assigned'}</OverviewFact>
        </dl></div>
        <div className={layout.overviewGroup}><h3>Study hours</h3><dl className={layout.factGrid}>
          <OverviewFact icon={Target} label="Planned OTJH">{detail?.total_otjh == null ? 'Not provided' : `${hours(detail.total_otjh)} hours`}<small>Module training plan</small></OverviewFact>
          <OverviewFact icon={Clock3} label="Hours recorded">{module.actual == null ? 'Unavailable' : `${hours(module.actual)} hours`}<small>Accepted study hours</small></OverviewFact>
        </dl></div>
      </div>
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

function OverviewFact({ icon: Icon, label, children }: { icon: LucideIcon; label: string; children: ReactNode }) {
  return <div><Icon size={16} aria-hidden="true" /><dt>{label}</dt><dd>{children}</dd></div>;
}
