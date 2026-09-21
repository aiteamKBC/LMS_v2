/**
 * Who may act *as* the learner whose workspace is open.
 *
 * The learner pages are shared: every staff drill-down renders the learner's own
 * training plan, and the activities on it end by writing a progress record in
 * the learner's name. So this predicate decides whether a page shows a working
 * plan or a read-only one, and getting it wrong in either direction is bad —
 * too loose and a caseowner completes components as the apprentice, too tight
 * and the apprentice cannot do their own course.
 *
 * The cases pinned here are the ones a refactor would plausibly get wrong: the
 * id comparison being string-vs-number, an admin counting as "the learner",
 * another learner reaching this learner's plan, and the fail-closed window
 * before the session has resolved.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { AuthUser } from '@/api/auth';

const authState = vi.fn();

vi.mock('../useAuth', () => ({ useAuth: () => authState() }));

const { useLearnerWorkspaceAccess } = await import('../useLearnerWorkspaceAccess');

const LEARNER_56: AuthUser = {
  id: 2,
  email: 'learner@kbc.test',
  displayName: 'A Learner',
  role: 'learner',
  subjectType: 'learner',
  subjectId: 56,
  hasPassword: true,
  lastLoginAt: null,
  permissions: [],
};

const ADMIN: AuthUser = { ...LEARNER_56, id: 1, role: 'admin', subjectType: 'staff', subjectId: 13, displayName: 'Demo Admin' };

function signedIn(account: AuthUser | null, isInitialized = true) {
  authState.mockReturnValue({ auth: { account }, isInitialized });
}

function access(learnerId?: string | number | null) {
  return renderHook(() => useLearnerWorkspaceAccess(learnerId)).result.current;
}

describe('useLearnerWorkspaceAccess', () => {
  it('permits only the owning administrator in each personal course mode', () => {
    for (const mode of ['study', 'preview', 'all']) {
      const id = `pl.1.${mode}.MOD-A`;
      signedIn(ADMIN);
      expect(access(id).canProgress).toBe(true);
      signedIn({ ...ADMIN, id: 3 });
      expect(access(id).canProgress).toBe(false);
      signedIn({ ...ADMIN, role: 'staff' });
      expect(access(id).canProgress).toBe(false);
      signedIn(LEARNER_56);
      expect(access(id).canProgress).toBe(false);
      signedIn(ADMIN, false);
      expect(access(id).canProgress).toBe(false);
    }
  });
  it('lets the learner work through their own plan', () => {
    signedIn(LEARNER_56);
    expect(access('56')).toEqual({ canProgress: true, showReadOnlyNotice: false });
  });

  it('compares the id across types — the route param is a string, the account holds a number', () => {
    signedIn(LEARNER_56);
    expect(access(56).canProgress).toBe(true);
  });

  it('lets an admin edit and complete work for the selected learner', () => {
    signedIn(ADMIN);
    expect(access('56')).toEqual({ canProgress: true, showReadOnlyNotice: false });
    expect(access('19').canProgress).toBe(true);
  });

  it('keeps an ordinary staff preview read-only', () => {
    signedIn({ ...ADMIN, role: 'staff' });
    expect(access('56')).toEqual({ canProgress: false, showReadOnlyNotice: true });
  });

  it('does not enable admin actions until both session and learner are resolved', () => {
    signedIn(ADMIN, false);
    expect(access('56').canProgress).toBe(false);
    signedIn(ADMIN);
    for (const id of [undefined, null, '', 'not-a-learner', '0', '-1']) {
      expect(access(id).canProgress).toBe(false);
    }
  });

  it('makes it read-only for a learner who opened somebody else', () => {
    signedIn(LEARNER_56);
    expect(access('19').canProgress).toBe(false);
  });

  it('is read-only when no learner is resolved yet', () => {
    signedIn(LEARNER_56);
    expect(access(undefined).canProgress).toBe(false);
    expect(access(null).canProgress).toBe(false);
  });

  it('fails closed until the session resolves, without flashing the notice', () => {
    // A staff viewer must not get a usable plan in the first frame; the learner
    // must not be told they are read-only before anyone knows that they are.
    signedIn(null, false);
    expect(access('56')).toEqual({ canProgress: false, showReadOnlyNotice: false });
  });

  it('leaves the landing page demo preview alone', () => {
    // `previewAs` holds no server account. Those pages demo the learner flow and
    // cannot write anything regardless — every progress endpoint 401s them.
    signedIn(null);
    expect(access('56').canProgress).toBe(true);
  });
});
