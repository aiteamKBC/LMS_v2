import { useId } from 'react';
import { cohortSegments, deliveryDateLabel, type deliveryWeek } from './deliveryDashboard';
import styles from './DeliveryWorkspace.module.css';

const number = new Intl.NumberFormat('en-GB');

export function CohortChart({ cohorts }: { cohorts: Array<{ status?: string }> }) {
  const id = useId().replace(/:/g, '');
  const segments = cohortSegments(cohorts);
  const total = cohorts.length;
  const active = segments[0].value;
  const circumference = 2 * Math.PI * 53;
  let preceding = 0;
  return <div className={styles.cohortChart}>
    <svg className={styles.donut} viewBox="0 0 150 150" role="img"
      aria-label={`Cohort status: ${segments.map(segment => `${segment.label} ${segment.value}`).join('; ')}; ${total} total`}>
      <defs><linearGradient id={`cohort-${id}`} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#b17aff" /><stop offset="100%" stopColor="#6531ab" />
      </linearGradient></defs>
      <circle cx="75" cy="75" r="68" fill="none" stroke="#d9c8ef" strokeWidth="1" strokeDasharray="2 5" />
      <circle cx="75" cy="75" r="53" fill="none" stroke="#ede6f6" strokeWidth="13" />
      <g transform="rotate(-90 75 75)">{segments.map(segment => {
        const length = total ? segment.value / total * circumference : 0;
        const offset = preceding;
        preceding += length;
        return segment.value > 0 && <circle key={segment.key} cx="75" cy="75" r="53" fill="none"
          stroke={segment.key === 'active' ? `url(#cohort-${id})` : segment.color} strokeWidth="13"
          strokeDasharray={`${length} ${circumference - length}`} strokeDashoffset={-offset} />;
      })}</g>
      <text x="75" y="76" textAnchor="middle" className={styles.donutValue}>{total ? Math.round(active / total * 100) : 0}%</text>
      <text x="75" y="94" textAnchor="middle" className={styles.donutCaption}>ACTIVE</text>
    </svg>
    <div className={styles.chartLegend}>
      {segments.map(segment => <div key={segment.key}><span><i style={{ background: segment.color }} />{segment.label}</span><strong>{number.format(segment.value)}</strong></div>)}
      <p>{number.format(total)} cohorts in total</p>
    </div>
  </div>;
}

export function ActivityChart({ activeGroups, totalGroups, activeModules, totalModules, modulesLoading, modulesError }: {
  activeGroups: number | null; totalGroups: number; activeModules: number | null; totalModules: number;
  modulesLoading: boolean; modulesError: string | null;
}) {
  const id = useId().replace(/:/g, '');
  const metrics = [
    { label: 'Active groups', count: activeGroups, total: totalGroups, color: '#168f9e', end: '#65d4db', definition: 'Groups with at least one active assigned module. The group status label does not decide teaching activity.' },
    { label: 'Active modules', count: activeModules, total: totalModules, color: '#7440bc', end: '#b684ee', definition: 'Uses the Module Builder rule: the module has started and its last tracked live session has not passed.' },
  ];
  return <div className={styles.activityChart}>
    {metrics.map((metric, index) => {
      const pending = modulesLoading;
      const unavailable = metric.count === null && !pending;
      const proportion = metric.total > 0 && metric.count !== null ? Math.min(1, metric.count / metric.total) : 0;
      return <div className={styles.activityMetric} key={metric.label}>
        <div className={styles.activityMetricHeading}><span title={metric.definition}>{metric.label}</span>
          <strong aria-label={`${metric.label} count`} style={{ color: metric.color }}>{pending ? 'Loading' : unavailable ? 'Unavailable' : number.format(metric.count!)}</strong>
        </div>
        {pending ? <div className={styles.metricSkeleton} role="status">Checking module activity…</div> : unavailable ? (
          <p className={styles.activityNote}>Activity could not be verified.</p>
        ) : <>
          <svg className={styles.activityTrack} viewBox="0 0 300 16" preserveAspectRatio="none" role="img"
            aria-label={`${metric.label}: ${metric.count} of ${metric.total} (${Math.round(proportion * 100)}%)`}>
            <defs><linearGradient id={`activity-${id}-${index}`}><stop offset="0%" stopColor={metric.end} /><stop offset="100%" stopColor={metric.color} /></linearGradient></defs>
            <rect x="0" y="4" width="300" height="8" rx="4" fill={`${metric.color}14`} />
            {proportion > 0 && <rect x="0" y="4" width={300 * proportion} height="8" rx="4" fill={`url(#activity-${id}-${index})`} />}
          </svg>
          <div className={styles.activityMetricFoot}><span>of {number.format(metric.total)} {index === 0 ? 'groups' : 'modules'}</span><span>{Math.round(proportion * 100)}% active</span></div>
        </>}
      </div>;
    })}
    {modulesError && <p className={styles.activityWarning} role="status">{modulesError}</p>}
  </div>;
}

export function WeeklySessionChart({ week }: { week: ReturnType<typeof deliveryWeek> }) {
  const id = useId().replace(/:/g, '');
  const maximum = Math.max(1, ...week.days.map(day => day.count));
  const points = week.days.map((day, index) => ({ x: 22 + index * 49, y: 88 - day.count / maximum * 58 }));
  const path = points.reduce((result, point, index) => {
    if (!index) return `M${point.x},${point.y}`;
    const previous = points[index - 1];
    const middle = (point.x + previous.x) / 2;
    return `${result} C${middle},${previous.y} ${middle},${point.y} ${point.x},${point.y}`;
  }, '');
  return <><svg viewBox="0 0 340 100" className={styles.weekChart} role="img"
    aria-label={`Live sessions by day: ${week.days.map(day => `${deliveryDateLabel(day.date)}: ${day.count}`).join('; ')}`}>
    <defs><linearGradient id={`week-${id}`} x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stopColor="#9870de" stopOpacity=".34" /><stop offset="100%" stopColor="#9870de" stopOpacity=".01" />
    </linearGradient></defs>
    {[30, 59, 88].map(y => <line key={y} x1="17" x2="323" y1={y} y2={y} stroke="#e9e1f2" strokeDasharray="3 4" />)}
    {week.count > 0 && <path d={`${path} L316,89 L22,89 Z`} fill={`url(#week-${id})`} />}
    <path d={path} fill="none" stroke={week.count ? '#8050c6' : '#c8b5dd'} strokeWidth={week.count ? 2.5 : 1.5} strokeDasharray={week.count ? undefined : '3 3'} />
    {points.map((point, index) => <g key={week.days[index].date}>
      <title>{deliveryDateLabel(week.days[index].date)}: {week.days[index].count} live sessions</title>
      <circle cx={point.x} cy={point.y} r="3.5" fill={week.days[index].count ? '#8050c6' : '#fff'} stroke={week.days[index].count ? '#fff' : '#c8b5dd'} strokeWidth="1.5" />
      {week.days[index].count > 0 && <text x={point.x} y={point.y - 10} textAnchor="middle" className={styles.pointValue}>{week.days[index].count}</text>}
    </g>)}
  </svg><div className={styles.weekLabels} aria-hidden="true">{week.days.map(day => (
    <span key={day.date} data-today={day.date === week.today || undefined}>{day.day}<strong>{day.number}</strong></span>
  ))}</div></>;
}
