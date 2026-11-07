import { describe, expect, it } from 'vitest';
import { activityTimeSeconds, activityTimeIssue, applyActivityTime, countedActivityTime } from './activityTimeDecision';
const saved = (seconds: number, retakeTimeChoice?: 'correct' | 'add' | 'retry', index = 1) => ({
  claimedSeconds: seconds, verifiedSeconds: 10, timeTrackingSource: 'signed:input',
  submittedAt: `2026-10-${String(index).padStart(2, '0')}T10:00:00Z`, retakeTimeChoice,
});
describe('Activity time decisions', () => {
  it.each([
    ['correct', 3600, 1200, 1200], ['add', 3600, 1200, 4800],
    ['retry', 3600, 1200, 3600], ['retry', 1200, 3600, 3600],
  ] as const)('%s combines previous/new durations correctly', (mode, previous, current, total) => {
    expect(applyActivityTime(previous, current, mode)).toBe(total);
    expect(countedActivityTime([saved(previous), saved(current, mode, 2)])).toBe(total);
  });
  it('uses the corrected baseline for additions and later retries after reopening', () => {
    const rows = [saved(3600), saved(600, 'correct', 2), saved(1200, 'add', 3), saved(900, 'retry', 4)];
    const before = JSON.stringify(rows);
    expect(countedActivityTime([...rows].reverse())).toBe(1800);
    expect(JSON.stringify(rows)).toBe(before);
  });
  it('rejects six plus three hours with an explanation, and accepts six plus two', () => {
    expect(activityTimeIssue(21600, 10800, 'add')).toContain('make 9 hours');
    expect(activityTimeIssue(21600, 10800, 'add')).toContain('Enter a smaller additional time');
    expect(activityTimeIssue(21600, 7200, 'add')).toBe('');
    expect(activityTimeIssue(0, 28801)).toContain('cannot exceed 8 hours');
  });
  it('preserves successful time when a later quiz attempt fails', () => {
    expect(countedActivityTime([saved(3600), { ...saved(60, 'correct', 2), passed: false }])).toBe(3600);
  });
  it('retains a previously saved keep/new selection before applying a new addition', () => {
    const rows = [saved(1800), saved(600, undefined, 2), { ...saved(900, undefined, 3), retakeTimeChoice: 'keep' as const }];
    expect(countedActivityTime(rows)).toBe(600);
    expect(countedActivityTime([...rows, saved(1200, 'add', 4)])).toBe(1800);
  });
  it('keeps units and separate verified timer evidence', () => {
    expect(activityTimeSeconds({ timeTaken: '01:30:00' })).toBe(5400);
    expect(activityTimeSeconds({ timeTaken: '30:00' })).toBe(1800);
    expect(activityTimeSeconds({ reportedTime: '1.5 hours' })).toBe(5400);
    expect(activityTimeSeconds({ ...saved(5400), verifiedSeconds: 20 })).toBe(5400);
  });
  it('uses the server legacy units when showing the previous duration', () => {
    expect(activityTimeSeconds({ reportedTime: '2' })).toBe(7200);
    expect(activityTimeSeconds({ reportedTime: '30' })).toBe(1800);
    expect(activityTimeSeconds({ reportedTime: '01:30' })).toBe(90);
    expect(activityTimeSeconds({ claimedSeconds: 600, verifiedSeconds: 60, timeTrackingSource: 'imported' })).toBe(60);
  });
});
