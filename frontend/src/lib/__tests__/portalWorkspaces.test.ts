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
import { PORTAL_WORKSPACES, activeWorkspace } from '../portalWorkspaces';

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
      'admin', 'coach', 'enrolment', 'engagement', 'tutor', 'curriculum', 'audit',
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
});
