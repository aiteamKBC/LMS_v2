import { Link } from 'react-router-dom';
import { AppIcon } from '@/components/feature/AppIcon';
import { useCurriculumLiveTotals, type LiveTotalKey } from './useCurriculumLiveTotals';
import styles from './page.module.css';

const ENTITY_CARDS: { key: LiveTotalKey; label: string; source: string; href: string; icon: string }[] = [
  { key: 'modules', label: 'Modules', source: 'curriculum.modules', href: '/curriculum/modules', icon: 'ri-layout-4-line' },
  { key: 'cohorts', label: 'Cohorts', source: 'curriculum.cohorts', href: '/curriculum/cohorts', icon: 'ri-group-line' },
  { key: 'groups', label: 'Groups', source: 'curriculum.groups', href: '/curriculum/groups', icon: 'ri-team-line' },
  { key: 'sessions', label: 'Sessions', source: 'curriculum.live_sessions', href: '/curriculum/session-calendar', icon: 'ri-calendar-check-line' },
  { key: 'programmes', label: 'Programmes', source: 'curriculum.programmes', href: '/curriculum/programmes', icon: 'ri-book-open-line' },
];

export function LiveTotalsSection() {
  const { data, loading, refreshing, error, reload } = useCurriculumLiveTotals();
  return (
    <section aria-labelledby="curriculum-overview-title" aria-busy={refreshing}>
      <div className={styles.totalsHeading}>
        <div className={styles.overviewHeading}>
          <h2 id="curriculum-overview-title">Live totals</h2>
          <span className={styles.liveBadge}><span className={styles.statusDot} aria-hidden="true" />{data && error ? 'Last verified values' : 'Database counts'}</span>
        </div>
        <div className={styles.totalsTools}>
          <span className={styles.totalsExplanation}>Live records exclude deleted or archived parents, cancelled and superseded sessions.</span>
          <button type="button" onClick={() => { void reload(); }} disabled={refreshing} className={styles.refreshTotals} aria-label="Refresh live totals" title="Refresh totals from the database">
            <AppIcon className="ri-refresh-line" aria-hidden="true" />
          </button>
        </div>
      </div>
      {error && (
        <div className={styles.error} role="alert">
          {data ? 'Showing the last verified totals. Refresh failed: ' : 'Live totals are unavailable: '}{error}
          <button type="button" onClick={() => { void reload(); }} disabled={refreshing} className={styles.retry}>Retry live totals</button>
        </div>
      )}
      <div className={styles.metrics}>
        {ENTITY_CARDS.map(card => {
          const metric = data?.metrics[card.key];
          return (
            <Link key={card.key} to={card.href} className={styles.metricCard} aria-label={card.label + (metric ? ': ' + metric.active + ' of ' + metric.total : ': totals unavailable')}>
              <span className={styles.metricIcon}><AppIcon className={card.icon} aria-hidden="true" /></span>
              <span className={styles.metricBody}>
                <span className={styles.metricNumbers}>
                  <span className={styles.metricValue}>{metric ? metric.active.toLocaleString('en-GB') : '\u2014'}</span>
                  <span className={styles.metricTotal}>of {metric ? metric.total.toLocaleString('en-GB') : '\u2014'}</span>
                </span>
                <span className={styles.metricLabel}>{card.label}</span>
                <span className={styles.metricDetail}>live records only<span className={styles.metricSource}>{card.source}</span></span>
                <span className={styles.metricLink}>View {card.label.toLowerCase()}<AppIcon className="ri-arrow-right-line" aria-hidden="true" /></span>
              </span>
            </Link>
          );
        })}
      </div>
      {loading ? <p className={styles.totalsTimestamp} role="status">Loading verified database totals...</p> : data && <p className={styles.totalsTimestamp}>Last verified: <time dateTime={data.checkedAt}>{data.checkedAt.replace('T', ' ').replace(/\.\d+Z$/, 'Z').replace('Z', ' UTC')}</time>. The 'of' value includes all stored rows, including excluded records.</p>}
    </section>
  );
}
