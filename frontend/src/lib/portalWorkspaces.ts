// ============================================================================
// The five workspaces the platform offers as a launcher.
//
// One definition, two consumers:
//   * components/feature/WorkspaceSwitcher — the top-bar switcher an
//                             administrator uses to change section. Replaced a
//                             five-card panel on the Super Admin dashboard,
//                             which could only be reached from the dashboard —
//                             so changing section meant going home first.
//   * pages/home            — the public "Explore your portal" launcher, which
//                             enters each one as its demo account (previewAs).
//
// Kept here rather than in either place so the two cannot drift, and every
// `path` is a real route in router/config.tsx — a launcher offering a section
// that leads nowhere is worse than one that omits it.
//
// Deliberately five, not sixteen. The sidebar's roleNavMap knows every role the
// app has, but this is the curated set of sections worth switching between; a
// switcher listing everything routable is a directory, not a shortcut.
//
// This list also replaced `components/feature/RoleSwitcher.tsx`, a dead
// component carrying its own copy of the same mapping. A real administrator
// already has access to every section, so moving between them is navigation,
// not a change of role — the switcher never touches RBAC state.
// ============================================================================

export interface PortalWorkspace {
  slug: string;
  label: string;
  icon: string;
  /** Where this workspace lives. A real route. */
  path: string;
  /** Demo account the public launcher signs in as. Unused by the switcher. */
  demoEmail: string;
  /** One line of context, shown in the switcher and on the launcher. */
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
    slug: 'engagement',
    label: 'Engagement',
    icon: 'ri-megaphone-line',
    path: '/workspace/engagement',
    demoEmail: 'compliance@kbc.test',
    blurb: 'Attendance, absence and communications',
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
    slug: 'audit',
    label: 'AUDIT',
    icon: 'ri-file-search-line',
    path: '/workspace/auditor-copy',
    demoEmail: 'auditor@kbc.test',
    blurb: 'Evidence audit and the activity ledger',
  },
];

/**
 * Which workspace a path belongs to, so the switcher can show where you are.
 *
 * Longest match wins, which is the whole reason this is a function rather than a
 * `find`: some paths are prefixes of others. `/workspace/auditor-copy` starts
 * with `/workspace/auditor`, and every `/workspace/learner/:kind/:id` starts
 * with `/workspace/learner` — taking the first prefix hit would light up the
 * wrong row, or the right one for the wrong reason.
 *
 * The segment boundary matters too: `/users-report` is not inside `/users`.
 *
 * Returns null anywhere outside these five sections — the Super Admin dashboard,
 * Leadership, an admin settings page — which the switcher renders as a neutral
 * "Workspaces" label rather than claiming you are somewhere you are not.
 */
export function activeWorkspace(pathname: string): PortalWorkspace | null {
  let best: PortalWorkspace | null = null;
  for (const workspace of PORTAL_WORKSPACES) {
    const isMatch = pathname === workspace.path || pathname.startsWith(`${workspace.path}/`);
    if (!isMatch) continue;
    if (!best || workspace.path.length > best.path.length) best = workspace;
  }
  return best;
}
