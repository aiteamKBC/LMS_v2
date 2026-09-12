import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, BookOpen, CalendarDays, CheckCircle2, ChevronRight, Clock3, FileCheck2, Info, MessageSquare, RefreshCw, Target, TrendingUp, Video } from 'lucide-react';
import type { LearnerKind } from '@/api/learnerDetail';
import { overviewSchedule, overviewWeek } from '@/api/learnerOverview';
import { useLiveLearnerRead } from '@/hooks/useLiveLearnerRead';
import { dateLabel, ukDate, ukTime, upcomingItems, weekSessions, type UpcomingItem } from './overviewSchedule';
import styles from './OverviewLearningPanels.module.css';

const eventIcons = { live: Video, coaching: MessageSquare, review: TrendingUp, assignment: FileCheck2, checkpoint: CheckCircle2 };
const hours = (value: number | null | undefined) => value == null ? '—' : value > 0 && value < .01 ? '<0.01h' : `${new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2 }).format(value)}h`;

export function OverviewLearningPanels({ kind, learnerId }: { kind: LearnerKind; learnerId: string }) {
  const week = useLiveLearnerRead(kind, learnerId, true, overviewWeek.read, overviewWeek.peek);
  const schedule = useLiveLearnerRead(kind, learnerId, true, overviewSchedule.read, overviewSchedule.peek);
  const [selection, setSelection] = useState<{ latestId: string | null; subjectId: string } | null>(null);
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 30_000); return () => window.clearInterval(timer); }, []);
  const latestId = week.data?.latestModuleId || null;
  const selectedId = selection?.latestId === latestId ? selection.subjectId : latestId;
  const module = week.data?.modules.find(item => item.id === selectedId)
    || week.data?.modules.find(item => item.id === latestId) || week.data?.modules[0];
  const moduleId = module?.id.startsWith('current:') ? module.id.slice(8) : module ? schedule.data?.moduleLinks[module.id]?.id : undefined;
  const moduleIds = new Set([...(module?.moduleIds || []), ...(moduleId ? [moduleId] : [])]);
  const relevantSessions = moduleIds.size ? schedule.data?.sessions.filter(session => moduleIds.has(session.moduleId)) || []
    : [];
  const live = week.data ? weekSessions(relevantSessions, week.data.weekStart, week.data.weekEnd, now) : null;
  // Live sessions belong to the focused module, even while its week's lesson
  // list is empty. Coaching/reviews remain learner-wide.
  const upcoming = upcomingItems(schedule.data ? { ...schedule.data, sessions: relevantSessions } : null, week.data?.deadlines || [], now);
  const expected = week.data?.expectedHours;
  const modulesHref = `/learner/modules/${kind}/${learnerId}`;
  const calendarHref = `/learner/calendar?kind=${kind}&learner=${encodeURIComponent(learnerId)}`;
  const subjectHref = (subject?: string) => `${modulesHref}${subject ? `?subject=${encodeURIComponent(subject)}` : ''}`;
  const eventHref = (item: UpcomingItem) => item.eventKey ? `${calendarHref}&event=${encodeURIComponent(item.eventKey)}` : subjectHref(item.subjectId);
  const weekLabel = week.data ? `${dateLabel(week.data.weekStart)} – ${dateLabel(week.data.weekEnd)}` : 'Your weekly learning focus';

  return <div className={styles.grid}>
    <section className={`${styles.panel} ${styles.week}`} aria-labelledby="overview-this-week">
      <div className={styles.heading}><div><span className={styles.eyebrow}>Your learning focus</span><h2 id="overview-this-week">This week</h2><p>{weekLabel}</p></div><span className={styles.headingIcon}><BookOpen size={22} aria-hidden="true" /></span></div>
      {week.error && <ReadError label="This week could not refresh." retry={week.refresh} />}
      {week.loading ? <Loading label="Loading this week's activities…" /> : <>
        {!!week.data?.modules.length && <div className={styles.moduleHeading}>
          {week.data.modules.length > 1 ? <label className={styles.moduleSelect}>Module<select value={module?.id} onChange={event => setSelection({ latestId, subjectId: event.target.value })}>{week.data.modules.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
            : <h3>{module?.title}</h3>}
          {!!module?.weekLabels.length && <p className={styles.weekLabel}>{module.weekLabels.join(' · ')}</p>}
        </div>}
        {module && module.total > 0 ? <div className={styles.progressSection}><div className={styles.progressLabel}><span>{module.completed} of {module.total} activities complete</span><strong>{module.percent}%</strong></div><div className={styles.meter} role="progressbar" aria-label="This week's activity progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={module.percent ?? undefined}><span style={{ width: `${Math.min(100, Math.max(0, module.percent ?? 0))}%` }} /></div></div>
          : !week.error && <div className={styles.empty}><CalendarDays size={26} aria-hidden="true" /><div><h3>No activities scheduled this week</h3><p>You can still explore your modules and continue learning.</p></div></div>}
        <div className={styles.facts}>
          <div className={styles.fact}><span><Video size={16} aria-hidden="true" />Live session</span><strong>{schedule.loading ? 'Loading…' : schedule.error && !schedule.data ? 'Unavailable' : live ? `${dateLabel(ukDate(live.start))} · ${ukTime(live.start)}` : 'Not scheduled'}</strong>{live && <small>UK time</small>}</div>
          <div className={styles.fact}><span><Target size={16} aria-hidden="true" />KSBs covered</span><strong>{module?.ksbCodes.length ? module.ksbCodes.join(', ') : module?.total ? 'Not mapped yet' : '—'}</strong>{module?.ksbMappingMissing && <small>Some activity mappings are missing</small>}</div>
          <div className={styles.fact}><span><Clock3 size={16} aria-hidden="true" />OTJH this week</span><strong>{hours(week.data?.otjh.actual)} <span className={styles.divider}>/</span> {hours(expected)}</strong><small>Actual / expected · all modules this week</small></div>
        </div>
        {!!week.data?.missingExpectedHours && <p className={styles.note}><Info size={15} aria-hidden="true" />Some activities this week still need expected hours.</p>}
        {!!week.data?.otjh.undatedHistoricalRows && <p className={styles.note}><Info size={15} aria-hidden="true" />Some recorded hours still need an activity date.</p>}
        <div className={styles.weekFooter}><Link className={styles.primary} to={subjectHref(module?.id)}>Open learning activities<ArrowRight size={17} aria-hidden="true" /></Link><span>{module?.total ? `${module.total - module.completed} activities remaining` : 'Learn at your own pace'}</span></div>
      </>}
    </section>
    <section className={`${styles.panel} ${styles.upcoming}`} aria-labelledby="overview-upcoming">
      <div className={styles.heading}><div><span className={styles.eyebrow}>Plan ahead</span><h2 id="overview-upcoming">Upcoming</h2><p>Key dates ahead · UK time</p></div><Link className={styles.calendarLink} to={calendarHref} aria-label="Open your calendar"><CalendarDays size={21} /></Link></div>
      {schedule.error && <ReadError label="Your calendar could not refresh." retry={schedule.refresh} />}
      {week.error && <ReadError label="Assignment dates could not refresh." retry={week.refresh} />}
      {schedule.loading && !upcoming.length ? <Loading label="Loading upcoming dates…" /> : upcoming.length ? <ul className={styles.events}>{upcoming.map(item => {
        const Icon = eventIcons[item.type];
        return <li key={item.id}><Link className={styles.event} to={eventHref(item)}><span className={styles.eventIcon} data-type={item.type}><Icon size={18} aria-hidden="true" /></span><div className={styles.eventBody}><div className={styles.eventTitleRow}><span className={styles.eventTitle}>{item.title}</span><span className={styles.badge} data-planned={item.status === 'To book' || item.status === 'Booking pending'}>{item.status}</span></div><span className={styles.eventDate}>{dateLabel(item.date)}{item.time ? ` · ${item.time}` : ''}</span>{item.detail && <span className={styles.eventDetail}>With {item.detail}</span>}</div><ChevronRight size={16} className={styles.chevron} aria-hidden="true" /></Link></li>;
      })}</ul> : !schedule.error && <div className={styles.empty}><CalendarDays size={26} aria-hidden="true" /><div><h3>No upcoming dates yet</h3><p>Your sessions, coaching and assignment dates will appear here when planned.</p></div></div>}
      <Link className={styles.allDates} to={calendarHref}>View calendar<ArrowRight size={15} aria-hidden="true" /></Link>
    </section>
  </div>;
}

function Loading({ label }: { label: string }) {
  return <div className={styles.loading} role="status"><span /><span /><span /><p>{label}</p></div>;
}
function ReadError({ label, retry }: { label: string; retry: () => void }) {
  return <div className={styles.error} role="alert"><span>{label}</span><button onClick={retry}><RefreshCw size={14} aria-hidden="true" />Retry</button></div>;
}
