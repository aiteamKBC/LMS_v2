import { ArrowRight, Coins, Gift, Trophy } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { LearnerKind } from '@/api/learnerDetail';
import { fetchLearnerRewards, peekLearnerRewards } from '@/api/learnerRewards';
import { useLiveLearnerRead } from '@/hooks/useLiveLearnerRead';
import styles from './DashboardRewards.module.css';

export function DashboardRewards({ kind, learnerId, canOpenRewards = true }: { kind: LearnerKind; learnerId: string; canOpenRewards?: boolean }) {
  const { data, loading, error, refresh } = useLiveLearnerRead(kind, learnerId, true, fetchLearnerRewards, peekLearnerRewards);
  const balance = data ? Math.max(0, data.points.balance) : null;
  return <section className={styles.root} aria-label="Rewards and points">
    <header><div><span className={styles.eyebrow}>Celebrate your progress</span><h2>Rewards &amp; points</h2><p>Your learning achievements, recognised.</p></div>
      {canOpenRewards && <Link to="/learner/rewards">View rewards<ArrowRight size={15} /></Link>}
    </header>
    {error && <div className={styles.error} role="alert"><span>{error}</span><button type="button" onClick={refresh}>Retry rewards</button></div>}
    {loading && !data ? <p role="status" className={styles.empty}>Loading rewards and points…</p> : <>
      <div className={styles.content}>
        <div className={styles.points}>
          <div className={styles.balance}><span className={styles.coin}><Coins size={24} /></span><div><span>Available points</span><strong>{balance == null ? '—' : balance.toLocaleString('en-GB')}</strong><small>Ready to use on rewards</small></div></div>
          <dl><div><dt><Trophy size={15} />Total earned</dt><dd>{data ? data.points.earned.toLocaleString('en-GB') : '—'}</dd></div>
            <div><dt><Gift size={15} />Committed to rewards</dt><dd>{data ? data.points.committed.toLocaleString('en-GB') : '—'}</dd></div></dl>
        </div>
        <div className={styles.rewards}>{data?.rewards.length ? data.rewards.map(reward => <article key={reward.id}>
          <div className={styles.rewardHeading}><span className={styles.gift}><Gift size={20} /></span><span>{reward.category || 'Reward'}</span></div>
          <h3>{reward.name}</h3>{reward.description && <p className={styles.description}>{reward.description}</p>}
          <div className={styles.rewardFooter}><strong>{reward.points.toLocaleString('en-GB')} <small>points</small></strong>
            <span data-ready={balance != null && balance >= reward.points}>{balance == null ? 'Balance unavailable' : balance >= reward.points ? 'Within reach' : `${(reward.points - balance).toLocaleString('en-GB')} more points`}</span></div>
        </article>) : <p className={styles.empty}>{data ? 'New rewards will appear here when available. Keep building your points as you learn.' : 'Rewards are currently unavailable.'}</p>}</div>
      </div>
    </>}
  </section>;
}
