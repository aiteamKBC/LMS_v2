import { afterEach, expect, it, vi } from 'vitest';
import {
  fetchBulkAttendanceLearners,
  fetchBulkAttendanceKbcHistory,
  fetchBulkAttendanceLiveHistory,
  fetchBulkAttendanceLiveRecords,
  fetchBulkAttendanceRecords,
  updateBulkAttendanceKbcRecord,
  updateBulkAttendanceLiveRecord,
} from '../bulkAttendanceLearners';

afterEach(() => vi.unstubAllGlobals());

it('reads learner names with the authenticated transport and abort signal', async () => {
  const learners = [{ id: '42', name: 'Alex Example', email: 'alex@example.invalid' }];
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ learners })));
  vi.stubGlobal('fetch', fetch);
  const controller = new AbortController();
  expect(await fetchBulkAttendanceLearners(controller.signal)).toEqual(learners);
  expect(fetch).toHaveBeenCalledWith('/curriculum_api/curriculum/bulk-attendance/learners/',
    expect.objectContaining({ credentials: 'include', signal: controller.signal }));
});

it('shows source failures instead of returning an empty directory', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'Directory unavailable' }), { status: 503 })));
  await expect(fetchBulkAttendanceLearners()).rejects.toThrow('Directory unavailable');
});

it('rejects an invalid directory response', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}')));
  await expect(fetchBulkAttendanceLearners()).rejects.toThrow('invalid response');
});

it('requests only one selected lecture and preserves conflicting marks as unmarked', async () => {
  const records = [
    { learnerId: '42', attendance: 'present' },
    { learnerId: '43', attendance: null },
  ];
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ records })));
  vi.stubGlobal('fetch', fetch);
  const controller = new AbortController();
  expect(await fetchBulkAttendanceRecords({
    date: '2026-10-12',
    moduleNames: ['Managing Successful Programmes'],
    lectureName: 'Project Controls for Transformational Change',
    learnerIds: ['42', '43'],
  }, controller.signal)).toEqual(records);
  const [url, options] = fetch.mock.calls[0] as [string, RequestInit];
  const query = new URL(url, 'https://lms.example.invalid').searchParams;
  expect(query.get('date')).toBe('2026-10-12');
  expect(query.getAll('module_names')).toEqual(['Managing Successful Programmes']);
  expect(query.get('lecture_name')).toBe('Project Controls for Transformational Change');
  expect(query.get('learner_ids')).toBe('42,43');
  expect(options).toEqual(expect.objectContaining({ credentials: 'include', signal: controller.signal }));
});

it('does not request historical attendance when there are no KBC learners', async () => {
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  await expect(fetchBulkAttendanceRecords({
    date: '2026-10-12', moduleNames: ['Module'], lectureName: 'Lecture', learnerIds: [],
  })).resolves.toEqual([]);
  expect(fetch).not.toHaveBeenCalled();
});

it('reads live-session attendance for one curriculum module and date', async () => {
  const records = [{ learnerProfileId: '91', attendance: 'present' }];
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ records })));
  vi.stubGlobal('fetch', fetch);
  const controller = new AbortController();

  expect(await fetchBulkAttendanceLiveRecords({
    date: '2026-10-12',
    moduleCatalogueId: 'CAT-1',
  }, controller.signal)).toEqual(records);

  const [url, options] = fetch.mock.calls[0] as [string, RequestInit];
  const query = new URL(url, 'https://lms.example.invalid').searchParams;
  expect(url).toContain('/curriculum_api/curriculum/bulk-attendance/live-records/');
  expect(query.get('date')).toBe('2026-10-12');
  expect(query.get('module_catalogue_id')).toBe('CAT-1');
  expect(options).toEqual(expect.objectContaining({ credentials: 'include', signal: controller.signal }));
});

