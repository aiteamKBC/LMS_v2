import { AppIcon } from '@/components/feature/AppIcon';
import { EMPTY_VALUE, hasValue } from '../lib/format';
import type { Learner } from '../types';
import styles from '../caseload.module.css';

function recentActivity(learner: Learner) {
  if (hasValue(learner.recentFlag)) return learner.recentFlag!;
  if (hasValue(learner.attendanceLastSession)) return `Attended ${learner.attendanceLastSession}`;
  if (hasValue(learner.lastSubmittedEvidence)) return `Submitted evidence ${learner.lastSubmittedEvidence}`;
  return null;
}

export function CaseloadInsights({ learners }: { learners: Learner[] }) {
  const activities = learners.map(learner => ({ learner, activity: recentActivity(learner) })).filter(item => item.activity).slice(0, 5);
  return <section className={styles.lowerGrid} aria-label="Learner insights">
    <article className={styles.panel}>
      <header className={styles.panelHeader}><h2 className={styles.panelTitle}><AppIcon name="ri-group-line" />Learners Recent Logs</h2></header>
      <div className={styles.activityList}>{activities.length ? activities.map(({ learner, activity }) => <div className={styles.activity} key={learner.id}>
        <span className={styles.activityIcon}><AppIcon name="ri-file-list-3-line" /></span>
        <div><strong>{learner.name}</strong><span>{activity}</span></div><time>{hasValue(learner.lastContact) ? learner.lastContact : EMPTY_VALUE}</time>
      </div>) : <div className={styles.emptyChart}><div><AppIcon name="ri-history-line" /><strong>No recent learner logs</strong><span>The caseload response has not returned recent activity.</span></div></div>}</div>
    </article>
    <article className={styles.panel}>
      <header className={styles.panelHeader}><h2 className={styles.panelTitle}><AppIcon name="ri-line-chart-line" />Learner Progress Trend</h2></header>
      <div className={styles.emptyChart}><div><AppIcon name="ri-line-chart-line" /><strong>Historical progress is not available yet</strong><span>Current learner progress is shown in the table above.</span></div></div>
    </article>
  </section>;
}
