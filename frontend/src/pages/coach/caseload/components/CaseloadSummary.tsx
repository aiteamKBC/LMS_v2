import { AppIcon } from '@/components/feature/AppIcon';
import type { CaseloadCounts } from '../lib/attention';
import type { StatusFilter } from '../types';
import styles from '../caseload.module.css';

const cards = (counts: CaseloadCounts): Array<{ label: string; value: number; note: string; icon: string; tone: string; filter: StatusFilter }> => [
  { label: 'Total Learners', value: counts.total, note: 'Learners in your caseload', icon: 'ri-group-line', tone: 'brand', filter: 'all' },
  { label: 'On Track', value: counts.onTrack, note: 'Meeting current progress signals', icon: 'ri-checkbox-circle-fill', tone: 'positive', filter: 'on-track' },
  { label: 'Need Attention', value: counts.attention + counts.upcoming, note: 'Learners to review soon', icon: 'ri-error-warning-fill', tone: 'warning', filter: 'need-attention' },
  { label: 'At Risk', value: counts.critical, note: 'Learners requiring action', icon: 'ri-alert-fill', tone: 'critical', filter: 'at-risk' },
];

export function CaseloadSummary({ counts, value, onChange }: { counts: CaseloadCounts; value: StatusFilter; onChange: (value: StatusFilter) => void }) {
  return <section className={styles.summary} aria-label="Caseload summary">
    {cards(counts).map(card => <button key={card.label} type="button" className={styles.summaryCard} data-tone={card.tone} aria-pressed={value === card.filter} onClick={() => onChange(card.filter)}>
      <span className={styles.summaryIcon}><AppIcon name={card.icon} /></span>
      <div><p className={styles.summaryLabel}>{card.label}</p><p className={styles.summaryValue}>{card.value}</p><p className={styles.summaryNote}>{card.note}</p></div>
    </button>)}
  </section>;
}
