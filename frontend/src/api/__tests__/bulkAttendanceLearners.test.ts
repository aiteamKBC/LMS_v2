import { afterEach, expect, it, vi } from 'vitest';
import {
  fetchBulkAttendanceKbcHistory,
  fetchBulkAttendanceKbcRecent,
  fetchBulkAttendanceDayLearners,
  fetchBulkAttendanceLearners,
  fetchBulkAttendanceLiveDayRecords,
  BulkAttendanceSaveError,
  createBulkAttendanceLiveDay,
  saveBulkAttendanceChanges,
} from '../bulkAttendanceLearners';

afterEach(() => vi.unstubAllGlobals());

it('reads exact-day membership with authentication and rejects mismatched or failed responses', async () => {
  const fetch = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ date: '2020-01-02', learnerIds: ['301', '302'] })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ date: '2020-01-03', learnerIds: ['301'] })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Day unavailable' }), { status: 503 }));
  vi.stubGlobal('fetch', fetch);
  const controller = new AbortController();
  await expect(fetchBulkAttendanceDayLearners('2020-01-02', controller.signal)).resolves.toEqual(['301', '302']);
  expect(fetch).toHaveBeenCalledWith('/curriculum_api/curriculum/bulk-attendance/day-learners/?date=2020-01-02',
    expect.objectContaining({ credentials: 'include', signal: controller.signal }));
  await expect(fetchBulkAttendanceDayLearners('2020-01-02')).rejects.toThrow('invalid response');
  await expect(fetchBulkAttendanceDayLearners('2020-01-02')).rejects.toThrow('Day unavailable');
});

it('reads learner names with the authenticated transport and abort signal', async () => {
  const learners = [{ id: '42', name: 'Alex Example', email: 'alex@example.invalid' }];
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ learners })));
  vi.stubGlobal('fetch', fetch);
  const controller = new AbortController();

  await expect(fetchBulkAttendanceLearners(controller.signal)).resolves.toEqual({ learners, warnings: [] });
  expect(fetch).toHaveBeenCalledWith('/curriculum_api/curriculum/bulk-attendance/learners/',
    expect.objectContaining({ credentials: 'include', signal: controller.signal }));
});

it('reports a learner-directory failure instead of treating it as an empty directory', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ error: 'Directory unavailable' }), { status: 503 }),
  ));

  await expect(fetchBulkAttendanceLearners()).rejects.toThrow('Directory unavailable');
});

it('fetches the complete KBC history for one learner only when requested', async () => {
  const records = [{
    recordKey: 'kbc-1', learnerId: '42', sessionDate: '2026-10-12',
    moduleName: 'Project Controls', lectureName: 'Lecture 1', sessionNumber: 1,
    attendance: 'present', source: 'kbc',
  }];
  const warnings = ['The live session register could not be read; showing KBC attendance only.'];
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ records, warnings })));
  vi.stubGlobal('fetch', fetch);
  const controller = new AbortController();

  await expect(fetchBulkAttendanceKbcHistory('42', controller.signal, { source: 'all' })).resolves.toEqual({ records, warnings });
  const [url, options] = fetch.mock.calls[0] as [string, RequestInit];
  const query = new URL(url, 'https://lms.example.invalid').searchParams;
  expect(url).toContain('/curriculum_api/curriculum/bulk-attendance/kbc-history/');
  expect(query.get('learner_id')).toBe('42');
  expect([...query.keys()]).toEqual(['learner_id', 'source']);
  expect(query.get('source')).toBe('all');
  expect(options).toEqual(expect.objectContaining({ credentials: 'include', signal: controller.signal }));
});

it('reads every learner\'s recent KBC lectures in one authenticated request', async () => {
  const recent = { '42': [{
    recordKey: 'kbc-1', learnerId: '42', sessionDate: '2026-10-12',
    moduleName: 'Project Controls', lectureName: 'Lecture 1', sessionNumber: 1, attendance: 'absent', source: 'live',
  }] };
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ recent, warnings: [] })));
  vi.stubGlobal('fetch', fetch);
  const controller = new AbortController();

  await expect(fetchBulkAttendanceKbcRecent(controller.signal)).resolves.toEqual({ recent, warnings: [] });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch).toHaveBeenCalledWith('/curriculum_api/curriculum/bulk-attendance/kbc-recent/?source=live',
    expect.objectContaining({ credentials: 'include', signal: controller.signal }));
});

