import styles from "./InclusionLoading.module.css";
import { LoadingSkeleton } from './feature/LoadingSkeleton';

export function InclusionLoading() {
  return <div className={styles.screen}>
    <div className={styles.content}>
      <LoadingSkeleton label="Opening Inclusion & Safeguarding" className="w-64" />
    </div>
  </div>;
}
