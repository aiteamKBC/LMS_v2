/**
 * What a dismissal must and must not do.
 *
 * The two properties worth pinning are the ones that make this feature safe
 * rather than merely convenient:
 *  - it is scoped to the account, so one administrator cannot silence another's
 *    dashboard by sharing a machine;
 *  - it is scoped to the alert's current state, so dismissing "1 failed" does
 *    not also hide "2 failed" — a dismissal that outlived the situation it was
 *    made about would hide a growing problem.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readDismissed, dismiss, restoreAll } from '../adminAlertDismissals';

const ALICE = 1;
const BOB = 2;

describe('adminAlertDismissals', () => {
  beforeEach(() => window.localStorage.clear());

  it('starts with nothing dismissed', () => {
    expect(readDismissed(ALICE).size).toBe(0);
  });

  it('remembers a dismissal for that account', () => {
    dismiss(ALICE, 'invites-failed:1', ['invites-failed:1']);
    expect(readDismissed(ALICE).has('invites-failed:1')).toBe(true);
  });

  it('does not dismiss it for anybody else', () => {
    dismiss(ALICE, 'invites-failed:1', ['invites-failed:1']);
    expect(readDismissed(BOB).size).toBe(0);
  });

  it('ignores a dismissal when nobody is signed in', () => {
    dismiss(null, 'invites-failed:1', ['invites-failed:1']);
    expect(readDismissed(null).size).toBe(0);
    expect(window.localStorage.length).toBe(0);
  });

  it('does not hide the same alert once its count has changed', () => {
    dismiss(ALICE, 'invites-failed:1', ['invites-failed:1']);
    // A second invitation fails: different signature, so it is not dismissed.
    expect(readDismissed(ALICE).has('invites-failed:2')).toBe(false);
  });

  it('forgets dismissals whose alert is no longer showing', () => {
    dismiss(ALICE, 'invites-failed:1', ['invites-failed:1', 'locked:3']);
    dismiss(ALICE, 'locked:3', ['locked:3']);
    // 'invites-failed:1' was not among the live alerts on the second call, so
    // it was pruned — if that condition returns, it is news again.
    const after = readDismissed(ALICE);
    expect(after.has('locked:3')).toBe(true);
    expect(after.has('invites-failed:1')).toBe(false);
  });

  it('restores everything for that account only', () => {
    dismiss(ALICE, 'invites-failed:1', ['invites-failed:1']);
    dismiss(BOB, 'locked:3', ['locked:3']);
    restoreAll(ALICE);
    expect(readDismissed(ALICE).size).toBe(0);
    expect(readDismissed(BOB).has('locked:3')).toBe(true);
  });

  it('treats an unreadable store as nothing dismissed', () => {
    window.localStorage.setItem('kbc_admin_alerts_dismissed:1', 'not json');
    expect(readDismissed(ALICE).size).toBe(0);
  });
});