it('reports a recent-attendance failure instead of returning no lectures', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ error: 'Recent unavailable' }), { status: 503 }),
  ));
  await expect(fetchBulkAttendanceKbcRecent()).rejects.toThrow('Recent unavailable');
});

it('saves KBC and live corrections with a CSRF-protected POST and reports partial saves', async () => {
  const fetch = vi.fn(async (url: string) => (url === '/coach_api/csrf'
    ? new Response(JSON.stringify({ csrfToken: 'synthetic-token' }))
    : new Response(JSON.stringify({ updated: ['live:7', 'k-1'] }))));
  vi.stubGlobal('fetch', fetch);
  const changes = [
    { source: 'live' as const, recordKey: 'live:7', attendance: 'present' as const },
    { source: 'kbc' as const, recordKey: 'k-1', attendance: 'absent' as const },
  ];

  await expect(saveBulkAttendanceChanges(changes)).resolves.toEqual(['live:7', 'k-1']);
  const call = fetch.mock.calls.find(([url]) => url === '/curriculum_api/curriculum/bulk-attendance/attendance/');
  expect(call).toBeDefined();
  const options = (call as unknown as [string, RequestInit])[1];
  expect(options.method).toBe('POST');
  expect(JSON.parse(String(options.body))).toEqual({ changes });
  expect(new Headers(options.headers).get('X-CSRFToken')).toBe('synthetic-token');

  vi.stubGlobal('fetch', vi.fn(async (url: string) => (url === '/coach_api/csrf'
    ? new Response(JSON.stringify({ csrfToken: 'synthetic-token' }))
    : new Response(JSON.stringify({ error: 'Live changes were not saved.', updated: ['k-1'], partial: true }), { status: 503 }))));
  const failure = await saveBulkAttendanceChanges(changes).catch((reason: unknown) => reason);
  expect(failure).toBeInstanceOf(BulkAttendanceSaveError);
  expect((failure as BulkAttendanceSaveError).message).toBe('Live changes were not saved.');
  expect((failure as BulkAttendanceSaveError).saved).toEqual(['k-1']);
});

it('adds attendance to an existing live-session occurrence with a CSRF-protected POST', async () => {
  const fetch = vi.fn(async (url: string) => (url === '/coach_api/csrf'
    ? new Response(JSON.stringify({ csrfToken: 'synthetic-token' }))
    : new Response(JSON.stringify({ created: 2, updated: 1 }))));
  vi.stubGlobal('fetch', fetch);
  const input = {
    learnerIds: ['42', '43', '44'], moduleCatalogueId: 'module-1',
    date: '2026-10-17', attendance: 'present' as const,
  };

  await expect(createBulkAttendanceLiveDay(input)).resolves.toEqual({ created: 2, updated: 1 });
  const call = fetch.mock.calls.find(([url]) => url === '/curriculum_api/curriculum/bulk-attendance/live-day/');
  expect(call).toBeDefined();
  const options = (call as unknown as [string, RequestInit])[1];
  expect(options.method).toBe('POST');
  expect(JSON.parse(String(options.body))).toEqual(input);
  expect(new Headers(options.headers).get('X-CSRFToken')).toBe('synthetic-token');
});

it('reads saved live-session attendance for the chosen module and date', async () => {
  const records = [{
    recordKey: 'live:7', learnerId: '42', moduleCatalogueId: 'module-1',
    occurrenceId: 'occurrence-1', attendance: 'present',
  }];
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ records })));
  vi.stubGlobal('fetch', fetch);
  const controller = new AbortController();

  await expect(fetchBulkAttendanceLiveDayRecords('2026-10-17', 'module-1', controller.signal))
    .resolves.toEqual(records);
  const [url, options] = fetch.mock.calls[0] as [string, RequestInit];
  const query = new URL(url, 'https://lms.example.invalid').searchParams;
  expect(url).toContain('/curriculum_api/curriculum/bulk-attendance/live-day-records/');
  expect(query.get('date')).toBe('2026-10-17');
  expect(query.get('module_catalogue_id')).toBe('module-1');
  expect(options).toEqual(expect.objectContaining({ credentials: 'include', signal: controller.signal }));
});

it('does not make a request when a learner has no KBC identifier', async () => {
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);

  await expect(fetchBulkAttendanceKbcHistory('')).resolves.toEqual({ records: [], warnings: [] });
  expect(fetch).not.toHaveBeenCalled();
});
