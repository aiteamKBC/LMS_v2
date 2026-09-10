import { useMemo, type ReactNode } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';

/** Keep each audit system's home link inside that system. */
export function AuditWorkspaceShell({ children, homePath, title }: {
  children: ReactNode;
  homePath: string;
  title: string;
}) {
  const config = roleNavMap.auditor;
  const navItems = useMemo(() => config.items.map(item => (
    item.id === 'auditor-live-audit' ? { ...item, href: homePath } : item
  )), [config.items, homePath]);

  return (
    <WorkspaceShell
      role="auditor"
      roleLabel={config.label}
      navItems={navItems}
      workspaceLabel={title}
      pageTitle={title}
      hideBreadcrumbs
    >
      <div className="workspace-audit-content min-h-full">{children}</div>
    </WorkspaceShell>
  );
}
