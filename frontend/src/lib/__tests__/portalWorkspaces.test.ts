/**
 * The shared workspace list's two load-bearing behaviours.
 *
 * This module is the single source of truth for the sections, consumed by the
 * header's WorkspaceSwitcher and by the public launcher on /home. Copies of the
 * same mapping used to exist in a dead RoleSwitcher and on the Super Admin
 * dashboard; both are gone.
 *
 * Three things can break silently as entries are edited:
 *  - `activeWorkspace` prefix matching, because some paths are prefixes of
 *    others, so the switcher would say you are somewhere you are not;
 *  - the launcher's requirements, since it signs in as `demoEmail` and a tile
 *    without one fails on click;
 *  - which workspaces carry a demoEmail at all. A null one is what keeps Super
 *    Admin off a public page that signs visitors in without a password, so a
 *    well-meant "fill in the missing email" would hand out the platform.
 */
import { describe, it, expect } from 'vitest';
import { PORTAL_WORKSPACES, activeWorkspace, workspacesFor } from '../portalWorkspaces';

describe('activeWorkspace', () => {
  it('matches a workspace root', () => {
    expect(activeWorkspace('/workspace/coach')?.slug).toBe('coach');
  });

  it('matches a page nested under a workspace', () => {
    expect(activeWorkspace('/users/commercial/19')?.slug).toBe('enrolment');
  });

  it('prefers the longest match, not the first', () => {
    // '/workspace/auditor-copy' also starts with '/workspace/auditor'. Should a
    // plain '/workspace/auditor' entry ever be added, the first prefix hit would
    // be the wrong audit system.
    expect(activeWorkspace('/workspace/auditor-copy')?.slug).toBe('audit');
  });

  it('requires a segment boundary, not just a matching prefix string', () => {
    // '/users-report' is not inside '/users'.
    expect(activeWorkspace('/users-report')).toBeNull();
  });

  it('matches the Super Admin workspace at its own route', () => {
    expect(activeWorkspace('/workspace/admin')?.slug).toBe('admin');
  });

  it('matches the Employer workspace nested under the Super Admin route', () => {
    // '/workspace/admin/employers' also starts with '/workspace/admin'.
    expect(activeWorkspace('/workspace/admin/employers')?.slug).toBe('employer');
  });

  it('returns null outside the listed sections', () => {
    // The switcher shows these as a neutral label rather than guessing.
    expect(activeWorkspace('/workspace/leadership')).toBeNull();
    // /admin/* is reached from the Super Admin sidebar but is not that
    // workspace's route, so it is outside the list rather than inside it.
    expect(activeWorkspace('/admin/roles')).toBeNull();
  });
});

describe('the list itself', () => {
  it('is the curated set, Super Admin first', () => {
    expect(PORTAL_WORKSPACES.map((w) => w.slug)).toEqual([
      'admin', 'coach', 'enrolment', 'engagement', 'tutor', 'curriculum', 'employer', 'audit', 'learner',
    ]);
  });

  it('has no duplicate slugs or paths', () => {
    const slugs = PORTAL_WORKSPACES.map((w) => w.slug);
    const paths = PORTAL_WORKSPACES.map((w) => w.path);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('points every workspace at an absolute in-app path', () => {
    for (const workspace of PORTAL_WORKSPACES) {
      expect(workspace.path.startsWith('/')).toBe(true);
      expect(workspace.path.startsWith('//')).toBe(false);
    }
  });

  it('gives every launcher workspace a demo account, which the launcher needs', () => {
    for (const workspace of PORTAL_WORKSPACES.filter((w) => w.demoEmail)) {
      expect(workspace.demoEmail).toMatch(/@/);
    }
  });

  it('describes every workspace, launcher or not', () => {
    for (const workspace of PORTAL_WORKSPACES) {
      expect(workspace.blurb.length).toBeGreaterThan(0);
    }
  });

  it('keeps Super Admin off the public launcher', () => {
    // The launcher signs a visitor in as `demoEmail` with no password, so the
    // administrator's workspace deliberately has none. It is switcher-only.
    const admin = PORTAL_WORKSPACES.find((w) => w.slug === 'admin');
    expect(admin).toBeDefined();
    expect(admin?.demoEmail).toBeNull();
  });

  it('keeps the employer directory off the public launcher', () => {
    // It lists every employer contact, so it is a super-admin page, not a demo.
    const employer = PORTAL_WORKSPACES.find((w) => w.slug === 'employer');
    expect(employer).toBeDefined();
    expect(employer?.demoEmail).toBeNull();
  });
});

describe('workspacesFor', () => {
  it('hides Learner from somebody with no record of their own', () => {
    // Every administrator would otherwise be offered a learner workspace with
    // nothing behind it.
    expect(workspacesFor(null).map((w) => w.slug)).not.toContain('learner');
    expect(workspacesFor({ learnerRecordId: null }).map((w) => w.slug)).not.toContain('learner');
  });

  it('offers Learner to a staff member who is also studying', () => {
    expect(workspacesFor({ learnerRecordId: 512 }).map((w) => w.slug)).toContain('learner');
  });

  it('addresses that record explicitly', () => {
    // The bare /workspace/learner route resolves the learner from the session,
    // and this person signs in as staff -- so without params it falls through
    // to a remembered or demo learner and opens somebody else's record.
    const learner = workspacesFor({ learnerRecordId: 512 }).find((w) => w.slug === 'learner');

    expect(learner?.path).toBe('/workspace/learner/commercial/512');
  });

  it("uses the record's own kind when it is an apprenticeship", () => {
    const learner = workspacesFor({ learnerRecordId: 7, learnerRecordKind: 'apprenticeship' })
      .find((w) => w.slug === 'learner');

    expect(learner?.path).toBe('/workspace/learner/apprenticeship/7');
  });

  it('leaves the other workspaces untouched', () => {
    const withLearner = workspacesFor({ learnerRecordId: 512 });

    expect(withLearner.filter((w) => w.slug !== 'learner'))
      .toEqual(PORTAL_WORKSPACES.filter((w) => w.slug !== 'learner'));
  });
});
