import { useId } from 'react';
import styles from './ExtraActivityInfo.module.css';

/** Native disclosure works with keyboard, touch and screen readers. */
export function ExtraActivityInfo() {
  const id = useId();
  return <details className={styles.info}>
    <summary aria-controls={id}>
      <span aria-hidden="true">ⓘ </span>About Extra activities
    </summary>
    <p id={id}>
      Record additional work activities or relevant external training, what you learned, and the time spent. Learners add their own activities and evidence, then send them to their coach for review and approval.
    </p>
  </details>;
}
