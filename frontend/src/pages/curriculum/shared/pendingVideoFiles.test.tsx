import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { coachFetch } from '@/lib/coachFetch';
import { usePendingVideoFiles, withUploadedVideo } from './pendingVideoFiles';

vi.mock('@/lib/coachFetch', () => ({ coachFetch: vi.fn() }));
const component = { id: 'C1', type: 'video', title: 'New video', settings: { videoUrl: '', requiredProgressPercentage: 80 } };
const settings = { videoUrl: '/curriculum_api/curriculum/uploads/videos/module/M1/C1/hash.mp4', sourceType: 'HTML (MP4)' };
const file = new File(['video'], 'lesson.mp4', { type: 'video/mp4' });
const response = (data: object, status = 202) => new Response(JSON.stringify(data), { status });
beforeEach(() => vi.mocked(coachFetch).mockReset());

it('keeps the selected bytes in the editor until successful Save supplies the persisted component', async () => {
  const { result, rerender } = renderHook(() => usePendingVideoFiles('M1'));
  act(() => result.current.select('C1', file, ''));
  rerender(); // Selecting another inspector does not lose the editor-owned File.
  expect(result.current.files.C1.file).toBe(file);
  expect(coachFetch).not.toHaveBeenCalled();
  vi.mocked(coachFetch).mockResolvedValueOnce(response({ savedSettings: settings }));
  const stored = vi.fn();
  await act(() => result.current.uploadSaved('module', 'M1', [component], stored));
  const [url, options] = vi.mocked(coachFetch).mock.calls[0];
  expect(url).toBe('/curriculum_api/curriculum/videos/module/M1/C1/');
  expect((options?.body as FormData).get('file')).toBe(file);
  expect((options?.body as FormData).get('title')).toBe('New video');
  expect(stored).toHaveBeenCalledWith('C1', settings, '');
  expect(result.current.hasPending).toBe(false);
});

it('retains the file after failure and retries it through the next Save', async () => {
  const { result } = renderHook(() => usePendingVideoFiles('W1'));
  act(() => result.current.select('C1', file, ''));
  const stored = vi.fn();
  vi.mocked(coachFetch).mockResolvedValueOnce(response({ error: 'Storage unavailable' }, 503));
  await act(async () => { await expect(result.current.uploadSaved('template', 'W1', [component], stored)).rejects.toThrow('component was saved'); });
  expect(result.current.files.C1.error).toBe('Storage unavailable');
  expect(result.current.files.C1.file).toBe(file);
  expect(stored).not.toHaveBeenCalled();
  vi.mocked(coachFetch).mockResolvedValueOnce(response({ savedSettings: settings }));
  await act(() => result.current.uploadSaved('template', 'W1', [component], stored));
  expect(result.current.hasPending).toBe(false);
  expect(vi.mocked(coachFetch).mock.calls[1][0]).toBe('/curriculum_api/curriculum/videos/template/W1/C1/');
});

it('does not upload a removed component or overwrite a subsequently chosen source', async () => {
  const { result } = renderHook(() => usePendingVideoFiles('M1'));
  act(() => { result.current.select('REMOVED', file, ''); result.current.select('C1', file, ''); });
  await act(() => result.current.uploadSaved('module', 'M1', [{ ...component, settings: { videoUrl: 'https://example.com/new.mp4' } }], vi.fn()));
  expect(coachFetch).not.toHaveBeenCalled();
  expect(result.current.hasPending).toBe(false);
});

it('does not carry files into another module, and Discard clears them', () => {
  const { result, rerender } = renderHook(({ scope }) => usePendingVideoFiles(scope), { initialProps: { scope: 'M1' } });
  act(() => result.current.select('C1', file, ''));
  rerender({ scope: 'M2' });
  expect(result.current.hasPending).toBe(false);
  act(() => result.current.select('C2', file, ''));
  act(() => result.current.clear());
  expect(result.current.hasPending).toBe(false);
});

it('patches only the matching source while preserving other settings and newer drafts', () => {
  expect(withUploadedVideo(component, 'C1', settings, '').settings).toMatchObject({ ...settings, requiredProgressPercentage: 80 });
  const newer = { ...component, settings: { videoUrl: 'https://example.com/new.mp4' } };
  expect(withUploadedVideo(newer, 'C1', settings, '')).toBe(newer);
  expect(withUploadedVideo(component, 'OTHER', settings, '')).toBe(component);
});

it('does not restore a discarded file or apply late upload results', async () => {
  let finish!: (response: Response) => void;
  vi.mocked(coachFetch).mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; }));
  const { result } = renderHook(() => usePendingVideoFiles('M1'));
  act(() => result.current.select('C1', file, ''));
  const stored = vi.fn();
  let upload!: Promise<void>;
  act(() => { upload = result.current.uploadSaved('module', 'M1', [component], stored); });
  act(() => result.current.clear());
  await act(async () => {
    finish(response({ savedSettings: settings }));
    await expect(upload).rejects.toThrow('upload did not finish');
  });
  expect(result.current.hasPending).toBe(false);
  expect(stored).not.toHaveBeenCalled();
});
