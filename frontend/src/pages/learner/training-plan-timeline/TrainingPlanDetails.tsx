import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ChevronLeft, ChevronRight, RefreshCw, Video } from 'lucide-react';
import type { TrainingPlanDashboard, PlanSession } from '@/api/trainingPlanDashboard';
import type { Subject } from '../my-learning/SubjectWorkspace';
import type { PlanSubjectSummary } from '@/api/learnerOverview';
import { buildPlanModules, monthMetrics, sessionDay, uniquePlanSessions } from './model';
import { hours, monthLabel, sessionTime, State } from './presentation';
import styles from './trainingPlan.module.css';
import layout from './TrainingPlanDetails.module.css';
import { ModuleTimeline } from './ModuleTimeline';
import { ProgrammeReviews } from './ProgrammeReviews';
import { ModuleOverview } from './ModuleOverview';

type Props = {
  data: TrainingPlanDashboard; subjects: (Subject | PlanSubjectSummary)[]; kind: string; learnerId: string;
  onRefresh: () => void; refreshing?: boolean; onRetryContract: () => void;
  initialSubjectId?: string; initialMonth?: string; canOpenActivities?: boolean;
};

/** The original three Training Plan panels, now hosted below the weekly dashboard. */
export function TrainingPlanDetails({ data, subjects, kind, learnerId, onRefresh, refreshing = false,
  onRetryContract, initialSubjectId = '', initialMonth = '', canOpenActivities = true }: Props) {
  const modules = useMemo(() => buildPlanModules(subjects, data), [subjects, data]);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const today = new Date(now).toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
  const thisMonth = today.slice(0, 7);
  const [selectedMonth, setSelectedMonth] = useState(/^\d{4}-(0[1-9]|1[0-2])$/.test(initialMonth) ? initialMonth : thisMonth);
  const [selectedId, setSelectedId] = useState(initialSubjectId);
  const [filter, setFilter] = useState('all');
  const cardsRef = useRef<HTMLDivElement>(null);
  const selected = modules.find(module => module.id === selectedId)
    || modules.find(module => module.start && module.start.slice(0, 7) <= selectedMonth && module.end.slice(0, 7) >= selectedMonth);
  const sessions = uniquePlanSessions(modules);
  const metrics = monthMetrics(selectedMonth, modules, data);
  const month = data.months[selectedMonth];
  const monthSessions = sessions.filter(session => sessionDay(session.start).startsWith(selectedMonth));
  const subjectHref = (id: string) => `/learner/modules/${kind}/${learnerId}?subject=${encodeURIComponent(id)}`;
  const selectMonth = (key: string) => { if (!key) return; setSelectedMonth(key); setSelectedId(''); };
  const selectModule = (module: typeof modules[number]) => {
    if (module.start && (selectedMonth < module.start.slice(0, 7) || selectedMonth > module.end.slice(0, 7))) {
      setSelectedMonth(module.start.slice(0, 7));
    }
    setSelectedId(module.id);
    cardsRef.current?.scrollIntoView({ block: 'start' });
  };
  const shiftMonth = (step: number) => { const date = new Date(`${selectedMonth}-01T12:00:00Z`); date.setUTCMonth(date.getUTCMonth() + step); selectMonth(date.toISOString().slice(0, 7)); };
  const sessionStatus = (session: PlanSession) => session.attended === true ? 'Attended' : session.attended === false ? 'Not attended' : Date.parse(session.start) > now ? 'Scheduled' : 'Attendance pending';
  const visibleSessions = monthSessions.filter(session => filter !== 'completed' || session.attended === true).filter(session => filter !== 'pending' || session.attended !== true);
  return <section id="training-plan-details" aria-label="Monthly learning and coaching" className={`${styles.root} ${layout.root}`}>
    <div className={layout.toolbar}>
      <div className={layout.title}><h2>Your training plan</h2><a className={styles.textLink} href="#module-timeline">View full timeline<ArrowRight size={14} /></a></div>
      <div className={layout.filters}>
        <label>Month<input aria-label="Focus month" type="month" value={selectedMonth} onChange={event => selectMonth(event.target.value)} /></label>
        <label className={layout.moduleSelect}>Module<select aria-label="Focus module" value={selectedId} onChange={event => setSelectedId(event.target.value)}><option value="">Module for selected month</option>{modules.map(module => <option key={module.id} value={module.id}>{module.title}</option>)}</select></label>
        <button type="button" className={styles.iconButton} onClick={onRefresh} disabled={refreshing} aria-busy={refreshing} aria-label="Refresh monthly learning"><RefreshCw size={17} /></button>
      </div>
    </div>
    {refreshing && <p role="status" className={layout.refreshing}>Refreshing your training plan…</p>}
    <div ref={cardsRef} className={`${styles.details} ${layout.cards}`}>
      <section className={`${styles.panel} ${layout.monthly}`} aria-label="Monthly study plan"><div className={styles.panelHeading}><div><p className={styles.eyebrow}>Monthly focus</p><h2>{monthLabel(selectedMonth)}</h2></div><div className={styles.controls}><button className={styles.iconButton} onClick={() => shiftMonth(-1)} aria-label="Previous month"><ChevronLeft size={16} /></button><button className={styles.iconButton} onClick={() => shiftMonth(1)} aria-label="Next month"><ChevronRight size={16} /></button></div></div>{!!month?.topics.length && <p className={styles.focusTitle}>{month.topics.join(' · ')}</p>}
        {data.contractStatus === 'loading' && <p role="status" className={styles.hint}>Loading study hour targets…</p>}
        {data.contractStatus === 'unavailable' && <p role="status" className={styles.hint}>Study hour targets could not be loaded. <button className={styles.secondary} onClick={onRetryContract}>Retry study hours</button></p>}
        <div className={`${styles.monthStats} ${layout.monthStats}`}>{[['Planned', metrics.planned], ['Completed', metrics.actual], ['Remaining', metrics.remaining], ['Weekly target', metrics.weekly]].map(([label, value]) => <div key={String(label)}><span>{label}</span><strong>{hours(value as number | null)} <small>hrs</small></strong></div>)}</div><div className={styles.listHeading}><span>{monthSessions.length} live sessions this month</span><select aria-label="Filter monthly sessions" value={filter} onChange={e => setFilter(e.target.value)}><option value="all">All sessions</option><option value="completed">Attended</option><option value="pending">Pending</option></select></div>
        <div className={`${styles.sessionList} ${layout.sessions}`}>{visibleSessions.length ? visibleSessions.map(session => { const module = modules.find(m => m.moduleId === session.moduleId); return <article key={session.id} className={styles.session}><div className={styles.sessionTitle}><Video size={16} /><strong>{session.title}</strong><State value={sessionStatus(session)} /></div><p>{sessionTime(session.start)} · UK time · {session.minutes} min</p><div className={styles.sessionActions}>{canOpenActivities && module && <Link to={subjectHref(module.id)}>View session materials<ArrowRight size={14} /></Link>}{canOpenActivities && session.joinUrl && Date.parse(session.start) > now && <a href={session.joinUrl} target="_blank" rel="noopener noreferrer">Join Teams</a>}</div></article>; }) : <p className={styles.empty}>No {filter === 'all' ? '' : `${filter} `}live sessions to show this month.</p>}</div>
        {canOpenActivities && selected && <Link className={styles.textLink} to={subjectHref(selected.id)}>View activities in {selected.title}<ArrowRight size={14} /></Link>}
      </section>
      <ProgrammeReviews reviews={data.reviews} coach={data.coach} kind={kind} learnerId={learnerId} today={today} />
      <ModuleOverview module={selected} hasModules={modules.length > 0} coachName={data.coach.name}
        href={selected ? subjectHref(selected.id) : ""} canOpenActivities={canOpenActivities} now={now} />
    </div>
    <ModuleTimeline canOpenActivities={canOpenActivities} data={data} modules={modules} kind={kind} learnerId={learnerId} today={today}
      selectedMonth={selectedMonth} selectedId={selected?.id} onMonthChange={selectMonth} onModuleSelect={module => setSelectedId(module.id)} />
  </section>;
}
