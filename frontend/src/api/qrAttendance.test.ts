import { afterEach, expect, it, vi } from 'vitest';
import { qrAttendanceApi } from './qrAttendance';

afterEach(() => vi.unstubAllGlobals());

it('keeps email out of the URL and sends CSRF on every post', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ modules: [], suggestions: [] }), { status: 200 }));
  vi.stubGlobal('fetch', fetcher);
  await qrAttendanceApi.lookup('csrf', 'student@example.test');
  expect(fetcher).toHaveBeenCalledWith('/curriculum_api/qr-attendance/', expect.objectContaining({
    method: 'POST', credentials: 'same-origin', cache: 'no-store',
    headers: expect.objectContaining({ 'X-CSRFToken': 'csrf' }),
    body: JSON.stringify({ action: 'lookup', email: 'student@example.test' }),
  }));
});

it('preserves duplicate success and surfaces genuine storage errors', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ recorded: true, alreadyRecorded: true }), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Please try again.' }), { status: 503 })));
  expect(await qrAttendanceApi.confirm('csrf', 'student@example.test', 'M1', 'O1')).toMatchObject({ alreadyRecorded: true });
  await expect(qrAttendanceApi.confirm('csrf', 'student@example.test', 'M1', 'O1')).rejects.toThrow('Please try again.');
});
