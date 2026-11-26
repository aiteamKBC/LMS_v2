import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { coachFetch } from '@/lib/coachFetch';
import { downloadSavedPresentation } from './presentationDownload';

vi.mock('@/lib/coachFetch', () => ({ coachFetch: vi.fn() }));
const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const PPT = 'application/vnd.ms-powerpoint';
const input = { scope: 'official' as const, submissionId: 'submission-id', submittedAt: '2026-10-28T09:00:00+00:00' };
function response(type = PPTX, name = 'attachment; filename="saved.pptx"') {
  return new Response(new Uint8Array([80, 75, 3, 4, 1]), { headers: { 'Content-Type': type, 'Content-Disposition': name } });
}
beforeEach(() => { vi.mocked(coachFetch).mockReset().mockResolvedValue(response()); });
afterEach(() => vi.clearAllMocks());

it('downloads official submitted work with its displayed revision and session transport', async () => {
  const controller = new AbortController();
  const result = await downloadSavedPresentation({ ...input, signal: controller.signal });
  const [target, init] = vi.mocked(coachFetch).mock.calls[0];
  const url = new URL(String(target), 'http://local.test');
  expect(url.pathname).toBe('/coach_api/coach/marking-queue/submission-id/presentation');
  expect(url.searchParams.get('submittedAt')).toBe(input.submittedAt);
  expect(url.searchParams.has('learnerId')).toBe(false);
  expect(init).toMatchObject({ signal: controller.signal });
  expect(init?.body).toBeUndefined();
  expect(result.filename).toBe('saved.pptx');
  expect(result.blob.size).toBe(5);
});

it('keeps personal coursework separate and sends the displayed version', async () => {
  await downloadSavedPresentation({ ...input, scope: 'personal', version: 7 });
  const url = new URL(String(vi.mocked(coachFetch).mock.calls[0][0]), 'http://local.test');
  expect(url.pathname).toBe('/coach_api/coach/personal-marking/submission-id/presentation');
  expect(url.searchParams.get('version')).toBe('7');
});

it('preserves legacy PPT and safely decodes international filenames', async () => {
  vi.mocked(coachFetch).mockResolvedValue(response(PPT, "attachment; filename*=UTF-8''%D8%AA%D8%AF%D8%B1%D9%8A%D8%A8.ppt"));
  expect((await downloadSavedPresentation(input)).filename).toBe('تدريب.ppt');
  vi.mocked(coachFetch).mockResolvedValue(response(PPTX, 'attachment; filename="a\\\"quote.pptx"'));
  expect((await downloadSavedPresentation(input)).filename).toBe('a_quote.pptx');
});

it.each([401, 403, 404, 409, 503])('surfaces a %s error instead of saving an error response as a presentation', async status => {
  vi.mocked(coachFetch).mockResolvedValue(new Response(JSON.stringify({ detail: 'Saved presentation unavailable.' }), { status }));
  await expect(downloadSavedPresentation(input)).rejects.toThrow('Saved presentation unavailable.');
});

it('rejects a successful HTML/JSON response and an empty PowerPoint file', async () => {
  vi.mocked(coachFetch).mockResolvedValue(new Response('<html>Sign in</html>', { headers: { 'Content-Type': 'text/html' } }));
  await expect(downloadSavedPresentation(input)).rejects.toThrow('did not return a PowerPoint');
  vi.mocked(coachFetch).mockResolvedValue(new Response('', { headers: { 'Content-Type': PPTX } }));
  await expect(downloadSavedPresentation(input)).rejects.toThrow('file is empty');
});

it('preserves the standard session error message from the authentication gate', async () => {
  vi.mocked(coachFetch).mockResolvedValue(new Response(JSON.stringify({ error: 'Your session has expired. Please sign in.' }), { status: 401 }));
  await expect(downloadSavedPresentation(input)).rejects.toThrow('Your session has expired. Please sign in.');
});

it('reports invalid encoded filenames and uses a safe fallback for missing headers', async () => {
  vi.mocked(coachFetch).mockResolvedValue(response(PPTX, "attachment; filename*=UTF-8''bad%XX.pptx"));
  await expect(downloadSavedPresentation(input)).rejects.toThrow('invalid filename');
  vi.mocked(coachFetch).mockResolvedValue(response(PPTX, 'attachment'));
  expect((await downloadSavedPresentation(input)).filename).toBe('presentation.pptx');
});
