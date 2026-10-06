import type { ReactNode } from 'react';
import { calendarLabel, percentage, type ProgressCard } from './presentation';
import styles from './importedReview.module.css';

const number = (value: number | null, suffix = '') => value === null ? 'Not recorded' : `${Math.round(value).toLocaleString('en-GB')}${suffix}`;
const clamp = (n: number) => Math.min(100, Math.max(0, n));

function Bar({ value, target, label }: { value: number | null; target?: number | null; label: string }) {
  return <div className={styles.bar} role="img" aria-label={`${label}: ${number(value, '%')}${target != null ? `; target ${number(target, '%')}` : ''}`}>
    <span style={{ width: `${clamp(value ?? 0)}%` }} />
    {target != null && <i style={{ left: `${clamp(target)}%` }} />}
  </div>;
}

function Metrics({ entries }: { entries: [string, number | null][] }) {
  return <dl className={styles.metrics}>{entries.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{number(value)}</dd></div>)}</dl>;
}

function Timeline({ dates }: { dates: Extract<ProgressCard, { kind: 'timeline' }>['dates'] }) {
  // Date.UTC is used only for relative placement of supplied calendar components.
  const ordinal = (value: string) => Date.UTC(Number(value.slice(0, 4)), Number(value.slice(5, 7)) - 1, Number(value.slice(8, 10)));
  const start = dates.find(date => date.label === 'Programme start');
  const end = dates.find(date => date.label === 'Apprenticeship end');
  const snapshot = dates.find(date => date.label === 'Review snapshot');
  const elapsed = start && end && snapshot ? percentage(ordinal(snapshot.value) - ordinal(start.value), ordinal(end.value) - ordinal(start.value)) : null;
  return <article className={styles.card}><h4>Programme timeline</h4>
    {dates.length ? <><Bar label="Programme time elapsed at review snapshot" value={elapsed} />
      <ol className={styles.timeline}>{dates.map(date => <li key={date.label}><span className={styles.timelineDot} aria-hidden="true" /><span>{date.label}<strong>{calendarLabel(date.value)}</strong></span></li>)}</ol>
      {snapshot && <p className={styles.note}>Dates reflect the saved review snapshot.</p>}</>
      : <p className={styles.note}>Programme dates were not recorded in this review.</p>}
  </article>;
}

export function ImportedProgressCards({ cards, renderUnknown }: { cards: ProgressCard[]; renderUnknown: (value: unknown) => ReactNode }) {
  if (!cards.length) return <p className={styles.note}>Learning progress details are unavailable for this review.</p>;
  return <div className={styles.cards}>{cards.map((card, index) => {
    if (card.kind === 'timeline') return <Timeline key={index} dates={card.dates} />;
    if (card.kind === 'activities') {
      const pct = percentage(card.completed, card.total);
      return <article key={index} className={styles.card}><h4>Learning Plan Activities</h4><div className={styles.activities}>
        <svg viewBox="0 0 120 120" role="img" aria-label={`${number(card.completed)} completed of ${number(card.total)} activities`}>
          <circle cx="60" cy="60" r="48" fill="none" stroke="#ede7f5" strokeWidth="9" />
          {pct !== null && <circle cx="60" cy="60" r="48" fill="none" stroke="#6d3db4" strokeWidth="9" strokeLinecap="round" pathLength="100" strokeDasharray={`${clamp(pct)} 100`} transform="rotate(-90 60 60)" />}
          <text x="60" y="58" textAnchor="middle" className={styles.ringValue}>{card.completed === null ? '—' : number(card.completed)}</text>
          <text x="60" y="77" textAnchor="middle" className={styles.ringTotal}>of {card.total === null ? '—' : number(card.total)}</text>
        </svg>
        <Metrics entries={[["Completed", card.completed], ["Submitted", card.submitted], ["Remaining", card.remaining], ["Target", card.target]]} />
      </div></article>;
    }
    if (card.kind === 'standard') {
      const current = percentage(card.current, card.max), target = percentage(card.target, card.max);
      return <article key={index} className={styles.card}><h4>Standard / Programme Progress</h4><p className={styles.standardTitle}>{card.title}</p>
        <div className={styles.metricHeading}><strong>{number(current, '%')}</strong>{card.status && <span className={styles.badge}>{card.status}</span>}</div>
        <Bar label={card.title} value={current} target={target} />
        <p className={styles.note}>Target: {number(target, '%')}</p>
      </article>;
    }
    if (card.kind === 'hours') return <article key={index} className={styles.card}><h4>Off-The-Job Hours</h4>
      <div className={styles.metricHeading}><span>Overall progress</span><strong>{number(card.percentage, '%')}</strong></div>
      <Bar label="Off-the-job hours" value={card.percentage} />
      <dl className={styles.hours}>{([['Minimum required', card.minimum], ['Planned hours (ILR)', card.planned], ['Completed', card.completed], ['Forecast', card.forecast]] as [string, number | null][]).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{number(value, 'h')}</dd></div>)}</dl>
    </article>;
    return <article key={index} className={styles.card}><h4>Additional progress information</h4>{renderUnknown(card.value)}</article>;
  })}</div>;
}
