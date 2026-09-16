import styles from "./InclusionLoading.module.css";

export function InclusionLoading() {
  return <div className={styles.screen} role="status" aria-live="polite" aria-label="Opening Inclusion & Safeguarding">
    <div className={styles.content}>
      <div className={styles.emblem} aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6l-8-3Z"/><path d="m8 12 3 3 5-6"/></svg>
      </div>
      <h1>Inclusion &amp; Safeguarding</h1>
      <p>A moment for your wellbeing.</p>
      <div className={styles.dots} aria-hidden="true"><span/><span/><span/></div>
    </div>
  </div>;
}
