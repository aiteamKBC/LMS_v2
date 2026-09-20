import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  flushActivity,
  isRecordedPath,
  recordAction,
  recordPageView,
  recordSearch,
  resetActivity,
} from '../activityTrail';
import { recordCurriculumPageView } from '../curriculumActivity';

/**
 * The recorder behind the Audit Trail's People view, for the whole LMS.
 *
 * What is guarded here is everything that is invisible when it goes wrong: a
 * beacon that fires on a route the LMS has decided not to record widens the
 * tracking surface without anybody noticing, a duration reported as a second
 * page view turns one visit into two, and a recorder that keeps posting into a
 * database with no table to write to costs a request per navigation for the
 * whole session.
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

describe('LMS activity recorder', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    resetActivity();
    fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ recorded: 1, available: true }) });
    vi.stubGlobal('fetch', fetchMock);
    try {
      sessionStorage.clear();
    } catch {
      // A browser that refuses storage still records; nothing to clear.
    }
  });

  afterEach(() => {
    resetActivity();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('records a page being opened', async () => {
    recordPageView('/curriculum/module-builder');
    await vi.advanceTimersByTimeAsync(2500);

    const events = sentEvents(fetchMock);
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('page_view');
    expect(events[0].path).toBe('/curriculum/module-builder');
    // The account is never named by the browser: the server reads it from the
    // session, so anybody could otherwise write anybody's name into the trail.
    expect(JSON.stringify(events[0])).not.toContain('@');
  });

  it('records every workspace, not only Curriculum Studio', async () => {
    // This is the behaviour the system-wide trail exists for. It used to be the
    // opposite, deliberately, when the trail was curriculum's alone.
    recordPageView('/coach/caseload');
    await vi.advanceTimersByTimeAsync(2500);
    recordPageView('/safeguarding/open-cases');
    await vi.advanceTimersByTimeAsync(2500);
    recordPageView('/mis/timetables');
    await vi.advanceTimersByTimeAsync(2500);

    const opened = sentEvents(fetchMock).filter(event => event.kind === 'page_view' && !event.durationMs);
    expect(opened.map(event => event.path)).toEqual([
      '/coach/caseload',
      '/safeguarding/open-cases',
      '/mis/timetables',
    ]);
  });

  it('posts to the system-wide record endpoint', async () => {
    recordPageView('/coach/caseload');
    await vi.advanceTimersByTimeAsync(2500);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/activity/record/');
  });

  it('records nothing on the signed-out pages', async () => {
    // No account to attribute them to, and login."Login_audit" already records
    // sign-ins, resets and failed attempts properly.
    recordPageView('/login');
    recordPageView('/reset-password/some-token');
    recordAction('search', { query: 'Alex' });
    await vi.advanceTimersByTimeAsync(5000);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('records nothing inside the learner content runner', async () => {
    // One row per quiz question or video would swamp the table and say less
    // than the learner's own progress records already say.
    recordPageView('/learner/quiz/apprenticeship/98/q-1');
    recordPageView('/learner/video/apprenticeship/98/c-4');
    recordPageView('/learner/component/apprenticeship/98/c-9');
    await vi.advanceTimersByTimeAsync(5000);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('still records the learner workspace around the runner', async () => {
    recordPageView('/learner/my-learning');
    await vi.advanceTimersByTimeAsync(2500);

    expect(sentEvents(fetchMock).map(event => event.path)).toEqual(['/learner/my-learning']);
  });

  it('agrees with itself about which paths are recorded', () => {
    expect(isRecordedPath('/coach/caseload')).toBe(true);
    expect(isRecordedPath('/learner/monthly-submission')).toBe(true);
    expect(isRecordedPath('/learner/monthly-submission/apprenticeship/98')).toBe(false);
    expect(isRecordedPath('/login')).toBe(false);
  });

  it('reports how long a page was open when it is left, against the same page', async () => {
    recordPageView('/curriculum/cohorts');
    await vi.advanceTimersByTimeAsync(2500);
    fetchMock.mockClear();

    // Time passes on the page, then the person navigates.
    vi.setSystemTime(Date.now() + 40_000);
    recordPageView('/coach/caseload');
    await vi.advanceTimersByTimeAsync(2500);

    const events = sentEvents(fetchMock);
    // The close travels before the arrival, so the backend can find the row it
    // belongs to even when the two are in the same batch.
    expect(events.map(event => event.path)).toEqual(['/curriculum/cohorts', '/coach/caseload']);
    expect(events[0].durationMs).toBeGreaterThanOrEqual(39_000);
    expect(events[1].durationMs).toBeUndefined();
  });

  it('closes the open page when the person moves onto one that is not recorded', async () => {
    recordPageView('/coach/caseload');
    await vi.advanceTimersByTimeAsync(2500);
    fetchMock.mockClear();

    vi.setSystemTime(Date.now() + 30_000);
    recordPageView('/learner/quiz/apprenticeship/98/q-1');
    await vi.advanceTimersByTimeAsync(2500);

    // The visit that happened is still reported in full; only the runner page
    // itself is absent.
    const events = sentEvents(fetchMock);
    expect(events).toHaveLength(1);
    expect(events[0].path).toBe('/coach/caseload');
    expect(events[0].durationMs).toBeGreaterThanOrEqual(29_000);
  });

  it('keeps one visit across the pages of one sitting', async () => {
    recordPageView('/curriculum/cohorts');
    await vi.advanceTimersByTimeAsync(2500);
    recordPageView('/coach/caseload');
    await vi.advanceTimersByTimeAsync(2500);

    const visits = new Set(sentBodies(fetchMock).map(body => body.visitId));
    expect(visits.size).toBe(1);
    expect([...visits][0]).toBeTruthy();
  });

  it('reports the term a search settled on, not every keystroke', async () => {
    recordPageView('/coach/caseload');
    await vi.advanceTimersByTimeAsync(2500);
    fetchMock.mockClear();

    recordSearch('S', 'Caseload');
    recordSearch('Se', 'Caseload');
    recordSearch('Sept', 'Caseload');
    await vi.advanceTimersByTimeAsync(5000);

    const searches = sentEvents(fetchMock).filter(event => event.kind === 'search');
    expect(searches).toHaveLength(1);
    expect(searches[0].detail).toMatchObject({ query: 'Sept', scope: 'Caseload' });
  });

  it('stops recording once the server says there is no table to record into', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ recorded: 0, available: false }) });
    recordPageView('/curriculum/cohorts');
    await vi.advanceTimersByTimeAsync(2500);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // A request per navigation for the rest of the session, into a database
    // with nothing to write to, is the thing being prevented here.
    recordPageView('/curriculum/groups');
    recordPageView('/curriculum/modules');
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('stops recording when the caller is not allowed to, rather than retrying forever', async () => {
    fetchMock.mockResolvedValue({ status: 403, ok: false, json: async () => ({}) });
    recordPageView('/curriculum/cohorts');
    await vi.advanceTimersByTimeAsync(2500);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    recordPageView('/curriculum/groups');
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('never lets a failed send reach the page', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    expect(() => {
      recordPageView('/curriculum/cohorts');
      flushActivity();
    }).not.toThrow();
    await vi.advanceTimersByTimeAsync(2500);
  });

  it('keeps the old curriculum spelling working', async () => {
    // Curriculum pages import these names today; a module move must not be a
    // breaking change for them.
    recordCurriculumPageView('/curriculum/quality');
    await vi.advanceTimersByTimeAsync(2500);

    expect(sentEvents(fetchMock).map(event => event.path)).toEqual(['/curriculum/quality']);
  });
});
