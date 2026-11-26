import { formatReviewDate } from './employerDashboardData';
import { moduleDate } from './employerModuleTimelineData';
import styles from './EmployerPortalPage.module.css';

type Props = {
  start: string;
  end: string;
  today: string;
  learners: { name: string; percent: number | null }[];
};

const percentLabel = (value: number) => `${new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2 }).format(value)}%`;

export function EmployerModuleTimeline({ start, end, today, learners }: Props) {
  const first = moduleDate(start);
  const last = moduleDate(end);
  const current = moduleDate(today);
  const valid = first && last && current && first <= last;
  const duration = valid ? Date.parse(last) - Date.parse(first) : 0;
  const elapsed = valid ? duration === 0 ? (current < first ? 0 : 100)
    : Math.max(0, Math.min(100, (Date.parse(current) - Date.parse(first)) / duration * 100)) : null;
  const status = !valid ? 'Today position unavailable' : current < first ? 'Before start date'
    : current > last ? 'End date passed' : current === last ? 'Ends today' : current === first ? 'Starts today' : '';
  const available = learners.flatMap(({ name, percent }) => percent != null && Number.isFinite(percent)
    ? [{ name, percent: Math.max(0, Math.min(100, percent)) }] : []);

  return <div className={styles.moduleTimeline} role="group" aria-label="Module timeline"
    title={learners.length > 1 ? 'Earliest start and latest end across the selected learners. Learner markers show individual completion percentages.' : undefined}>
    <div className={styles.moduleTimelineToday}><span><i aria-hidden="true" />Today{current && <> · <time dateTime={current}>{formatReviewDate(current)}</time></>}</span></div>
    <p className={styles.moduleTimelineStatus} aria-hidden={status ? undefined : true}>{status}</p>
    <div className={styles.moduleTimelineTrack}>
      <div className={styles.moduleTimelineRail}>
        <span className={styles.moduleTimelineStart} aria-hidden="true" />
        <span className={styles.moduleTimelineEnd} aria-hidden="true" />
        {elapsed != null && <span className={styles.moduleTimelineNow} style={{ left: `${elapsed}%` }} role="img"
          aria-label={`Today: ${formatReviewDate(current)}, ${percentLabel(elapsed)} of module time elapsed${status ? `, ${status}` : ''}`}
          title={`Today · ${formatReviewDate(current)}${status ? ` · ${status}` : ''}`} />}
        {available.map(({ name, percent }, index) => <span key={index} className={styles.moduleTimelineLearner}
          style={{ left: `${percent}%` }} role="img" tabIndex={0} aria-label={`${name} progress: ${percentLabel(percent)}`}
          title={`${name} · ${percentLabel(percent)} completed`} />)}
      </div>
    </div>
    <dl className={styles.moduleDates}>
      <div><dt>Start date</dt><dd>{first ? <time dateTime={first}>{formatReviewDate(first)}</time> : 'Not recorded'}</dd></div>
      <div><dt>End date</dt><dd>{last ? <time dateTime={last}>{formatReviewDate(last)}</time> : 'Not recorded'}</dd></div>
    </dl>
    <p className={styles.moduleTimelineLegend}><i aria-hidden="true" /><span>{learners.length === 1
      ? `Learner progress · ${available.length ? percentLabel(available[0].percent) : 'Unavailable'}`
      : `Learner progress · ${available.length} of ${learners.length} recorded`}</span></p>
  </div>;
}
