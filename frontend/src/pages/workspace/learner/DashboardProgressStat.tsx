import { Link } from 'react-router-dom';
import type { CSSProperties } from 'react';
import { AppIcon } from '@/components/feature/AppIcon';
import { ProgressBar } from '@/components/ui/ProgressMetric';
import styles from './Overview.module.css';

export function DashboardProgressStat({ href, label, value, summary, valueLabel = 'Current', targetValue, targetLabel = 'Target', percent, accent }: {
  href: string; label: string; value: string; summary: string; valueLabel?: string; targetValue?: string;
  targetLabel?: string; percent: number | null; accent: 'purple' | 'green' | 'yellow';
}) {
  const ringPercent = percent == null ? 0 : Math.min(100, Math.max(0, percent));
  const ringLabel = percent == null ? '—' : `${Number.isInteger(percent) ? percent : Number(percent.toFixed(1))}%`;
  const progressAccent = percent == null ? accent : percent < 50 ? 'red' : percent < 80 ? 'yellow' : 'green';
  return <Link to={href} aria-label={`Open ${label}`} data-accent={progressAccent} className={`group ${styles.metric}`}>
    <div className={styles.metricTop}>
      <span className={styles.metricRing} role="img" aria-label={`${label}: ${ringLabel}`} style={{ '--metric-progress': `${ringPercent}%` } as CSSProperties}>
        <span className={styles.metricRingValue}>{ringLabel}</span>
      </span>
      <div className={styles.metricBody}>
        <div className={styles.metricHeading}><p className={styles.metricLabel}>{label}</p></div>
        <p className={styles.metricDetail}>{summary}</p>
        <dl className={styles.metricA11yData}>
          <div><dt>{valueLabel}</dt><dd>{value}</dd></div>
          {targetValue != null && <div><dt>{targetLabel}</dt><dd>{targetValue}</dd></div>}
        </dl>
        <ProgressBar percent={percent} tone={styles.metricFill} className={styles.metricA11yProgress} />
      </div>
      <AppIcon aria-hidden="true" className={`ri-arrow-right-s-line ${styles.metricArrow}`} />
    </div>
  </Link>;
}
