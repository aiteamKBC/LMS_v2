import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { learningFetch } from '@/lib/personalLearning';
import { coachFetch } from '@/lib/coachFetch';
import { coachingRecordingUrl, loadCoachingPdf, invalidateCoachingDetails, invalidateCoachingPdfs, loadCoachingCalendar, loadCoachingSession, loadSavedCoachingEvidence, loadCoachingQuality, loadCoachingKeywords, loadCoachLearners, loadLinkedCoachingMeeting, type CoachingCalendar, type CoachLearners } from './coachingRecordings';
import { clearAllCachedResources } from './cachedRequest';

vi.mock('@/lib/personalLearning', () => ({ learningFetch: vi.fn() }));
vi.mock('@/lib/coachFetch', () => ({ coachFetch: vi.fn() }));
const query = { start: '2026-10-01', end: '2026-10-31', timeZone: 'Europe/London' };
const page = (changes: Partial<CoachingCalendar> = {}): CoachingCalendar => ({
  ...query, scope: 'all', coaches: [{ email: 'coach@example.invalid', name: 'Coach' }], learners: [], meetings: [],
  lmsOnly: [], cancelledBookings: [], errors: [], partial: false,
  coverage: { checkedCoachEmails: ['coach@example.invalid'], totalCoaches: 1, nextOffset: null }, ...changes,
});
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const roster = (): CoachLearners => ({ ...query, coach: { email: 'coach@example.invalid', name: 'Coach' }, scope: 'own', source: 'lms', search: '',
  learners: [{ id: '1', name: 'Learner', learnerType: 'apprenticeship', bookings: [{ eventKey: 'mcr:1', eventType: 'mcr', sequence: 1,
    status: 'awaiting-signature', syncState: 'synced', cancelled: false, targetDate: '2026-10-19', scheduledDate: '2026-10-20',
    startsAt: '2026-10-20T09:00:00Z', endsAt: '2026-10-20T10:00:00Z', reviewCompletedAt: null, recordUpdatedAt: null, periodBasis: 'session' }] }],
  coverage: { offset: 0, totalLearners: 1, nextOffset: null } });

