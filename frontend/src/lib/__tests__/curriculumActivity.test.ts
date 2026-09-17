import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  flushCurriculumActivity,
  recordCurriculumAction,
  recordCurriculumPageView,
  recordCurriculumSearch,
  resetCurriculumActivity,
} from '../curriculumActivity';

/**
 * The recorder behind the Audit Trail's People view.
 *
 * What is guarded here is everything that is invisible when it goes wrong: a
 * beacon that fires outside Curriculum Studio widens the tracking surface
 * without anybody noticing, a duration reported as a second page view turns one
 * visit into two, and a recorder that keeps posting into a database with no
 * table to write to costs a request per navigation for the whole session.
 */

interface SentEvent {
  kind: string;
  path: string;
  durationMs?: number;
  detail?: Record<string, unknown>;
}

function sentBodies(fetchMock: ReturnType<typeof vi.fn>): Array<{ visitId: string; events: SentEvent[] }> {
  return fetchMock.mock.calls.map(call => JSON.parse((call[1] as { body: string }).body));
}

function sentEvents(fetchMock: ReturnType<typeof vi.fn>): SentEvent[] {
  return sentBodies(fetchMock).flatMap(body => body.events);
}

describe('curriculum activity recorder', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    resetCurriculumActivity();
    fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ recorded: 1, available: true }) });
    vi.stubGlobal('fetch', fetchMock);
    try {
      sessionStorage.clear();
    } catch {
      // A browser that refuses storage still records; nothing to clear.
    }
  });

  afterEach(() => {
    resetCurriculumActivity();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('records a curriculum page being opened', async () => {
    recordCurriculumPageView('/curriculum/module-builder');
    await vi.advanceTimersByTimeAsync(2500);

    const events = sentEvents(fetchMock);
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('page_view');
    expect(events[0].path).toBe('/curriculum/module-builder');
    // The account is never named by the browser: the server reads it from the
    // session, so anybody could otherwise write anybody's name into the trail.
    expect(JSON.stringify(events[0])).not.toContain('@');
  });

  it('records nothing at all outside Curriculum Studio', async () => {
    recordCurriculumPageView('/coach/caseload');
    recordCurriculumAction('search', { query: 'Alex' });
    await vi.advanceTimersByTimeAsync(5000);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports how long a page was open when it is left, against the same page', async () => {
    recordCurriculumPageView('/curriculum/cohorts');
    await vi.advanceTimersByTimeAsync(2500);
    fetchMock.mockClear();

    // Time passes on the page, then the person navigates.
    vi.setSystemTime(Date.now() + 40_000);
    recordCurriculumPageView('/curriculum/groups');
    await vi.advanceTimersByTimeAsync(2500);

    const events = sentEvents(fetchMock);
    // The close travels before the arrival, so the backend can find the row it
    // belongs to even when the two are in the same batch.
    expect(events.map(event => event.path)).toEqual(['/curriculum/cohorts', '/curriculum/groups']);
    expect(events[0].durationMs).toBeGreaterThanOrEqual(39_000);
    expect(events[1].durationMs).toBeUndefined();
  });

  it('keeps one visit across the pages of one sitting', async () => {
    recordCurriculumPageView('/curriculum/cohorts');
    await vi.advanceTimersByTimeAsync(2500);
    recordCurriculumPageView('/curriculum/groups');
    await vi.advanceTimersByTimeAsync(2500);

    const visits = new Set(sentBodies(fetchMock).map(body => body.visitId));
    expect(visits.size).toBe(1);
    expect([...visits][0]).toBeTruthy();
  });

  it('reports the term a search settled on, not every keystroke', async () => {
    recordCurriculumPageView('/curriculum/cohorts');
    await vi.advanceTimersByTimeAsync(2500);
    fetchMock.mockClear();

    recordCurriculumSearch('S', 'Cohorts');
    recordCurriculumSearch('Se', 'Cohorts');
    recordCurriculumSearch('Sept', 'Cohorts');
    await vi.advanceTimersByTimeAsync(5000);

    const searches = sentEvents(fetchMock).filter(event => event.kind === 'search');
    expect(searches).toHaveLength(1);
    expect(searches[0].detail).toMatchObject({ query: 'Sept', scope: 'Cohorts' });
  });

  it('stops recording once the server says there is no table to record into', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ recorded: 0, available: false }) });
    recordCurriculumPageView('/curriculum/cohorts');
    await vi.advanceTimersByTimeAsync(2500);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // A request per navigation for the rest of the session, into a database
    // with nothing to write to, is the thing being prevented here.
    recordCurriculumPageView('/curriculum/groups');
    recordCurriculumPageView('/curriculum/modules');
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('stops recording when the caller is not allowed to, rather than retrying forever', async () => {
    fetchMock.mockResolvedValue({ status: 403, ok: false, json: async () => ({}) });
    recordCurriculumPageView('/curriculum/cohorts');
    await vi.advanceTimersByTimeAsync(2500);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    recordCurriculumPageView('/curriculum/groups');
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('never lets a failed send reach the page', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    expect(() => {
      recordCurriculumPageView('/curriculum/cohorts');
      flushCurriculumActivity();
    }).not.toThrow();
    await vi.advanceTimersByTimeAsync(2500);
  });
});
