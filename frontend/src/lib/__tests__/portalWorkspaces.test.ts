/**
 * The shared workspace list's two load-bearing behaviours.
 *
 * This module is the single source of truth for the five sections, consumed by
 * the header's WorkspaceSwitcher and by the public launcher on /home. Copies of
 * the same mapping used to exist in a dead RoleSwitcher and on the Super Admin
 * dashboard; both are gone.
 *
 * Two things can break silently as entries are edited:
 *  - `activeWorkspace` prefix matching, because some paths are prefixes of
 *    others, so the switcher would say you are somewhere you are not;
 *  - the launcher's requirements, since it signs in as `demoEmail` and a tile
 *    without one fails on click.
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

  it('returns null outside the five sections', () => {
    // The switcher shows these as a neutral label rather than guessing.
    expect(activeWorkspace('/workspace/admin')).toBeNull();
    expect(activeWorkspace('/workspace/leadership')).toBeNull();
    expect(activeWorkspace('/admin/roles')).toBeNull();
  });
});

describe('the list itself', () => {
  it('is the curated five', () => {
    expect(PORTAL_WORKSPACES.map((w) => w.slug)).toEqual([
      'coach', 'enrolment', 'engagement', 'curriculum', 'audit',
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

  it('gives every workspace a demo account, which the launcher needs', () => {
    for (const workspace of PORTAL_WORKSPACES) {
      expect(workspace.demoEmail).toMatch(/@/);
      expect(workspace.blurb.length).toBeGreaterThan(0);
    }
  });
});
