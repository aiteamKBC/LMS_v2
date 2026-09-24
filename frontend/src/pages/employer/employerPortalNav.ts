import type { SidebarNavItem } from '@/components/feature/Sidebar';
import { useAuth } from '@/hooks/useAuth';

/**
 * The employer workspace's own menu: their learners, and every document across
 * them. Both carry the employer id, so the shared static nav cannot hold them.
 * "My learners" also stays highlighted on a learner's page beneath it.
 */
export function employerPortalNav(employerId: string): SidebarNavItem[] {
  return [
    { id: 'employer-portal-learners', label: 'My learners', icon: 'ri-group-line', href: `/employers/${employerId}` },
    { id: 'employer-portal-documents', label: 'All documents', icon: 'ri-draft-line', href: `/employers/${employerId}/documents` },
  ];
}

/**
 * WorkspaceShell props for the employer pages.
 *
 * Two audiences reach them: the employer after signing in, and staff opening
 * an employer from the Users directory. Both get the employer menu and the
 * learner workspace's look; only the name in the header follows the session.
 */
export function useEmployerPortalChrome(employerId: string, employerName?: string) {
  const { auth } = useAuth();
  const isEmployerViewer = auth.account?.role === 'employer';
  return {
    isEmployerViewer,
    shell: {
      role: isEmployerViewer ? 'employer' : 'compliance',
      appearance: 'learner',
      roleLabel: 'Employer',
      workspaceLabel: 'Employer Workspace',
      navItems: employerPortalNav(employerId),
      userName: isEmployerViewer ? auth.account?.displayName || employerName || 'Employer' : 'Enrolment Officer',
      userRole: isEmployerViewer ? 'Employer' : 'Enrolment Officer',
    },
  };
}
