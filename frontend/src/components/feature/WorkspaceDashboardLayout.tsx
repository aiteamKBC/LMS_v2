import type { ReactNode } from 'react';
import styles from './WorkspaceDesign.module.css';

/** The Super Admin dashboard frame, shared by workspaces with an overview rail. */
export function WorkspaceDashboardLayout({ children, overview, className = '' }: {
  children: ReactNode;
  overview?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`${styles.layout} ${overview ? styles.withOverview : ''} ${className}`}>
      <div className={styles.content} tabIndex={overview ? 0 : undefined} role={overview ? 'region' : undefined} aria-label={overview ? 'Dashboard content' : undefined}>{children}</div>
      {overview && <aside className={styles.overview} aria-label="Workspace overview" tabIndex={0}>{overview}</aside>}
    </div>
  );
}
