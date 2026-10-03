import styles from './OtjHoursSummary.module.css';

export type OtjHoursSummaryProps = {
  /** Statutory minimum off-the-job requirement. Learner dashboard data does not
   *  carry this yet, so it is optional and shows the unavailable state when absent. */
  minimumRequired?: number | null;
  /** Planned hours from the training plan / ILR (requiredOtjh). */
  plannedIlr?: number | null;
  /** Hours submitted (recorded, awaiting acceptance). */
  submitted?: number | null;
  /** Hours completed (accepted). */
  completed?: number | null;
  /** Projected total. Not provided by the learner data path yet; optional. */
  forecast?: number | null;
};

const formatHours = (value: number | null | undefined) =>
  value == null || !Number.isFinite(value) ? '—' : `${Math.round(value)}h`;

/**
 * Five-tile off-the-job hours summary for the learner workspace. Tiles with no
 * value render the existing unavailable ("—") convention so the card degrades
 * gracefully when a measure is not available for the learner's data path.
 */
export function OtjHoursSummary({ minimumRequired, plannedIlr, submitted, completed, forecast }: OtjHoursSummaryProps) {
  const tiles: { label: string; value: number | null | undefined }[] = [
    { label: 'Minimum required', value: minimumRequired },
    { label: 'Planned (ILR)', value: plannedIlr },
    { label: 'Submitted', value: submitted },
    { label: 'Completed', value: completed },
    { label: 'Forecast', value: forecast },
  ];
  return <section className={styles.card} aria-label="Off-the-job hours summary">
    <header className={styles.header}>
      <p className={styles.eyebrow}>Whole programme</p>
      <h3 className={styles.title}>Off-the-job hours</h3>
    </header>
    <dl className={styles.tiles}>
      {tiles.map(tile => <div key={tile.label} className={styles.tile} data-empty={tile.value == null || !Number.isFinite(tile.value) || undefined}>
        <dt>{tile.label}</dt>
        <dd>{formatHours(tile.value)}</dd>
      </div>)}
    </dl>
  </section>;
}