describe('Coaching calendar client', () => {
  beforeEach(() => { clearAllCachedResources(); vi.mocked(learningFetch).mockReset(); vi.mocked(coachFetch).mockReset(); });

  it('accepts verified optional Aptem completion states and rejects an unknown state', async () => {
    const evidence = { state: 'matched', source: 'coaching-session', transcript: null, analyses: [],
      completion: { source: 'aptem', state: 'awaiting-signature', checkedAt: '2026-10-24T12:00:00Z' } };
    vi.mocked(learningFetch).mockResolvedValueOnce(response({ eventKey: 'event', evidence }));
    expect((await loadSavedCoachingEvidence('event')).completion?.state).toBe('awaiting-signature');
    vi.mocked(learningFetch).mockResolvedValueOnce(response({ eventKey: 'other', evidence: { ...evidence,
      completion: { ...evidence.completion, state: 'report-missing-means-incomplete' } } }));
    await expect(loadSavedCoachingEvidence('other')).rejects.toThrow();
  });

  it('coalesces direct occurrence reads, validates their ID and renews them on explicit retry', async () => {
    const id = 'a'.repeat(32);
    const data = { meeting: { meetingId: id, calendarEventId: 'event', coachEmail: 'coach@example.invalid', eventKey: null, candidateEventKeys: [], learnerIds: [], family: null,
      startsAt: '2026-10-20T09:00:00Z', endsAt: '2026-10-20T10:00:00Z', phase: 'ended', match: 'external', readyToAction: false, recordingsReference: 'fresh-reference', media: { state: 'pending', readyCount: 0, recordings: [] } },
      coach: { email: 'coach@example.invalid', name: 'Coach' }, learners: [], syncedAt: '2026-10-20T12:00:00Z' };
    vi.mocked(learningFetch).mockImplementation(async () => response(data));
    await Promise.all([loadLinkedCoachingMeeting(id, '2026-10-20', 'UTC'), loadLinkedCoachingMeeting(id, '2026-10-20', 'UTC')]);
    expect(learningFetch).toHaveBeenCalledOnce();
    await loadLinkedCoachingMeeting(id, '2026-10-20', 'UTC', undefined, true); expect(learningFetch).toHaveBeenCalledTimes(2);
    await expect(loadLinkedCoachingMeeting('invalid', '2026-10-20', 'UTC')).rejects.toThrow('invalid ID');
    expect(learningFetch).toHaveBeenCalledTimes(2);
    await expect(loadLinkedCoachingMeeting('b'.repeat(32), '2026-10-20', 'UTC')).rejects.toThrow('different or invalid');
  });

  it('loads real PDF bytes with the signed occurrence and selected saved analysis identity', async () => {
    vi.mocked(learningFetch).mockResolvedValueOnce(new Response('%PDF-1.4\nSynthetic PDF', { headers: { 'Content-Type': 'application/pdf' } }));
    const blob = await loadCoachingPdf('event', 'analysis', 'signed', 'analysis/1+');
    expect(blob.type).toBe('application/pdf');
    const [url, options] = vi.mocked(learningFetch).mock.calls[0];
    const params = new URL(String(url), 'http://localhost').searchParams;
    expect(params.get('reference')).toBe('signed');
    expect(params.get('analysisId')).toBe('analysis/1+');
    expect(params.has('checkMicrosoft')).toBe(false);
    expect(options).toEqual(expect.objectContaining({ credentials: 'include', cache: 'no-store' }));
  });

  it('only enables the provider fallback for transcript PDFs and rejects HTML or disguised invalid PDFs', async () => {
    vi.mocked(learningFetch).mockResolvedValueOnce(new Response('%PDF-1.4\nSynthetic PDF', { headers: { 'Content-Type': 'application/pdf' } }));
    await loadCoachingPdf('event', 'transcript', 'signed');
    expect(String(vi.mocked(learningFetch).mock.calls[0][0])).toContain('checkMicrosoft=1');
    for (const type of ['text/html', 'application/pdf']) {
      vi.mocked(learningFetch).mockResolvedValueOnce(new Response('<html>Sign in</html>', { headers: { 'Content-Type': type } }));
      await expect(loadCoachingPdf('event', 'transcript')).rejects.toThrow(/PDF/);
    }
    vi.mocked(learningFetch).mockResolvedValueOnce(response({ error: 'Saved report is not available.' }, 404));
    await expect(loadCoachingPdf('event', 'analysis')).rejects.toThrow('Saved report is not available.');
  });

  it('shares PDF reads across preview, download and remounts, with bounded freshness and explicit refresh', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.mocked(learningFetch).mockImplementation(async () => new Response('%PDF-1.4\nSynthetic PDF', { headers: { 'Content-Type': 'application/pdf' } }));
    const values = await Promise.all([loadCoachingPdf('event', 'transcript', 'signed'), loadCoachingPdf('event', 'transcript', 'signed')]);
    expect(values[0]).toBe(values[1]);
    expect(await loadCoachingPdf('event', 'transcript', 'signed')).toBe(values[0]);
    expect(learningFetch).toHaveBeenCalledOnce();
    vi.setSystemTime(Date.now() + 30_001);
    await loadCoachingPdf('event', 'transcript', 'signed');
    expect(learningFetch).toHaveBeenCalledTimes(2);
    invalidateCoachingPdfs();
    await loadCoachingPdf('event', 'transcript', 'signed');
    expect(learningFetch).toHaveBeenCalledTimes(3);
  });

  it('isolates PDF kind, report identity and signed occurrence and bounds retained files', async () => {
    vi.mocked(learningFetch).mockImplementation(async () => new Response('%PDF-1.4\nSynthetic PDF', { headers: { 'Content-Type': 'application/pdf' } }));
    await loadCoachingPdf('event', 'transcript', 'signed');
    await loadCoachingPdf('event', 'analysis', 'signed', 'report-1');
    await loadCoachingPdf('event', 'analysis', 'signed', 'report-2');
    await loadCoachingPdf('event', 'transcript', 'other-signed');
    await loadCoachingPdf('other-event', 'transcript', 'signed');
    expect(learningFetch).toHaveBeenCalledTimes(5);
    await loadCoachingPdf('event', 'transcript', 'signed');
    expect(learningFetch).toHaveBeenCalledTimes(6);
  });

  it('cancels one PDF subscriber without aborting another or starting a duplicate download', async () => {
    let finish!: (response: Response) => void;
    vi.mocked(learningFetch).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const controller = new AbortController();
    const cancelled = loadCoachingPdf('event', 'transcript', 'signed', undefined, controller.signal);
    const remaining = loadCoachingPdf('event', 'transcript', 'signed');
    const rejected = expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await rejected;
    expect(vi.mocked(learningFetch).mock.calls[0][1]?.signal?.aborted).toBe(false);
    finish(new Response('%PDF-1.4\nSynthetic PDF', { headers: { 'Content-Type': 'application/pdf' } }));
    expect((await remaining).type).toBe('application/pdf');
    expect(learningFetch).toHaveBeenCalledOnce();
  });

  it('drops private PDF bytes on account reset and never lets an old in-flight read refill the cache', async () => {
    let finish!: (response: Response) => void;
    const pdf = () => new Response('%PDF-1.4\nSynthetic PDF', { headers: { 'Content-Type': 'application/pdf' } });
    vi.mocked(learningFetch).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockImplementation(async () => pdf());
    const oldRead = loadCoachingPdf('event', 'transcript', 'signed');
    clearAllCachedResources();
    finish(pdf()); await oldRead;
    await loadCoachingPdf('event', 'transcript', 'signed');
    expect(learningFetch).toHaveBeenCalledTimes(2);
    clearAllCachedResources();
    await loadCoachingPdf('event', 'transcript', 'signed');
    expect(learningFetch).toHaveBeenCalledTimes(3);
  });

  it('does not cache missing PDFs or permission failures and clears other private PDFs on denial', async () => {
    const pdf = () => new Response('%PDF-1.4\nSynthetic PDF', { headers: { 'Content-Type': 'application/pdf' } });
    vi.mocked(learningFetch).mockResolvedValueOnce(pdf()).mockResolvedValueOnce(response({ error: 'Access denied.' }, 403))
      .mockResolvedValueOnce(pdf()).mockResolvedValueOnce(response({ error: 'Not ready.' }, 404)).mockResolvedValueOnce(pdf());
    await loadCoachingPdf('event', 'transcript', 'signed');
    await expect(loadCoachingPdf('other-event', 'transcript', 'signed')).rejects.toThrow('Access denied.');
    await loadCoachingPdf('event', 'transcript', 'signed');
    await expect(loadCoachingPdf('missing-event', 'transcript', 'signed')).rejects.toThrow('Not ready.');
    await loadCoachingPdf('missing-event', 'transcript', 'signed');
    expect(learningFetch).toHaveBeenCalledTimes(5);
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

  it('publishes the first coach before later pages resolve and requests bounded batches', async () => {
    let finish!: (value: Response) => void;
    vi.mocked(learningFetch).mockResolvedValueOnce(response(page({ coverage: { checkedCoachEmails: ['one'], totalCoaches: 4, nextOffset: 1 } })))
      .mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const progress = vi.fn();
    const loading = loadCoachingCalendar(query, undefined, { onProgress: progress, refresh: true });
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    expect(progress).toHaveBeenCalledTimes(1);
    expect(progress.mock.calls[0][0].coverage.checkedCoachEmails).toEqual(['one']);
    const params = vi.mocked(learningFetch).mock.calls.map(([url]) => new URL(url, 'http://localhost').searchParams);
    expect(params.map(value => value.get('limit'))).toEqual(['1', '3']);
    expect(params.every(value => value.get('refresh') === '1')).toBe(true);
    finish(response(page({ coverage: { checkedCoachEmails: ['two', 'three', 'four'], totalCoaches: 4, nextOffset: null } })));
    expect((await loading).coverage.checkedCoachEmails).toHaveLength(4);
    expect(progress).toHaveBeenCalledTimes(2);
  });

  it('loads authorised filter choices before the first Microsoft-backed calendar response', async () => {
    let finish!: (value: Response) => void;
    vi.mocked(learningFetch).mockResolvedValueOnce(response(page({ coverage: { checkedCoachEmails: [], totalCoaches: 1, nextOffset: 0 } })))
      .mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const onDirectory = vi.fn();
    const onProgress = vi.fn();
    const loading = loadCoachingCalendar(query, undefined, { onDirectory, onProgress });
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    expect(onDirectory.mock.calls[0][0].coaches[0].name).toBe('Coach');
    expect(onProgress).not.toHaveBeenCalled();
    expect(new URL(vi.mocked(learningFetch).mock.calls[0][0], 'http://localhost').searchParams.get('directoryOnly')).toBe('1');
    finish(response(page()));
    await loading;
    expect(onProgress).toHaveBeenCalledTimes(1);
  });

  it('bounds a stalled calendar read and removes its timer', async () => {
    vi.useFakeTimers();
    vi.mocked(learningFetch).mockImplementationOnce((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    }));
    const loading = loadCoachingCalendar(query);
    const rejected = expect(loading).rejects.toThrow('taking too long');
    await vi.advanceTimersByTimeAsync(20000);
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('loads a coach roster with its date/owner scope, credentials and no write transport', async () => {
    vi.mocked(learningFetch).mockResolvedValueOnce(response(roster()));
    const data = await loadCoachLearners({ ...query, coachEmail: 'coach@example.invalid' });
    expect(data.learners[0].bookings[0].status).toBe('awaiting-signature');
    const [url, init] = vi.mocked(learningFetch).mock.calls[0];
    expect(new URL(String(url), 'http://localhost').searchParams.get('coachEmail')).toBe('coach@example.invalid');
    expect(init).toMatchObject({ credentials: 'include', cache: 'no-store' });
    expect(coachFetch).not.toHaveBeenCalled();
  });

  it('rejects a different coach, date window, search or response source', async () => {
    for (const changes of [{ coach: { email: 'other@example.invalid', name: 'Other' } }, { start: '2026-09-01' },
      { timeZone: 'UTC' }, { search: 'different' }, { source: 'microsoft' }]) {
      vi.mocked(learningFetch).mockResolvedValueOnce(response({ ...roster(), ...changes }));
      await expect(loadCoachLearners({ ...query, coachEmail: 'coach@example.invalid' })).rejects.toThrow(/scope|response/);
    }
  });

  it('rejects incomplete or duplicate roster paging and malformed booking evidence', async () => {
    const base = roster();
    const badBooking = { ...base.learners[0].bookings[0], endsAt: '2026-10-20T08:00:00Z' };
    for (const changes of [
      { coverage: { offset: 0, totalLearners: 2, nextOffset: null } },
      { coverage: { offset: 0, totalLearners: 2, nextOffset: 0 } },
      { learners: [base.learners[0], base.learners[0]], coverage: { offset: 0, totalLearners: 2, nextOffset: null } },
      { learners: [{ ...base.learners[0], bookings: [badBooking] }] },
    ]) {
      vi.mocked(learningFetch).mockResolvedValueOnce(response({ ...base, ...changes }));
      await expect(loadCoachLearners({ ...query, coachEmail: 'coach@example.invalid' })).rejects.toThrow();
    }
  });

  it('identifies revoked roster access without presenting an empty successful result', async () => {
    vi.mocked(learningFetch).mockResolvedValueOnce(response({}, 403));
    await expect(loadCoachLearners({ ...query, coachEmail: 'coach@example.invalid' })).rejects.toMatchObject({ name: 'CoachingLearnersAccessError' });
  });

  it('loads local keyword analysis with a read-only method and no AI/CSRF request', async () => {
    const data = { eventKey: 'mcr:1', method: 'keywords', state: 'complete', reviewOnly: true, retryAfter: 0,
      updatedAt: null, sampled: false, unlinkedTranscriptExcluded: false,
      result: { title: 'MCM', model: 'template-keywords-v1', mixed: false, insufficientEvidence: true,
        uncertainty: 'Context requires review.', sampled: false, unlinkedTranscriptExcluded: false,
        reviewOnly: true, references: [], types: [], analysedCharacters: 500, keywordSignals: [] } };
    vi.mocked(learningFetch).mockResolvedValueOnce(response(data));
    expect((await loadCoachingKeywords('mcr:1', 'signed-context')).method).toBe('keywords');
    expect(learningFetch).toHaveBeenCalledWith(expect.stringContaining('method=keywords'),
      expect.objectContaining({ headers: { 'X-Coaching-Context': 'signed-context' } }));
    expect(coachFetch).not.toHaveBeenCalled();
  });

  it('rejects sampled or malformed keyword responses and does not fall back to AI', async () => {
    vi.mocked(learningFetch).mockResolvedValueOnce(response({ eventKey: 'mcr:1', state: 'complete', result: null }));
    await expect(loadCoachingKeywords('mcr:1', 'signed-context')).rejects.toThrow();
    expect(coachFetch).not.toHaveBeenCalled();
  });

  it('carries both the real Django CSRF token and signed title context on generation', async () => {
    const data = { eventKey: 'mcr:1', state: 'not-analysed', result: null, reviewOnly: true,
      retryAfter: 0, updatedAt: null, sampled: false, unlinkedTranscriptExcluded: false };
    const fetchMock = vi.fn().mockResolvedValueOnce(response({ csrfToken: 'synthetic-csrf-token' }))
      .mockResolvedValueOnce(response(data));
    vi.stubGlobal('fetch', fetchMock);
    const actual = await vi.importActual<typeof import('@/lib/coachFetch')>('@/lib/coachFetch');
    vi.mocked(coachFetch).mockImplementationOnce(actual.coachFetch);
    await loadCoachingQuality('mcr:1', 'signed-context', true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe('/coach_api/csrf');
    const init = fetchMock.mock.calls[1][1] as RequestInit;
    expect(new Headers(init.headers).get('X-CSRFToken')).toBe('synthetic-csrf-token');
    expect(new Headers(init.headers).get('X-Coaching-Context')).toBe('signed-context');
    expect(init.credentials).toBe('include');
  });

  it('uses a read-only request for saved analysis and a CSRF-protected explicit POST for generation', async () => {
    const data = { eventKey: 'mcr:1', state: 'not-analysed', result: null, reviewOnly: true,
      retryAfter: 0, updatedAt: null, sampled: false, unlinkedTranscriptExcluded: false };
    vi.mocked(learningFetch).mockResolvedValueOnce(response(data));
    vi.mocked(coachFetch).mockResolvedValueOnce(response(data));
    await loadCoachingQuality('mcr:1', 'signed-context');
    expect(learningFetch).toHaveBeenCalledWith(expect.not.stringContaining('signed-context'),
      expect.objectContaining({ method: 'GET', headers: { 'X-Coaching-Context': 'signed-context' } }));
    expect(coachFetch).not.toHaveBeenCalled();
    await loadCoachingQuality('mcr:1', 'signed-context', true);
    expect(coachFetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ method: 'POST' }));
  });

  it('rejects unverified AI contracts and exposes prerequisite errors without retry', async () => {
    vi.mocked(learningFetch).mockResolvedValueOnce(response({ eventKey: 'other', state: 'complete' }));
    await expect(loadCoachingQuality('mcr:1', 'context')).rejects.toThrow('invalid response');
    vi.mocked(learningFetch).mockResolvedValueOnce(response({ error: 'No verified transcript.' }, 409));
    await expect(loadCoachingQuality('mcr:1', 'context')).rejects.toThrow('No verified transcript');
    expect(learningFetch).toHaveBeenCalledTimes(2);
  });

  it('drains coach pages and sends authenticated scoped filters on each request', async () => {
    vi.mocked(learningFetch).mockResolvedValueOnce(response(page({ coverage: { checkedCoachEmails: ['one'], totalCoaches: 2, nextOffset: 1 } })))
      .mockResolvedValueOnce(response(page({ coverage: { checkedCoachEmails: ['two'], totalCoaches: 2, nextOffset: null } })));
    const signal = new AbortController().signal;
    const data = await loadCoachingCalendar({ ...query, coachEmail: 'coach@example.invalid', learnerId: '1' }, signal);
    expect(data.coverage.checkedCoachEmails).toEqual(['one', 'two']);
    const calls = vi.mocked(learningFetch).mock.calls;
    expect(calls).toHaveLength(2);
    expect(new URL(calls[1][0], 'http://localhost').searchParams.get('offset')).toBe('1');
    expect(new URL(calls[1][0], 'http://localhost').searchParams.get('learnerId')).toBe('1');
    expect(calls[0][1]).toMatchObject({ credentials: 'include', cache: 'no-store', signal });
  });

  it('retains successful pages when the next calendar page fails', async () => {
    vi.mocked(learningFetch).mockResolvedValueOnce(response(page({ coverage: { checkedCoachEmails: ['one'], totalCoaches: 2, nextOffset: 1 } })))
      .mockRejectedValueOnce(new TypeError('Network failed'));
    const data = await loadCoachingCalendar(query);
    expect(data.partial).toBe(true);
    expect(data.coverage.checkedCoachEmails).toEqual(['one']);
    expect(data.errors.at(-1)?.code).toBe('remaining_calendars_unavailable');
  });

  it('continues after a structured unavailable page without inventing missing bookings', async () => {
    vi.mocked(learningFetch).mockResolvedValueOnce(response(page({ partial: true, errors: [{ coachEmail: 'one', code: 'calendar_read_failed' }],
      coverage: { checkedCoachEmails: [], totalCoaches: 2, nextOffset: 1 } }), 503))
      .mockResolvedValueOnce(response(page({ coverage: { checkedCoachEmails: ['two'], totalCoaches: 2, nextOffset: null } })));
    const data = await loadCoachingCalendar(query);
    expect(data.partial).toBe(true);
    expect(data.lmsOnly).toEqual([]);
    expect(data.coverage.checkedCoachEmails).toEqual(['two']);
  });

  it('does not retain earlier calendars after access is revoked', async () => {
    vi.mocked(learningFetch).mockResolvedValueOnce(response(page({ coverage: { checkedCoachEmails: ['one'], totalCoaches: 2, nextOffset: 1 } })))
      .mockResolvedValueOnce(response({ error: 'Forbidden' }, 403));
    await expect(loadCoachingCalendar(query)).rejects.toThrow('do not have access');
  });

  it('discards earlier calendars even when revoked access returns a non-JSON body', async () => {
    vi.mocked(learningFetch).mockResolvedValueOnce(response(page({ coverage: { checkedCoachEmails: ['one'], totalCoaches: 2, nextOffset: 1 } })))
      .mockResolvedValueOnce(new Response('Access denied', { status: 403 }));
    await expect(loadCoachingCalendar(query)).rejects.toThrow('do not have access');
  });

  it('discards all-scope results if the next page is restricted to own scope', async () => {
    vi.mocked(learningFetch).mockResolvedValueOnce(response(page({ coverage: { checkedCoachEmails: ['one'], totalCoaches: 2, nextOffset: 1 } })))
      .mockResolvedValueOnce(response(page({ scope: 'own' })));
    await expect(loadCoachingCalendar(query)).rejects.toThrow('previous calendar scope');
  });

  it('exposes repeated pagination as incomplete instead of looping', async () => {
    vi.mocked(learningFetch).mockResolvedValue(response(page({ coverage: { checkedCoachEmails: ['one'], totalCoaches: 2, nextOffset: 0 } })));
    const data = await loadCoachingCalendar(query);
    expect(data.partial).toBe(true);
    expect(learningFetch).toHaveBeenCalledTimes(1);
  });

  it('marks an unfinished coach inventory as partial even if paging ended', async () => {
    vi.mocked(learningFetch).mockResolvedValue(response(page({ coverage: { checkedCoachEmails: ['one'], totalCoaches: 2, nextOffset: null } })));
    const data = await loadCoachingCalendar(query);
    expect(data.partial).toBe(true);
    expect(data.errors.at(-1)?.code).toBe('remaining_calendars_unavailable');
  });

  it('rejects malformed calendar data and a mismatched date range', async () => {
    for (const data of [{}, page({ start: '2026-09-01' }), page({ meetings: [{ startsAt: 'invalid' }] as never })]) {
      vi.mocked(learningFetch).mockResolvedValueOnce(response(data));
      await expect(loadCoachingCalendar(query)).rejects.toThrow();
    }
  });

  it('preserves safe diagnostic categories and validates retryability without requiring new fields on old responses', async () => {
    const errors = [{ coachEmail: 'coach@example.invalid', code: 'calendar_mailbox_unavailable', retryable: false }];
    vi.mocked(learningFetch).mockResolvedValueOnce(response(page({ errors, partial: true })));
    expect((await loadCoachingCalendar(query)).errors).toEqual(errors);
    vi.mocked(learningFetch).mockResolvedValueOnce(response(page({ errors: [{ ...errors[0], retryable: 'false' }] as never })));
    await expect(loadCoachingCalendar(query)).rejects.toThrow();
  });

  it('propagates cancellation instead of returning stale partial data', async () => {
    const controller = new AbortController();
    vi.mocked(learningFetch).mockResolvedValueOnce(response(page({ coverage: { checkedCoachEmails: ['one'], totalCoaches: 2, nextOffset: 1 } })))
      .mockImplementationOnce(async () => { controller.abort(); throw new DOMException('Aborted', 'AbortError'); });
    await expect(loadCoachingCalendar(query, controller.signal)).rejects.toThrow('Aborted');
  });

  it('loads session details without requesting a live refresh', async () => {
    vi.mocked(learningFetch).mockResolvedValue(response({ eventKey: 'mcr:1', media: { state: 'pending', readyCount: 0, recordings: [] },
      partial: false, attendance: { state: 'pending', reportCount: 0, rows: [] } }));
    const result = await loadCoachingSession('mcr:1');
    expect(result.attendance.state).toBe('pending');
    expect(String(vi.mocked(learningFetch).mock.lastCall?.[0])).not.toContain('refresh');
  });

  it('coalesces detail requests, survives one subscriber closing, and clears on explicit refresh', async () => {
    const details = { eventKey: 'event', media: { state: 'pending', readyCount: 0, recordings: [] }, partial: false, attendance: { state: 'pending', reportCount: 0, rows: [] } };
    let finish!: (value: Response) => void;
    vi.mocked(learningFetch).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const controller = new AbortController();
    const first = loadCoachingSession('event', controller.signal).catch(error => error);
    const second = loadCoachingSession('event');
    await Promise.resolve(); controller.abort(); finish(response(details));
    expect((await first).name).toBe('AbortError'); expect(await second).toEqual(details);
    expect(await loadCoachingSession('event')).toEqual(details); expect(learningFetch).toHaveBeenCalledOnce();
    invalidateCoachingDetails(); vi.mocked(learningFetch).mockResolvedValueOnce(response(details));
    await loadCoachingSession('event'); expect(learningFetch).toHaveBeenCalledTimes(2);
  });

  it('loads lightweight evidence metadata without transferring transcript or AI bodies', async () => {
    const saved = { metadataOnly: true, source: 'coaching-session', state: 'matched', transcript: { partCount: 3, durationSeconds: null, updatedAt: null },
      analyses: [{ id: 'analysis', learnerName: 'Synthetic learner', type: 'progress_review', status: 'completed', reportAvailable: true, updatedAt: null }] };
    vi.mocked(learningFetch).mockResolvedValueOnce(response({ eventKey: 'event', evidence: saved }));
    expect(await loadSavedCoachingEvidence('event')).toEqual(saved);
    expect(new URL(vi.mocked(learningFetch).mock.calls[0][0], 'http://localhost').searchParams.get('metadataOnly')).toBe('1');
    expect(learningFetch).toHaveBeenCalledOnce();
    await loadSavedCoachingEvidence('event'); expect(learningFetch).toHaveBeenCalledOnce();
  });

  it('binds calendar-only saved details and media links to the signed occurrence reference', async () => {
    const reference = 'signed/calendar+reference';
    const saved = { eventKey: 'coach-calendar:verified', reference,
      media: { state: 'ready', readyCount: 1, recordings: [{ id: 'file/one+', state: 'ready' }] },
      partial: false, attendance: { state: 'available', reportCount: 1, rows: [] } };
    vi.mocked(learningFetch).mockResolvedValueOnce(response(saved));
    expect((await loadCoachingSession('', undefined, reference)).eventKey).toBe('coach-calendar:verified');
    const params = new URL(String(vi.mocked(learningFetch).mock.lastCall?.[0]), 'http://localhost').searchParams;
    expect(params.get('reference')).toBe(reference);
    const media = new URL(coachingRecordingUrl(saved.eventKey, 'file/one+', true, reference), 'http://localhost').searchParams;
    expect(media.get('reference')).toBe(reference);
    expect(media.get('eventKey')).toBe(saved.eventKey);
    expect(media.get('recordingId')).toBe('file/one+');
    expect(media.get('preview')).toBe('1');
    for (const changes of [{ reference: 'different' }, { reference: undefined }, { eventKey: null }]) {
      invalidateCoachingDetails();
      vi.mocked(learningFetch).mockResolvedValueOnce(response({ ...saved, ...changes }));
      await expect(loadCoachingSession('', undefined, reference)).rejects.toThrow();
    }
    expect(coachFetch).not.toHaveBeenCalled();
  });

  it('rejects session identity mismatches and incorrect ready counts', async () => {
    for (const data of [
      { eventKey: 'other', media: { state: 'pending', readyCount: 0, recordings: [] }, attendance: { state: 'pending', rows: [] } },
      { eventKey: 'mcr:1', media: { state: 'ready', readyCount: 1, recordings: [] }, partial: false, attendance: { state: 'pending', rows: [] } },
    ]) {
      vi.mocked(learningFetch).mockResolvedValueOnce(response(data));
      await expect(loadCoachingSession('mcr:1')).rejects.toThrow();
    }
  });

  it('encodes artifact identifiers as query values and keeps preview separate from download', () => {
    const url = new URL(coachingRecordingUrl('mcr:1', 'id/one+two', true), 'http://localhost');
    expect(url.searchParams.get('recordingId')).toBe('id/one+two');
    expect(url.searchParams.get('preview')).toBe('1');
    expect(coachingRecordingUrl('mcr:1', 'id')).toContain('preview=0');
  });

  it('loads attendance without heavy evidence and requests saved reports only for the same meeting scope', async () => {
    vi.mocked(learningFetch).mockResolvedValueOnce(response({ eventKey: 'event', partial: false,
      media: { state: 'pending', readyCount: 0, recordings: [] }, attendance: { state: 'pending', reportCount: 0, rows: [] } }));
    await loadCoachingSession('event', undefined, undefined, 'attendance');
    expect(new URL(vi.mocked(learningFetch).mock.calls[0][0], 'http://localhost').searchParams.get('part')).toBe('attendance');
    const saved = { state: 'matched', source: 'coaching-session', transcript: null, analyses: [] };
    vi.mocked(learningFetch).mockResolvedValueOnce(response({ eventKey: 'event', reference: 'signed', evidence: saved }));
    expect(await loadSavedCoachingEvidence('', undefined, 'signed')).toEqual(saved);
    const params = new URL(vi.mocked(learningFetch).mock.calls[1][0], 'http://localhost').searchParams;
    expect(params.get('part')).toBe('evidence');
    expect(params.get('reference')).toBe('signed');
    vi.mocked(learningFetch).mockResolvedValueOnce(response({ eventKey: 'foreign-meeting', evidence: saved }));
    await expect(loadSavedCoachingEvidence('event')).rejects.toThrow('could not be loaded');
  });

  it('accepts saved same-meeting evidence and rejects partial or foreign-source reports', async () => {
    const evidence = { source: 'coaching-session', state: 'matched',
      transcript: { content: 'Synthetic saved transcript', durationSeconds: 60, updatedAt: null },
      analyses: [{ id: 'analysis', learnerName: 'Synthetic Learner', type: 'monthly_coaching', status: 'completed',
        report: { executive_summary: 'Saved analysis' }, updatedAt: null }] };
    const details = { eventKey: 'event', partial: false, media: { state: 'pending', readyCount: 0, recordings: [] },
      attendance: { state: 'pending', reportCount: 0, rows: [] }, evidence };
    vi.mocked(learningFetch).mockResolvedValueOnce(response(details));
    expect((await loadCoachingSession('event')).evidence).toEqual(evidence);
    for (const invalid of [
      { ...evidence, source: 'another-source' },
      { ...evidence, state: 'ambiguous' },
      { ...evidence, analyses: [{ ...evidence.analyses[0], status: 'processing' }] },
      { ...evidence, analyses: [{ ...evidence.analyses[0], sourceSessionId: 'https://foreign.invalid/report' }] },
      { ...evidence, transcript: { ...evidence.transcript, durationSeconds: -1 } },
    ]) {
      invalidateCoachingDetails();
      vi.mocked(learningFetch).mockResolvedValueOnce(response({ ...details, evidence: invalid }));
      await expect(loadCoachingSession('event')).rejects.toThrow('could not be loaded');
    }
  });

  it('preserves the verified original source session identity for report and transcript links', async () => {
    const saved = { state: 'matched', source: 'coaching-session', transcript: null,
      analyses: [{ id: 'dashboard:1', sourceSessionId: 'a'.repeat(32), learnerName: 'Synthetic Learner', type: 'progress_review', status: 'completed', report: {}, updatedAt: null }] };
    vi.mocked(learningFetch).mockResolvedValueOnce(response({ eventKey: 'event', evidence: saved }));
    expect((await loadSavedCoachingEvidence('event')).analyses[0].sourceSessionId).toBe('a'.repeat(32));
  });

  it('requests Microsoft only when explicitly checking the selected transcript', async () => {
    const saved = { state: 'matched', source: 'coaching-session', analysisState: 'not-found',
      transcriptCheck: { state: 'available', code: 'verified' },
      transcript: { content: 'WEBVTT\nSynthetic verified transcript', source: 'microsoft', durationSeconds: null, updatedAt: null }, analyses: [] };
    vi.mocked(learningFetch).mockResolvedValue(response({ eventKey: 'event', evidence: saved }));
    expect((await loadSavedCoachingEvidence('event', undefined, undefined, true)).transcript?.source).toBe('microsoft');
    expect(new URL(vi.mocked(learningFetch).mock.calls[0][0], 'http://localhost').searchParams.get('checkMicrosoft')).toBe('1');
  });

  it('distinguishes a missing prerequisite from a transport failure', async () => {
    vi.mocked(learningFetch).mockResolvedValueOnce(new Response(JSON.stringify({ code: 'analysis_prerequisite', error: 'No verified transcript.' }), { status: 409 }));
    await expect(loadCoachingKeywords('event', 'context')).rejects.toMatchObject({ name: 'CoachingQualityPrerequisiteError' });
    vi.mocked(learningFetch).mockResolvedValueOnce(new Response(JSON.stringify({ code: 'analysis_storage_unavailable', error: 'Unavailable.' }), { status: 503 }));
    await expect(loadCoachingKeywords('event', 'context')).rejects.toMatchObject({ name: 'Error' });
  });

  it('returns a cached pending snapshot immediately with one request and no polling timers', async () => {
    vi.useFakeTimers();
    const sync = { pending: true, pendingCalendars: 1, pendingEvidence: 0, lastSuccessfulAt: null, directoryHash: 'one', directoryUnchanged: false, version: 'a'.repeat(64) };
    vi.mocked(learningFetch).mockResolvedValueOnce(response(page({ sync })));
    const progress = vi.fn();
    const result = await loadCoachingCalendar(query, undefined, { background: true, onProgress: progress });
    expect(result.sync?.pending).toBe(true);
    expect(progress).toHaveBeenCalledTimes(1);
    expect(learningFetch).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('accepts separate initial-check counts and rejects invalid optional counts', async () => {
    const sync = { pending: true, pendingCalendars: 1, pendingEvidence: 10,
      initialPendingCalendars: 0, initialPendingEvidence: 0,
      lastSuccessfulAt: null, directoryHash: 'one', directoryUnchanged: false };
    vi.mocked(learningFetch).mockResolvedValueOnce(response(page({ sync })));
    expect((await loadCoachingCalendar(query, undefined, { background: true })).sync).toEqual(sync);
    for (const invalid of [{ initialPendingCalendars: -1 }, { initialPendingEvidence: 1.5 }]) {
      vi.mocked(learningFetch).mockResolvedValueOnce(response(page({ sync: { ...sync, ...invalid } })));
      await expect(loadCoachingCalendar(query, undefined, { background: true })).rejects.toThrow('could not be loaded');
    }
  });

  it('conditionally revalidates a previous snapshot without transferring it again', async () => {
    const sync = { pending: true, pendingCalendars: 1, pendingEvidence: 0, lastSuccessfulAt: null, directoryHash: 'one', directoryUnchanged: false, version: 'a'.repeat(64) };
    const previous = page({ sync });
    vi.mocked(learningFetch).mockResolvedValueOnce(new Response(null, { status: 304 }));
    const result = await loadCoachingCalendar(query, undefined, { background: true, previous: { query, data: previous } });
    expect(result).toBe(previous);
    expect(learningFetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ headers: { 'If-None-Match': `"${sync.version}"`, 'X-Coaching-Delta': '1' } }));
  });

  it('merges only the verified unchanged directory into a fresh snapshot', async () => {
    const sync = { pending: false, pendingCalendars: 0, pendingEvidence: 0, lastSuccessfulAt: null, directoryHash: 'one', directoryUnchanged: false };
    const previous = page({ sync });
    vi.mocked(learningFetch).mockResolvedValueOnce(response(page({ coaches: [], learners: [], sync: { ...sync, directoryUnchanged: true } })));
    const result = await loadCoachingCalendar(query, undefined, { background: true, previous: { query, data: previous } });
    expect(result.coaches).toEqual(previous.coaches);
    expect(result.learners).toEqual(previous.learners);
  });

  it('never reuses a snapshot across coaches or suppresses an explicit refresh', async () => {
    const sync = { pending: false, pendingCalendars: 0, pendingEvidence: 0, lastSuccessfulAt: null, directoryHash: 'one', directoryUnchanged: false, version: 'a'.repeat(64) };
    for (const [oldQuery, refresh] of [[{ ...query, coachEmail: 'different@example.invalid' }, false], [query, true]] as const) {
      vi.mocked(learningFetch).mockResolvedValueOnce(response(page({ sync })));
      await loadCoachingCalendar(query, undefined, { background: true, refresh, previous: { query: oldQuery, data: page({ sync }) } });
      const init = vi.mocked(learningFetch).mock.calls.at(-1)![1];
      expect(new Headers(init?.headers).has('If-None-Match')).toBe(false);
    }
  });

  it('shares an in-flight snapshot through remount cancellation and revalidates the next completed read', async () => {
    vi.useFakeTimers();
    const sync = { pending: true, pendingCalendars: 1, pendingEvidence: 0, lastSuccessfulAt: null, directoryHash: 'one', directoryUnchanged: false };
    let finish!: (value: Response) => void;
    vi.mocked(learningFetch).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const controller = new AbortController();
    const loading = loadCoachingCalendar(query, controller.signal, { background: true });
    const rejected = expect(loading).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    const remounted = loadCoachingCalendar(query, undefined, { background: true });
    await rejected;
    expect(learningFetch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(learningFetch).mock.calls[0][1]?.signal?.aborted).toBe(false);
    finish(response(page({ sync })));
    expect((await remounted).sync?.pending).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    vi.mocked(learningFetch).mockResolvedValueOnce(response(page({ sync })));
    await loadCoachingCalendar(query, undefined, { background: true });
    expect(learningFetch).toHaveBeenCalledTimes(2);
  });

  it('does not share pending reads across queries, refreshes, versions or identity invalidation', async () => {
    const sync = { pending: false, pendingCalendars: 0, pendingEvidence: 0, lastSuccessfulAt: null, directoryHash: 'one', directoryUnchanged: false, version: 'a'.repeat(64) };
    const finish: Array<(value: Response) => void> = [];
    vi.mocked(learningFetch).mockImplementation(() => new Promise(resolve => { finish.push(resolve); }));
    const otherQuery = { ...query, coachEmail: 'other@example.invalid' };
    const reads = [
      loadCoachingCalendar(query, undefined, { background: true }),
      loadCoachingCalendar(otherQuery, undefined, { background: true }),
      loadCoachingCalendar(query, undefined, { background: true, refresh: true }),
      loadCoachingCalendar(query, undefined, { background: true, previous: { query, data: page({ sync }) } }),
    ];
    clearAllCachedResources();
    reads.push(loadCoachingCalendar(query, undefined, { background: true }));
    expect(learningFetch).toHaveBeenCalledTimes(5);
    for (const resolve of finish) resolve(response(page({ sync })));
    await Promise.all(reads);
  });

  it('does not fetch an already-aborted calendar and bounds an orphaned shared read', async () => {
    vi.useFakeTimers();
    const controller = new AbortController(); controller.abort();
    await expect(loadCoachingCalendar(query, controller.signal, { background: true })).rejects.toMatchObject({ name: 'AbortError' });
    expect(learningFetch).not.toHaveBeenCalled();
    vi.mocked(learningFetch).mockImplementationOnce((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    }));
    const pending = loadCoachingCalendar(query, undefined, { background: true });
    const rejected = expect(pending).rejects.toThrow('taking too long');
    await vi.advanceTimersByTimeAsync(20000);
    await rejected;
    expect(vi.mocked(learningFetch).mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects revoked access even when there is a previously valid cached snapshot', async () => {
    vi.mocked(learningFetch).mockResolvedValueOnce(response({}, 403));
    await expect(loadCoachingCalendar(query, undefined, { background: true, previous: { query, data: page() } })).rejects.toThrow('do not have access');
  });

  it('rejects a not-modified response with no verified previous snapshot', async () => {
    vi.mocked(learningFetch).mockResolvedValueOnce(new Response(null, { status: 304 }));
    await expect(loadCoachingCalendar(query, undefined, { background: true })).rejects.toThrow('could not be verified');
  });

  it('merges a small meeting delta while retaining unchanged meetings and removing deleted ones', async () => {
    const sync = { pending: false, pendingCalendars: 0, pendingEvidence: 0, lastSuccessfulAt: null, directoryHash: 'one', directoryUnchanged: false, version: 'a'.repeat(64) };
    const meeting: CoachingCalendar['meetings'][number] = { calendarEventId: 'one', coachEmail: 'coach@example.invalid', eventKey: null,
      candidateEventKeys: [], learnerIds: [], family: null, startsAt: '2026-10-20T09:00:00Z', endsAt: '2026-10-20T10:00:00Z',
      phase: 'ended', match: 'external', media: { state: 'pending', readyCount: 0, recordings: [] }, readyToAction: false };
    const deleted = { ...meeting, calendarEventId: 'deleted' };
    const previous = page({ sync, meetings: [meeting, { ...meeting, calendarEventId: 'unchanged' }, deleted] });
    const removedKey = JSON.stringify([deleted.coachEmail, deleted.calendarEventId, deleted.startsAt, deleted.endsAt]);
    vi.mocked(learningFetch).mockResolvedValueOnce(response({ ...page({ sync: { ...sync, version: 'b'.repeat(64) }, meetings: [{ ...meeting, title: 'Updated title' }] }),
      delta: { baseVersion: sync.version, removedMeetingKeys: [removedKey] } }));
    const result = await loadCoachingCalendar(query, undefined, { background: true, previous: { query, data: previous } });
    expect(result.meetings.map(row => row.calendarEventId).sort()).toEqual(['one', 'unchanged']);
    expect(result.meetings.find(row => row.calendarEventId === 'one')?.title).toBe('Updated title');
  });

  it('rejects deltas for another version or with unknown deleted meetings', async () => {
    const sync = { pending: false, pendingCalendars: 0, pendingEvidence: 0, lastSuccessfulAt: null, directoryHash: 'one', directoryUnchanged: false, version: 'a'.repeat(64) };
    for (const delta of [{ baseVersion: 'wrong-version', removedMeetingKeys: [] }, { baseVersion: sync.version, removedMeetingKeys: ['unknown'] }]) {
      vi.mocked(learningFetch).mockResolvedValueOnce(response({ ...page({ sync }), delta }));
      await expect(loadCoachingCalendar(query, undefined, { background: true, previous: { query, data: page({ sync }) } })).rejects.toThrow('changes could not be verified');
    }
  });

});
