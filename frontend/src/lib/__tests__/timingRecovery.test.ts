import { beforeEach, expect, it, vi } from 'vitest';
import { archiveTimingDraft, timingSessionExpired } from '../timingRecovery';

beforeEach(() => { localStorage.clear(); vi.restoreAllMocks(); });
const session = { sessionId: 'old', trackingToken: 'signed', countingMode: 'visible_page' as const, startedAt: '2026-10-01T12:00:00Z' };
it('archives the old evidence without clearing the active draft or changing its signature', () => {
  localStorage.setItem('activity', 'active');
  archiveTimingDraft('activity', session, 123, { answer: 'Saved answer' });
  const archived = JSON.parse(localStorage.getItem('activity:expired:old')!);
  expect(archived).toMatchObject({ session, elapsedSeconds: 123, answers: { answer: 'Saved answer' } });
  expect(localStorage.getItem('activity')).toBe('active');
  expect(localStorage.getItem('other:expired:old')).toBeNull();
});
it('fails visibly when the archive cannot be saved', () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
  expect(() => archiveTimingDraft('activity', session, 123)).toThrow('could not be preserved');
});
it('only offers expiry recovery for expiry, never for an invalid signature or identity', () => {
  expect(timingSessionExpired(Object.assign(new Error('Expired'), { code: 'expired_tracking_session' }))).toBe(true);
  expect(timingSessionExpired(new Error('The activity timing session has expired. Your answers and timing draft are kept.'))).toBe(true);
  expect(timingSessionExpired(Object.assign(new Error('Invalid'), { code: 'invalid_tracking_signature' }))).toBe(false);
  expect(timingSessionExpired(Object.assign(new Error('Wrong learner'), { code: 'tracking_identity_mismatch' }))).toBe(false);
});
