import type { ComponentProps, CSSProperties } from 'react';
import type { AdminPage } from '@/pages/admin/_shared/AdminPage';
import { AppIcon } from '@/components/feature/AppIcon';
import { roleNavMap } from '@/mocks/navigation';
import { EnrolmentWorkspaceShell } from './EnrolmentWorkspaceShell';
import styles from './EnrolmentWorkspace.module.css';
import motion from './EnrolmentMotion.module.css';
import { EnrolmentBreadcrumbs } from './EnrolmentBreadcrumbs';

const images: Record<string, string> = {
  users: '/assets/enrolment-users-banner.png',
  coaches: '/assets/enrolment-coach-directory-banner.png',
  sessions: '/assets/enrolment-first-sessions-banner.png',
  transfers: '/assets/enrolment-transfer-progress-banner.png',
};

export function EnrolmentHero({ title, description, icon, stats, actions, eyebrow, image = 'users', breadcrumbLabel, metadata, className = '' }: {
  title: string; description: ComponentProps<typeof AdminPage>['heroBlurb']; icon: string;
  stats?: ComponentProps<typeof AdminPage>['stats']; actions?: ComponentProps<typeof AdminPage>['actions']; eyebrow?: string; image?: keyof typeof images;
  breadcrumbLabel?: string; metadata?: ComponentProps<typeof AdminPage>['actions']; className?: string;
}) {
  return <header className={`${styles.hero} ${className}`} style={{ '--enrolment-hero-image': `url('${images[image]}')` } as CSSProperties}>
    <div className={styles.heroCopy}>
      <EnrolmentBreadcrumbs current={breadcrumbLabel || title} />
      {eyebrow && <p className={styles.eyebrow}><AppIcon name={icon} size={12} aria-hidden="true" />{eyebrow}</p>}
      <h1>{title}</h1><p className={styles.heroDescription}>{description}</p>
      {stats?.length ? <dl className={styles.heroStats}>{stats.map(stat => <div key={stat.label}><dt>{stat.label.toLowerCase()}</dt><dd>{stat.value}</dd></div>)}</dl> : null}
      {metadata}
      {actions && <div className={styles.heroActions}>{actions}</div>}
    </div>
  </header>;
}

/** Only selected by Enrollment callers; the shared AdminPage stays untouched. */
export function EnrolmentPage({ title, subtitle, icon, heroTitle, heroBlurb, stats, actions, children, heroMetadata, heroClassName, directoryLayout = false }: ComponentProps<typeof AdminPage> & {
  heroMetadata?: ComponentProps<typeof EnrolmentHero>['metadata']; heroClassName?: string; directoryLayout?: boolean;
}) {
  const config = roleNavMap.compliance;
  return <EnrolmentWorkspaceShell role="compliance" roleLabel={config.label} navItems={config.items}
    workspaceLabel="Enrolment" pageTitle={title} pageSubtitle={subtitle} hideBreadcrumbs showBackButton={false} directoryLayout={directoryLayout}>
    <div className={`${styles.page} ${motion.page}`}>
      <EnrolmentHero title={heroTitle} breadcrumbLabel={title} description={heroBlurb} icon={icon} stats={stats} actions={actions}
        image={title === 'Coach directory' ? 'coaches' : 'sessions'} metadata={heroMetadata} className={`${heroClassName ?? ''} ${motion.cardEnter}`} />
      {children}
    </div>
  </EnrolmentWorkspaceShell>;
}
