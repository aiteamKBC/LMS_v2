import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, BookOpen, CalendarDays, Clock3, Info, RefreshCw, Target, Video } from 'lucide-react';
import type { LearnerKind } from '@/api/learnerDetail';
import { overviewSchedule, overviewWeek } from '@/api/learnerOverview';
import { useLiveLearnerRead } from '@/hooks/useLiveLearnerRead';
import { dateLabel, ukDate, ukTime, weekSessions } from './overviewSchedule';
import styles from './OverviewLearningPanels.module.css';

const hours = (value: number | null | undefined) => value == null ? '—' : value > 0 && value < .01 ? '<0.01h' : `${new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2 }).format(value)}h`;

export function OverviewLearningPanels({ kind, learnerId }: { kind: LearnerKind; learnerId: string }) {
  const week = useLiveLearnerRead(kind, learnerId, true, overviewWeek.read, overviewWeek.peek);
  const schedule = useLiveLearnerRead(kind, learnerId, true, overviewSchedule.read, overviewSchedule.peek);
  const [selection, setSelection] = useState<{ weekKey: string; subjectId: string } | null>(null);
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 30_000); return () => window.clearInterval(timer); }, []);
  const weekKey = `${kind}:${learnerId}:${week.data?.weekStart}:${week.data?.weekEnd}`;
  const weeklyModules = week.data?.modules.filter(item => item.total > 0) || [];
  const selectedId = selection?.weekKey === weekKey ? selection.subjectId : null;
  const module = weeklyModules.find(item => item.id === selectedId) || weeklyModules[0];
  const planSubject = module && (week.data?.planSubjects || []).find(subject => subject.id === module.id
    || subject.moduleIds.some(id => module.moduleIds?.includes(id)));
  const moduleKsbFallback = !module?.ksbCodes.length && !!planSubject?.ksbCodes?.length;
  const displayedKsbCodes = module?.ksbCodes.length ? module.ksbCodes : planSubject?.ksbCodes || [];
  const moduleId = module?.id.startsWith('current:') ? module.id.slice(8) : module ? schedule.data?.moduleLinks[module.id]?.id : undefined;
  const moduleIds = new Set([...(module?.moduleIds || []), ...(moduleId ? [moduleId] : [])]);
  const relevantSessions = moduleIds.size ? schedule.data?.sessions.filter(session => moduleIds.has(session.moduleId)) || []
    : [];
  const live = week.data ? weekSessions(relevantSessions, week.data.weekStart, week.data.weekEnd, now) : null;
  const expected = week.data?.expectedHours;
  const modulesHref = `/learner/modules/${kind}/${learnerId}`;
  const subjectHref = (subject?: string) => `${modulesHref}${subject ? `?subject=${encodeURIComponent(subject)}` : ''}`;
  const weekLabel = week.data ? `${dateLabel(week.data.weekStart)} – ${dateLabel(week.data.weekEnd)}` : 'Your weekly learning focus';

  return <div className={styles.grid}>
    <section className={`${styles.panel} ${styles.week}`} aria-labelledby="overview-this-week">
      <div className={styles.heading}><div><span className={styles.eyebrow}>Your learning focus</span><h2 id="overview-this-week">This week</h2><p>{weekLabel}</p></div><span className={styles.headingIcon}><BookOpen size={22} aria-hidden="true" /></span></div>
      {week.error && <ReadError label="This week could not refresh." retry={week.refresh} />}
      {schedule.error && <ReadError label="Your live sessions could not refresh." retry={schedule.refresh} />}
      {week.loading ? <Loading label="Loading this week's activities…" /> : <>
        {!!weeklyModules.length && <div className={styles.moduleHeading}>
          {weeklyModules.length > 1 ? <label className={styles.moduleSelect}>Module<select value={module?.id} onChange={event => setSelection({ weekKey, subjectId: event.target.value })}>{weeklyModules.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
            : <h3>{module?.title}</h3>}
          {!!module?.weekLabels.length && <p className={styles.weekLabel}>{module.weekLabels.join(' · ')}</p>}
        </div>}
        {module && module.total > 0 ? <div className={styles.progressSection}><div className={styles.progressLabel}><span>{module.completed} of {module.total} activities complete</span><strong>{module.percent}%</strong></div><div className={styles.meter} role="progressbar" aria-label="This week's activity progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={module.percent ?? undefined}><span style={{ width: `${Math.min(100, Math.max(0, module.percent ?? 0))}%` }} /></div></div>
          : !week.error && <div className={styles.empty}><CalendarDays size={26} aria-hidden="true" /><div><h3>No activities scheduled this week</h3><p>You can still explore your modules and continue learning.</p></div></div>}
        <div className={styles.facts}>
          <div className={styles.fact}><span><Video size={16} aria-hidden="true" />Live session</span><strong>{schedule.loading ? 'Loading…' : schedule.error && !schedule.data ? 'Unavailable' : live ? `${dateLabel(ukDate(live.start))} · ${ukTime(live.start)}` : 'Not scheduled'}</strong>{live && <small>UK time</small>}</div>
          <div className={styles.fact}><span><Target size={16} aria-hidden="true" />KSBs covered</span><strong title={displayedKsbCodes.join(', ') || undefined}>{displayedKsbCodes.length ? displayedKsbCodes.join(', ') : module?.total ? 'Not mapped yet' : '—'}</strong>
            {moduleKsbFallback ? <small>Module-level mapping · this week's activities have no direct KSB mapping</small>
              : module?.ksbMappingMissing && <small>Some activity mappings are missing</small>}</div>
          <div className={styles.fact}><span><Clock3 size={16} aria-hidden="true" />OTJH this week</span><strong>{hours(week.data?.otjh.actual)} <span className={styles.divider}>/</span> {hours(expected)}</strong><small>Actual / expected · all modules this week</small></div>
        </div>
        {!!week.data?.missingExpectedHours && <p className={styles.note}><Info size={15} aria-hidden="true" />Some activities this week still need expected hours.</p>}
        {!!week.data?.otjh.undatedHistoricalRows && <p className={styles.note}><Info size={15} aria-hidden="true" />Some recorded hours still need an activity date.</p>}
        <div className={styles.weekFooter}><Link className={styles.primary} to={subjectHref(module?.id)}>Open learning activities<ArrowRight size={17} aria-hidden="true" /></Link><span>{module?.total ? `${module.total - module.completed} activities remaining` : 'Learn at your own pace'}</span></div>
      </>}
    </section>
  </div>;
}

function Loading({ label }: { label: string }) {
  return <div className={styles.loading} role="status"><span /><span /><span /><p>{label}</p></div>;
}
function ReadError({ label, retry }: { label: string; retry: () => void }) {
  return <div className={styles.error} role="alert"><span>{label}</span><button onClick={retry}><RefreshCw size={14} aria-hidden="true" />Retry</button></div>;
}
