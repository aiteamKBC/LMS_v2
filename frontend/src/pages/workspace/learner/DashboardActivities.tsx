import { ArrowUpRight, CalendarDays, Layers3, Trophy, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { LearnerKind } from '@/api/learnerDetail';
import { isDeliveryStatus, isFreshStatus, isOnboardingStatus } from '@/hooks/useOnboardingRedirect';
import { learnerDashboardLinks } from '@/mocks/navigation';
import styles from './DashboardActivities.module.css';

const icons = { 'learner-clubs': Users, 'learner-events': CalendarDays, 'learner-rewards': Trophy, 'learner-flash-cards': Layers3 };

type Props = {
  kind: LearnerKind;
  programmeStatus?: string;
  canSeeNavItem: (id: string) => boolean;
};

export function DashboardActivities({ kind, programmeStatus, canSeeNavItem }: Props) {
  // Moving the links must retain the old Community group's audience and
  // permissions. Commercial and pre-teaching learners did not see this group.
  if (kind !== 'apprenticeship' || isFreshStatus(programmeStatus)
    || isOnboardingStatus(programmeStatus) || isDeliveryStatus(programmeStatus)
    || !canSeeNavItem('learner-group-community')) return null;

  const links = learnerDashboardLinks.filter(item => canSeeNavItem(item.id));
  if (!links.length) return null;

  return <section className={styles.section} aria-labelledby="dashboard-activities-title">
    <header className={styles.heading}>
      <h2 id="dashboard-activities-title">Activities & rewards</h2>
      <p>Clubs, events and extra practice alongside your learning.</p>
    </header>
    <div className={styles.links}>
      {links.map(item => {
        const Icon = icons[item.id as keyof typeof icons];
        return <Link key={item.id} to={item.href} className={styles.link} aria-label={item.label}>
          <span className={styles.icon}><Icon aria-hidden="true" size={20} /></span>
          <span className={styles.copy}><strong>{item.label}</strong><span>{item.description}</span></span>
          <ArrowUpRight aria-hidden="true" size={17} className={styles.arrow} />
        </Link>;
      })}
    </div>
  </section>;
}
