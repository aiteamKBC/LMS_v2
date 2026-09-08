import { describe, expect, it } from 'vitest';
import { markingVerdict } from '../markingVerdict';

describe('markingVerdict', () => {
  it('reads an accepted submission as done', () => {
    expect(markingVerdict('accepted')?.key).toBe('accepted');
  });

  it('counts a partial award as accepted — the learner was awarded something', () => {
    expect(markingVerdict('partial')?.key).toBe('accepted');
  });

  it('reads a rejected submission as needing more work', () => {
    expect(markingVerdict('rejected')?.key).toBe('rejected');
  });

  it('counts a referral as rejected — it came back for more work', () => {
    expect(markingVerdict('referred')?.key).toBe('rejected');
  });

  it('reads a submitted activity as pending', () => {
    expect(markingVerdict('submitted_for_tutor_review')?.key).toBe('pending');
  });

  it('treats an escalation as still pending — it is with staff, not decided', () => {
    expect(markingVerdict('escalated')?.key).toBe('pending');
  });

  it('returns null when nothing has been handed in', () => {
    // Distinct from pending: the learner still has to finish the activity, so
    // the ordinary completion criteria apply rather than a marking state.
    for (const value of [undefined, null, '', 'draft', 'anything-else']) {
      expect(markingVerdict(value as string)).toBeNull();
    }
  });

  it('never labels a rejection with an encouraging colour', () => {
    // The bug this guards: a green tick beside a red verdict. Every field of
    // one verdict has to come from the same object.
    const rejected = markingVerdict('rejected')!;
    for (const field of [rejected.tone, rejected.panel, rejected.panelIcon]) {
      expect(field).toContain('red');
      expect(field).not.toContain('emerald');
    }
  });

  it('gives every verdict a next step, not just a label', () => {
    // A learner reading "Rejected" needs to know what to do about it.
    for (const status of ['accepted', 'rejected', 'submitted_for_tutor_review']) {
      expect(markingVerdict(status)!.detail.length).toBeGreaterThan(20);
    }
  });
});
