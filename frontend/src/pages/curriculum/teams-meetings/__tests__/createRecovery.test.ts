import { describe, expect, it, vi } from 'vitest';
import { progressSteps, readCreateStatus, waitForSavedCreate } from '../createRecovery';
import type { TeamsCreateStatus } from '../../module-builder/moduleAuthoringData';

const calendar = { liveSessionId: 'LIVE-1', joinUrl: 'https://teams.microsoft.com/meet/x', organizerEmail: 'o@example.invalid', warnings: [], settingsApplied: true };
const claim = (outcomeStatus: number | null, outcomeCode = '') => ({ outcomeStatus, outcomeCode, liveSessionId: 'LIVE-1', claimedAt: '', leaseUntil: '' });
const status = (value: Partial<TeamsCreateStatus>): TeamsCreateStatus => ({ state: 'none', claim: null, calendar: null, ...value });

describe('reading a lost create', () => {
  it('keeps waiting while the server is still creating', () => {
    expect(readCreateStatus(status({ state: 'creating' }), true)).toBeNull();
  });

  it('continues a verified saved calendar as a normal success', () => {
    const answer = readCreateStatus(status({ state: 'done', claim: claim(200), calendar }), false);
    expect(answer).toMatchObject({ kind: 'created', result: { warnings: [], meeting: { liveSessionId: 'LIVE-1', settingsApplied: true } } });
  });

  it('reads the create endpoint\'s 201 Created as a verified success, so its emails are sent', () => {
    const answer = readCreateStatus(status({ state: 'done', claim: claim(201), calendar }), false);
    expect(answer).toMatchObject({ kind: 'created', result: { warnings: [], meeting: { liveSessionId: 'LIVE-1', settingsApplied: true } } });
  });

  it('holds emails back for a calendar saved without finishing verification', () => {
    const answer = readCreateStatus(status({ state: 'done', claim: claim(502), calendar: { ...calendar, warnings: ['Invitations pending calendar verification.'], settingsApplied: false } }), false);
    expect(answer?.kind).toBe('created');
    if (answer?.kind === 'created') expect(answer.result.warnings.length).toBeGreaterThan(0);
  });

  it('allows Create again only for a known outcome that saved nothing', () => {
    expect(readCreateStatus(status({ state: 'done', claim: claim(502, 'teams_calendar_already_exists') }), false))
      .toMatchObject({ kind: 'failed', message: expect.stringContaining('HTTP 502') });
    expect(readCreateStatus(status({ state: 'uncertain' }), true)?.kind).toBe('uncertain');
  });

  it('treats a missing claim as not-yet-arrived, then as never sent', () => {
    expect(readCreateStatus(status({}), false)).toBeNull();
    expect(readCreateStatus(status({}), true)?.kind).toBe('failed');
  });
});

describe('the steps a create shows while it runs', () => {
  const states = (value: TeamsCreateStatus | null) => progressSteps(value, 10).map(step => step.state);

  it('starts on the calendar, before the server has saved anything', () => {
    expect(states(null)).toEqual(['active', 'pending', 'pending']);
    expect(states(status({ state: 'creating' }))).toEqual(['active', 'pending', 'pending']);
  });

  it('ticks the calendar once saved, and the invitations once verified', () => {
    const pending = status({ state: 'creating', calendar: { ...calendar, warnings: ['Invitations pending calendar verification.'] } });
    expect(states(pending)).toEqual(['done', 'active', 'pending']);
    expect(progressSteps(pending, 10)[1].detail).toBe('Checking 10 session dates with Microsoft');
    const invited = status({ state: 'creating', calendar, emails: { total: 4, accepted: 2, queued: 2, failed: 0, uncertain: 0 } });
    expect(states(invited)).toEqual(['done', 'done', 'active']);
    expect(progressSteps(invited, 10)[2].detail).toBe('2 of 4 submitted');
  });

  it('ticks every step once the server has finished', () => {
    const done = status({ state: 'done', claim: claim(201), calendar, emails: { total: 4, accepted: 3, queued: 0, failed: 1, uncertain: 0 } });
    expect(states(done)).toEqual(['done', 'done', 'done']);
    expect(progressSteps(done, 10)[2].detail).toBe('3 of 4 submitted · 1 failed');
  });
});

describe('waiting for a lost create', () => {
  it('only reads status, and stops as stalled when the budget runs out', async () => {
    const fetchStatus = vi.fn(async () => status({ state: 'creating' }));
    const answer = await waitForSavedCreate(fetchStatus, { pollMs: 1, budgetMs: 20 });
    expect(answer?.kind).toBe('stalled');
    expect(fetchStatus.mock.calls.length).toBeGreaterThan(1);
  });

  it('keeps asking through a failed status read', async () => {
    const fetchStatus = vi.fn()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(status({ state: 'done', claim: claim(200), calendar }));
    expect((await waitForSavedCreate(fetchStatus, { pollMs: 1 }))?.kind).toBe('created');
  });

  it('reports every reading, and every failed one, as it goes', async () => {
    const creating = status({ state: 'creating', calendar: { ...calendar, warnings: ['Invitations pending calendar verification.'] } });
    const fetchStatus = vi.fn()
      .mockResolvedValueOnce(creating)
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(status({ state: 'done', claim: claim(201), calendar }));
    const onStatus = vi.fn();
    expect((await waitForSavedCreate(fetchStatus, { pollMs: 1, onStatus }))?.kind).toBe('created');
    expect(onStatus.mock.calls.map(call => call[0]?.state ?? null)).toEqual(['creating', null, 'done']);
  });

  it('stops without an answer once aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    expect(await waitForSavedCreate(vi.fn(), { signal: controller.signal })).toBeNull();
  });
});
