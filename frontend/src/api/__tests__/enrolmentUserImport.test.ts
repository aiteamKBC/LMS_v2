import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fetchEnrolmentUserTemplate,
  importEnrolmentUsers,
  LearnerImportError,
  type LearnerImportResult,
} from '../enrolmentUserImport';

const fetchMock = vi.fn();
const file = new File(['workbook'], 'learners.xlsx');
const result: LearnerImportResult = { count: 1, imported: 0, results: [], errors: [], preview: [] };

beforeEach(() => { vi.stubGlobal('fetch', fetchMock); });
afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks(); });

describe('learner workbook import API', () => {
  it.each([true, false])('sends an authenticated multipart request with dryRun=%s', async dryRun => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(result), { status: 200 }));
    expect(await importEnrolmentUsers(file, dryRun)).toEqual(result);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/learner_api/enrolment-users/import/');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    expect(new Headers(init.headers).get('X-Requested-With')).toBe('XMLHttpRequest');
    expect(new Headers(init.headers).has('Content-Type')).toBe(false);
    expect(init.body).toBeInstanceOf(FormData);
    expect(init.body.get('file')).toBe(file);
    expect(init.body.get('dryRun')).toBe(String(dryRun));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('preserves row errors and preview details from a rejected workbook', async () => {
    const rejected = {
      ...result,
      error: 'Please correct the workbook.',
      errors: [{ row: 3, field: 'Email', message: 'This email already exists.' }],
    };
    fetchMock.mockResolvedValue(new Response(JSON.stringify(rejected), { status: 400 }));
    await expect(importEnrolmentUsers(file, true)).rejects.toMatchObject({
      name: 'LearnerImportError', message: rejected.error, result: rejected,
    });
  });

  it('reports uncertainty after losing the import response without retrying the write', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(importEnrolmentUsers(file, false)).rejects.toThrow('Refresh the directory before trying again.');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('handles a non-JSON server error', async () => {
    fetchMock.mockResolvedValue(new Response('<html>Gateway error</html>', { status: 502 }));
    await expect(importEnrolmentUsers(file, true)).rejects.toBeInstanceOf(LearnerImportError);
  });

  it('downloads the Excel workbook using the staff session', async () => {
    const blob = new Blob(['workbook']);
    fetchMock.mockResolvedValue({ ok: true, blob: async () => blob });
    expect(await fetchEnrolmentUserTemplate()).toBe(blob);
    expect(fetchMock).toHaveBeenCalledWith('/learner_api/enrolment-users/import-template/', {
      credentials: 'include', headers: { 'X-Requested-With': 'XMLHttpRequest' },
    });
  });

  it('shows template authorization errors instead of downloading them as Excel', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'Staff access required.' }), { status: 403 }));
    await expect(fetchEnrolmentUserTemplate()).rejects.toThrow('Staff access required.');
  });
});
