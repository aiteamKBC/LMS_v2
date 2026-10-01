import { Sparkles } from 'lucide-react';
import type { DashboardTabsProps } from '../DashboardTabs';
import { DashboardRewards } from '../DashboardRewards';
import styles from './DashboardRewardsTab.module.css';

export default function DashboardRewardsTab({ kind, learnerId, canOpenRewards }: Pick<DashboardTabsProps, 'kind' | 'learnerId' | 'canOpenRewards'>) {
  return <div className={styles.preview}>
    <div className={styles.previewContent} aria-hidden="true" inert>
      <DashboardRewards kind={kind} learnerId={learnerId} canOpenRewards={canOpenRewards} />
    </div>
    <div className={styles.veil} role="status">
      <div className={styles.message}>
        <span className={styles.icon} aria-hidden="true"><Sparkles size={24} /></span>
        <span className={styles.eyebrow}>Rewards &amp; points</span>
        <h2>Coming soon</h2>
        <p>Keep building your points. A new way to celebrate your progress is on its way.</p>
      </div>
    </div>
  </div>;
}
