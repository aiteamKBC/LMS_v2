import { describe, expect, it } from 'vitest';
import { homeRouteFor, mayAccessRoute, rolesForRoute } from '../routeAccess';
import type { Role } from '@/api/auth';

const as = (role: Role) => ({ role });

/**
 * These pin the audience boundary rather than the rule table's shape: the point
 * is which person can open which area, so each case is written the way the bug
 * would be reported ("a learner pasted a curriculum URL").
 */
describe('mayAccessRoute', () => {
  it('keeps learners and employers out of the staff console', () => {
    const staffOnly = [
      '/curriculum/teams-meetings',
      '/curriculum/cohorts',
      '/workspace/curriculum',
      '/workspace/coach',
      '/coach/caseload',
      '/tutor/learners',
      '/users',
      '/engagement/clubs',
      '/leadership/ofsted',
      '/finance/budgets',
      '/support/ticket-queue',
      '/safeguarding/reports',
      '/training-plan/learner/12',
    ];

    for (const path of staffOnly) {
      expect(mayAccessRoute(path, as('learner')), path).toBe(false);
      expect(mayAccessRoute(path, as('employer')), path).toBe(false);
      expect(mayAccessRoute(path, as('staff')), path).toBe(true);
      expect(mayAccessRoute(path, as('admin')), path).toBe(true);
    }
  });

  it('admits only the super-admin to the admin console', () => {
    for (const path of ['/admin/users', '/workspace/admin', '/internal-panel']) {
      expect(mayAccessRoute(path, as('admin')), path).toBe(true);
      expect(mayAccessRoute(path, as('staff')), path).toBe(false);
      expect(mayAccessRoute(path, as('learner')), path).toBe(false);
    }
  });

  it('lets staff open a learner page, and keeps employers out', () => {
    // Staff review learners; the API stops them *writing* as one
    // (login/permissions.learner_self_only), which is the part that matters.
    for (const path of ['/workspace/learner', '/learner/attendance']) {
      expect(mayAccessRoute(path, as('learner')), path).toBe(true);
      expect(mayAccessRoute(path, as('staff')), path).toBe(true);
      expect(mayAccessRoute(path, as('employer')), path).toBe(false);
    }
  });

  it('lets employers and staff open the employer portal, but not learners', () => {
    for (const path of ['/workspace/employer', '/employer/apprentices', '/employers/7']) {
      expect(mayAccessRoute(path, as('employer')), path).toBe(true);
      expect(mayAccessRoute(path, as('staff')), path).toBe(true);
      expect(mayAccessRoute(path, as('learner')), path).toBe(false);
    }
  });

  it('leaves the shared surfaces open to everyone signed in', () => {
    for (const path of ['/messages', '/notifications', '/tasks', '/user-guide', '/home']) {
      for (const role of ['admin', 'staff', 'employer', 'learner'] as Role[]) {
        expect(mayAccessRoute(path, as(role)), `${path} ${role}`).toBe(true);
      }
    }
  });

  it('matches on whole segments, so /employer does not swallow /employers', () => {
    // Both happen to admit the same roles; the risk is a rule like "/admin"
    // silently capturing a future "/administration".
    expect(rolesForRoute('/employers/7')).toEqual(rolesForRoute('/employer/apprentices'));
    expect(rolesForRoute('/adminfoo')).toEqual(rolesForRoute('/unclassified-page'));
  });

  it('closes an unclassified path rather than opening it', () => {
    expect(mayAccessRoute('/some-new-page', as('learner'))).toBe(false);
    expect(mayAccessRoute('/some-new-page', as('staff'))).toBe(true);
  });
});

/**
 * RequireAuth sends a refused account to its home. If any home were itself
 * refused, that would be a redirect loop — so this asserts the property the
 * guard's loop check exists to catch.
 */
describe('homeRouteFor', () => {
  it('sends every account somewhere it is allowed to be', () => {
    const accounts = [
      { role: 'learner' as Role, accessHome: null, subjectId: 3 },
      { role: 'employer' as Role, accessHome: null, subjectId: 7 },
      { role: 'staff' as Role, accessHome: '/users', subjectId: 1 },
      { role: 'staff' as Role, accessHome: '/workspace/curriculum', subjectId: 1 },
      { role: 'staff' as Role, accessHome: '/workspace/coach', subjectId: 1 },
      { role: 'staff' as Role, accessHome: '/workspace/tutor', subjectId: 1 },
      { role: 'admin' as Role, accessHome: '/workspace/admin', subjectId: 1 },
      // No access grant recorded — the server sends these to /access-required,
      // which is public, so it is never refused.
      { role: 'staff' as Role, accessHome: null, subjectId: 1 },
    ];

    for (const account of accounts) {
      const home = homeRouteFor(account);
      expect(mayAccessRoute(home, account), `${account.role} -> ${home}`).toBe(true);
    }
  });

  it('sends an employer to their own organisation', () => {
    expect(homeRouteFor({ role: 'employer', accessHome: null, subjectId: 42 })).toBe('/employers/42');
  });

  it('prefers the access grant the server derived', () => {
    expect(
      homeRouteFor({ role: 'staff', accessHome: '/workspace/curriculum', subjectId: 1 }),
    ).toBe('/workspace/curriculum');
  });
});
