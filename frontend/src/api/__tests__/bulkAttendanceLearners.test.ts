import { afterEach, expect, it, vi } from 'vitest';
import {
  fetchBulkAttendanceKbcHistory,
  fetchBulkAttendanceKbcMonthRecords,
  fetchBulkAttendanceKbcRecent,
  fetchBulkAttendanceDayLearners,
  fetchBulkAttendanceLearners,
  fetchBulkAttendanceLiveDayRecords,
  fetchBulkAttendanceLiveMonthRecords,
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

  await expect(fetchBulkAttendanceKbcHistory('42', controller.signal, {
    source: 'all', email: 'alex@example.invalid',
  })).resolves.toEqual({ records, warnings });
  const [url, options] = fetch.mock.calls[0] as [string, RequestInit];
  const query = new URL(url, 'https://lms.example.invalid').searchParams;
  expect(url).toContain('/curriculum_api/curriculum/bulk-attendance/kbc-history/');
  expect(query.get('learner_id')).toBe('42');
  expect([...query.keys()]).toEqual(['learner_id', 'source', 'learner_email']);
  expect(query.get('source')).toBe('all');
  expect(query.get('learner_email')).toBe('alex@example.invalid');
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

it('reads a module month with distinct live occurrences', async () => {
  const payload = {
    occurrences: [
      { id: 'occ-1', date: '2026-10-17', sessionNumber: 1, moduleCatalogueId: 'module-1', moduleTitle: 'Module A' },
      { id: 'occ-2', date: '2026-10-17', sessionNumber: 2, moduleCatalogueId: 'module-1', moduleTitle: 'Module A' },
    ],
    records: [{ recordKey: 'live:7', occurrenceId: 'occ-2', moduleCatalogueId: 'module-1', learnerId: '42', attendance: 'absent' }],
  };
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(payload)));
  vi.stubGlobal('fetch', fetch);
  const controller = new AbortController();
  await expect(fetchBulkAttendanceLiveMonthRecords('2026-10', 'module-1', controller.signal))
    .resolves.toEqual(payload);
  const [url, options] = fetch.mock.calls[0] as [string, RequestInit];
  const query = new URL(url, 'https://lms.example.invalid').searchParams;
  expect(query.get('month')).toBe('2026-10');
  expect(query.get('module_catalogue_id')).toBe('module-1');
  expect(options).toEqual(expect.objectContaining({ credentials: 'include', signal: controller.signal }));
});

it('reads KBC attendance records for a month and selected learners', async () => {
  const records = [{
    recordKey: 'kbc-1', learnerId: '42', sessionDate: '2026-10-12',
    moduleName: 'Project Controls', lectureName: 'Lecture 1', sessionNumber: 1,
    attendance: 'present', source: 'kbc',
  }];
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ records })));
  vi.stubGlobal('fetch', fetch);
  const controller = new AbortController();

  await expect(fetchBulkAttendanceKbcMonthRecords('2026-10', ['42', '42'], controller.signal))
    .resolves.toEqual(records);
  const [url, options] = fetch.mock.calls[0] as [string, RequestInit];
  const query = new URL(url, 'https://lms.example.invalid').searchParams;
  expect(query.get('month')).toBe('2026-10');
  expect(query.get('learner_ids')).toBe('42');
  expect(options).toEqual(expect.objectContaining({ credentials: 'include', signal: controller.signal }));
});

it('normalizes timestamp-shaped KBC dates returned by the monthly reader', async () => {
  const record = {
    recordKey: 'kbc-2', learnerId: '42', sessionDate: '2026-10-12 00:00:00+00',
    moduleName: 'Project Controls', lectureName: 'Lecture 2', sessionNumber: 2,
    attendance: 'absent' as const, source: 'kbc' as const,
  };
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ records: [record] }))));

  await expect(fetchBulkAttendanceKbcMonthRecords('2026-10', ['42']))
    .resolves.toEqual([{ ...record, sessionDate: '2026-10-12' }]);
});

it('reads a group month without requiring a module selection', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ occurrences: [], records: [] })));
  vi.stubGlobal('fetch', fetch);
  const controller = new AbortController();
  await expect(fetchBulkAttendanceLiveMonthRecords('2026-10', '', controller.signal, 'group-1'))
    .resolves.toEqual({ occurrences: [], records: [] });
  const [url, options] = fetch.mock.calls[0] as [string, RequestInit];
  const query = new URL(url, 'https://lms.example.invalid').searchParams;
  expect(query.get('month')).toBe('2026-10');
  expect(query.get('module_catalogue_id')).toBeNull();
  expect(query.get('group_id')).toBe('group-1');
  expect(options).toEqual(expect.objectContaining({ credentials: 'include', signal: controller.signal }));
});

it('includes the module ids resolved by the group filter', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ occurrences: [], records: [] })));
  vi.stubGlobal('fetch', fetch);
  await expect(fetchBulkAttendanceLiveMonthRecords(
    '2026-10', '', undefined, 'group-1', ['module-1', 'module-2', 'module-1'],
  )).resolves.toEqual({ occurrences: [], records: [] });
  const [url] = fetch.mock.calls[0] as [string, RequestInit];
  const query = new URL(url, 'https://lms.example.invalid').searchParams;
  expect(query.get('module_catalogue_ids')).toBe('module-1,module-2');
});

it('keeps a failed monthly read visible instead of treating it as an empty month', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ error: 'Register unavailable' }), { status: 503 }),
  ));
  await expect(fetchBulkAttendanceLiveMonthRecords('2026-10', 'module-1'))
    .rejects.toThrow('Register unavailable');
});

it('does not make a request when a learner has no KBC identifier', async () => {
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);

  await expect(fetchBulkAttendanceKbcHistory('')).resolves.toEqual({ records: [], warnings: [] });
  expect(fetch).not.toHaveBeenCalled();
});
