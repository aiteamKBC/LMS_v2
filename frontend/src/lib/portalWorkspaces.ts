// ============================================================================
// The five workspaces the platform offers as a launcher.
//
// One definition, two consumers:
//   * pages/home            — the public "Explore your portal" launcher, which
//                             enters each one as its demo account (previewAs).
//   * pages/workspace/admin — the Super Admin dashboard's Workspaces card,
//                             which simply navigates: a super admin already has
//                             access to everything, so there is nothing to
//                             assume.
//
// Kept here rather than in either page so the two lists cannot drift, and every
// `path` is a real route in router/config.tsx — a launcher offering a section
// that leads nowhere is worse than one that omits it.
// ============================================================================

export interface PortalWorkspace {
  slug: string;
  label: string;
  icon: string;
  /** Where this workspace lives. A real route. */
  path: string;
  /** Demo account the public launcher signs in as. Unused by the dashboard. */
  demoEmail: string;
  /** One line for the dashboard card, which has room for it. */
  blurb: string;
}

export const PORTAL_WORKSPACES: PortalWorkspace[] = [
  {
    slug: 'coach',
    label: 'Coach',
    icon: 'ri-user-heart-line',
    path: '/workspace/coach',
    demoEmail: 'coach@kbc.test',
    blurb: 'Caseload, reviews and evidence validation',
  },
  {
    // The enrolment console is the user directory — its whole sidebar is that
    // one item, so /users is the workspace.
    slug: 'enrolment',
    label: 'Enrolment',
    icon: 'ri-user-add-line',
    path: '/users',
    demoEmail: 'compliance@kbc.test',
    blurb: 'Learner records, enrolment and compliance',
  },
  {
    slug: 'curriculum',
    label: 'Curriculum',
    icon: 'ri-book-open-line',
    path: '/workspace/curriculum',
    demoEmail: 'tutor@kbc.test',
    blurb: 'Programmes, modules and their content',
  },
  {
    slug: 'engagement',
    label: 'Engagement',
    icon: 'ri-megaphone-line',
    path: '/workspace/engagement',
    demoEmail: 'compliance@kbc.test',
    blurb: 'Attendance, absence and communications',
  },
  {
    slug: 'audit-copy',
    label: 'AUDIT',
    icon: 'ri-file-search-line',
    path: '/workspace/auditor-copy',
    demoEmail: 'auditor@kbc.test',
    blurb: 'Evidence audit and the activity ledger',
  },
];
