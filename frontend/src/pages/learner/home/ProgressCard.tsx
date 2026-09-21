import type { CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { BarChart3, BookOpen, CalendarCheck2, FileText, ListChecks } from 'lucide-react';
import type { HomeProgress, HomeProgressCount } from '@/api/learnerOverview';
import styles from './studentHome.module.css';

const numeric = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2 });
const hours = (value: number | null | undefined) => value == null ? '—' : `${numeric.format(value)} h`;
const day = (value: string) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T12:00:00Z`));

export function ProgressCard({ data, loading, error, refresh, dashboardHref }: {
  data?: HomeProgress; loading: boolean; error: string; refresh: () => void; dashboardHref: string;
}) {
  const progress = error ? undefined : data;
  const otjh = progress?.otjh;
  const percent = otjh?.percent ?? null;
  const actualArc = Math.min(100, Math.max(0, percent ?? 0));
  const submittedArc = otjh?.planned && otjh.submitted != null ? Math.min(100 - actualArc, otjh.submitted / otjh.planned * 100) : 0;
  const count = (value: HomeProgressCount | null | undefined) => value ? `${numeric.format(value.completed)} of ${numeric.format(value.total)}` : '—';
  const rows = [
    { icon: ListChecks, value: progress?.activities, label: 'Activities completed', href: '/learner/my-learning' },
    { icon: FileText, value: progress?.assignments, label: 'Assignments completed', href: '/learner/monthly-submission' },
    { icon: CalendarCheck2, value: progress?.lectures, label: 'Lectures attended', href: '/learner/attendance' },
    { icon: BookOpen, value: progress?.modules, label: 'Modules completed', href: '/learner/my-learning' },
  ];
  return <aside className={`${styles.card} ${styles.progress}`} aria-labelledby="home-progress-heading" aria-busy={loading}>
    <div className={styles.cardHeading}><h2 id="home-progress-heading"><BarChart3 aria-hidden="true"/>My Progress</h2><Link to={dashboardHref} aria-label="View all progress">View all</Link></div>
    <div className={styles.progressBody}>
      <div className={styles.progressSummary}>
        <div className={styles.ring} style={{ '--progress': `${actualArc}%`, '--submitted': `${actualArc + submittedArc}%` } as CSSProperties}
          role={percent == null ? undefined : 'progressbar'} aria-label="OTJ progress"
          aria-valuenow={percent == null ? undefined : Math.min(100, percent)} aria-valuemin={0} aria-valuemax={100}
          aria-valuetext={`Completed (Actual): ${hours(otjh?.actual)}; Submitted: ${hours(otjh?.submitted)}; Total Planned: ${hours(otjh?.planned)}`}>
          <span><span>{percent == null ? '—' : <>{numeric.format(percent)}<small>%</small></>}</span></span>
        </div>
        <strong>OTJ Progress</strong>
        <dl className={styles.hourLegend}>
          <div><dt><i className={styles.actualDot}/>Completed (Actual)</dt><dd>{hours(otjh?.actual)}</dd></div>
          <div><dt title="Assignment hours awaiting tutor review"><i className={styles.submittedDot}/>Submitted</dt><dd>{hours(otjh?.submitted)}</dd></div>
          <div><dt>Total Planned</dt><dd>{hours(otjh?.planned)}</dd></div>
        </dl>
      </div>
      <div className={styles.progressDetails}>
        <p className={styles.progressPeriod}>{progress?.period.start
          ? progress.period.start > progress.period.end ? <>Starts {day(progress.period.start)}</> : <>{day(progress.period.start)} – {day(progress.period.end)}</>
          : progress ? 'Start date unavailable' : 'Start date to this week'}</p>
        <ul>{rows.map((row, index) => <li key={row.label}>
          <Link to={row.href}><span className={styles.progressIcon}><row.icon aria-hidden="true"/></span>
            <span><strong>{count(row.value)}</strong> {row.label}{index === 3 && <> <small>Whole programme</small></>}</span>
          </Link>
        </li>)}</ul>
      </div>
    </div>
    {loading && !progress && <p className={styles.progressNote} role="status">Loading progress…</p>}
    {error && <p className={styles.progressNote} role="alert">Progress unavailable. <button onClick={refresh}>Try again</button></p>}
    {!loading && !error && !progress && <p className={styles.progressNote}>Progress will appear when your learning plan is available.</p>}
    {progress && !progress.period.start && <p className={styles.progressNote}>A programme start date is needed for activity, assignment and lecture totals.</p>}
    {!!progress?.undatedActivities && <p className={styles.progressNote}>{numeric.format(progress.undatedActivities)} undated activities excluded from period totals.</p>}
    {!!otjh?.missingPlannedActivities && <p className={styles.progressNote}>Planned hours missing for {numeric.format(otjh.missingPlannedActivities)} activities.</p>}
    {progress?.period.start && progress.lectures == null && <button className={styles.retry} onClick={refresh}>Retry lecture attendance</button>}
  </aside>;
}
