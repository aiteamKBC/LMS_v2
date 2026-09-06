import { describe, expect, it } from 'vitest';

import { otjhContributionHours } from './otjhContribution';

describe('OTJ attempt contribution', () => {
  it('uses an explicit Time spent input before the default reported time', () => {
    expect(otjhContributionHours({
      reportedTime: '60',
      claimedSeconds: 7200,
      verifiedSeconds: 11,
      timeTrackingSource: 'signed_session_capped_active_playback:input',
    })).toBe(2);
  });

  it('recognises an existing manual input that was capped by the server', () => {
    expect(otjhContributionHours({
      reportedTime: '60',
      claimedSeconds: 5400,
      verifiedSeconds: 11,
      timeTrackingSource: 'signed_session_capped_active_playback',
    })).toBe(1.5);
  });

  it('keeps reported time ahead of an ordinary automatic timer', () => {
    expect(otjhContributionHours({
      reportedTime: '2h',
      claimedSeconds: 120,
      verifiedSeconds: 120,
      timeTrackingSource: 'signed_session_capped_active_playback:timer',
    })).toBe(2);
  });
});