it('loads attendance history with its live occurrence and curriculum hierarchy', async () => {
  const records = [{
    attendanceId: '10', learnerProfileId: '91', learnerEmail: 'alex@example.invalid', attendance: 'present',
    occurrenceId: 'OCC-1', liveSessionId: 'LIVE-1', sessionNumber: 2,
    sessionDate: '2026-10-12', moduleCatalogueId: 'CAT-1', moduleTitle: 'Planning',
    programmeId: 'P1', programmeName: 'Engineering', cohortId: 'C1', cohortName: 'Autumn',
    groupId: 'G1', groupName: 'Group One',
  }];
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ records })));
  vi.stubGlobal('fetch', fetch);
  const controller = new AbortController();

  expect(await fetchBulkAttendanceLiveHistory({
    learnerProfileIds: ['91'], learnerEmail: 'alex@example.invalid',
  }, controller.signal)).toEqual(records);
  const [url, options] = fetch.mock.calls[0] as [string, RequestInit];
  const query = new URL(url, 'https://lms.example.invalid').searchParams;
  expect(query.get('learner_profile_ids')).toBe('91');
  expect(query.get('learner_email')).toBe('alex@example.invalid');
  expect(options).toEqual(expect.objectContaining({ credentials: 'include', signal: controller.signal }));
});

it('sends source-specific PATCH requests when a saved status changes', async () => {
  const fetch = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ csrfToken: 'test-token' })))
    .mockImplementation(() => Promise.resolve(new Response(JSON.stringify({
      record: { attendance: 'absent' },
    }))));
  vi.stubGlobal('fetch', fetch);

  await expect(updateBulkAttendanceKbcRecord({ recordKey: 'kbc-row-1', attendance: 'absent' }))
    .resolves.toEqual({ attendance: 'absent' });
  expect(fetch).toHaveBeenNthCalledWith(2,
    '/curriculum_api/curriculum/bulk-attendance/kbc-record-status/',
    expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ recordKey: 'kbc-row-1', attendance: 'absent' }) }),
  );

  await expect(updateBulkAttendanceLiveRecord({
    occurrenceId: 'OCC-1', learnerProfileId: '91', attendance: 'present',
  })).resolves.toEqual({ attendance: 'absent' });
  expect(fetch).toHaveBeenLastCalledWith(
    '/curriculum_api/curriculum/bulk-attendance/live-record-status/',
    expect.objectContaining({ method: 'PATCH' }),
  );
});

it('reads recent KBC attendance for the selected learners and module scope', async () => {
  const records = [{
    learnerId: '42', sessionDate: '2026-10-12', moduleName: 'Managing Successful Programmes',
    lectureName: 'Lec 2: Project Controls', sessionNumber: 2, attendance: 'present',
  }];
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ records })));
  vi.stubGlobal('fetch', fetch);
  const controller = new AbortController();

  expect(await fetchBulkAttendanceKbcHistory({
    date: '2026-10-12', learnerIds: ['42', '43'], moduleNames: ['Managing Successful Programmes'],
  }, controller.signal)).toEqual(records);

  const [url, options] = fetch.mock.calls[0] as [string, RequestInit];
  const query = new URL(url, 'https://lms.example.invalid').searchParams;
  expect(url).toContain('/curriculum_api/curriculum/bulk-attendance/kbc-history/');
  expect(query.get('date')).toBe('2026-10-12');
  expect(query.get('learner_ids')).toBe('42,43');
  expect(query.getAll('module_names')).toEqual(['Managing Successful Programmes']);
  expect(options).toEqual(expect.objectContaining({ credentials: 'include', signal: controller.signal }));
});

it('requests a single learner’s complete KBC history without a date cutoff', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ records: [] })));
  vi.stubGlobal('fetch', fetch);

  await fetchBulkAttendanceKbcHistory({
    learnerIds: ['42'], moduleNames: [], allHistory: true,
  });

  const query = new URL(fetch.mock.calls[0][0] as string, 'https://lms.example.invalid').searchParams;
  expect(query.get('learner_ids')).toBe('42');
  expect(query.get('all_history')).toBe('true');
  expect(query.has('date')).toBe(false);
  expect(query.getAll('module_names')).toEqual([]);
});

it('can include KBC marks without a stored lecture title only for a unique selected lecture', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ records: [] })));
  vi.stubGlobal('fetch', fetch);
  await fetchBulkAttendanceRecords({
    date: '2026-10-12', moduleNames: ['Planning'], lectureName: 'Session 1',
    learnerIds: ['42'], includeUnlabelledLecture: true,
  });
  const query = new URL(fetch.mock.calls[0][0] as string, 'https://lms.example.invalid').searchParams;
  expect(query.get('include_unlabelled')).toBe('true');
});
