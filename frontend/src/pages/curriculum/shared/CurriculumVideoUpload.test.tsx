import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { coachFetch } from '@/lib/coachFetch';
import { CurriculumVideoUpload } from './CurriculumVideoUpload';
import { PendingVideoFilesContext, usePendingVideoFiles } from './pendingVideoFiles';
import { parseVideoUrl, VideoPlayer } from '@/components/feature/VideoPlayer';

vi.mock('@/lib/coachFetch', () => ({ coachFetch: vi.fn() }));
const source = 'https://example.com/old.mp4';
const bunny = 'https://iframe.mediadelivery.net/embed/798153/c1c2c3c4-1234-5678-abcd-123456789abc';
const ready = { id: 'asset', status: 'ready', error: '', bunnyUrl: bunny, sourceAtStart: source };
const reply = (data: object, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
beforeEach(() => vi.mocked(coachFetch).mockReset());

it('reports a stored Bunny copy without changing the authoring source', async () => {
  vi.mocked(coachFetch).mockResolvedValue(reply({ enabled: true, import: ready }));
  render(<CurriculumVideoUpload targetId="M1" componentId="C1" title="Lesson" source={source} />);
  await screen.findByText('Stored on Bunny');
  expect(screen.getByText(/the LMS keeps the original link/)).toBeInTheDocument();
  expect(screen.getByText(/Save starts copying this video to Bunny automatically/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Import saved video link/i })).not.toBeInTheDocument();
  expect(vi.mocked(coachFetch).mock.calls.every(([, options]) => !options?.method || options.method === 'GET')).toBe(true);
});

it('sends the file, title and verified programme/cohort/group in a protected request', async () => {
  vi.mocked(coachFetch).mockResolvedValueOnce(reply({ enabled: true, import: null,
    scope: { programme_id: 'P1', cohort_id: 'CO1', group_id: 'G1' } })).mockResolvedValueOnce(reply({ import: { ...ready, status: 'processing', bunnyUrl: undefined } }, 202));
  render(<CurriculumVideoUpload targetId="M1" componentId="C1" title="Lesson" source={source} />);
  await waitFor(() => expect(coachFetch).toHaveBeenCalledTimes(1));
  const file = new File(['video'], 'lesson.mp4', { type: 'video/mp4' });
  fireEvent.change(screen.getByLabelText('Upload MP4 to LMS and Bunny'), { target: { files: [file] } });
  await screen.findByText('Bunny is processing the video');
  const body = vi.mocked(coachFetch).mock.calls[1][1]?.body as FormData;
  expect(body.get('file')).toBe(file);
  expect(body.get('title')).toBe('Lesson');
  expect(body.get('programme_id')).toBe('P1');
  expect(body.get('cohort_id')).toBe('CO1');
  expect(body.get('group_id')).toBe('G1');
});

it('shows failed import details while keeping the previous video', async () => {
  vi.mocked(coachFetch).mockResolvedValue(reply({ import: { ...ready, status: 'failed', error: 'Source needs permission.', bunnyUrl: undefined } }));
  render(<CurriculumVideoUpload targetId="M1" componentId="C1" title="Lesson" source={source} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Source needs permission.');
  expect(screen.getByText('Save this video again to retry the Bunny copy.')).toBeInTheDocument();
});

it('allows choosing an MP4 before the component is saved, without uploading yet', async () => {
  vi.mocked(coachFetch).mockResolvedValue(reply({ enabled: true, saved: false, import: null }));
  function Editor() {
    const files = usePendingVideoFiles('M1');
    return <PendingVideoFilesContext.Provider value={files}>
      <CurriculumVideoUpload targetId="M1" componentId="NEW" title="Lesson" source={source} />
    </PendingVideoFilesContext.Provider>;
  }
  render(<Editor />);
  await waitFor(() => expect(coachFetch).toHaveBeenCalledOnce());
  const picker = screen.getByLabelText('Upload MP4 to LMS and Bunny');
  expect(picker).toBeEnabled();
  fireEvent.change(picker, { target: { files: [new File(['video'], 'new-lesson.mp4')] } });
  expect(screen.getByText(/new-lesson.mp4.*Selected. Save to upload/)).toBeInTheDocument();
  expect(vi.mocked(coachFetch).mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByText('Choose an MP4, then Save to upload it to the LMS and Bunny.')).toBeInTheDocument();
});

const savedSettings = {
  videoUrl: '/curriculum_api/curriculum/uploads/videos/module/M1/C1/hash.mp4',
  sourceType: 'HTML (MP4)', provider: 'Upload file', embedCode: '',
};

it('shows the uploaded MP4 in the LMS player while its Bunny copy is queued', async () => {
  vi.mocked(coachFetch).mockResolvedValueOnce(reply({ enabled: true }))
    .mockResolvedValueOnce(reply({ import: { id: 'asset', status: 'queued', error: '' }, savedSettings }, 202));
  function Editor() {
    const [settings, setSettings] = useState({ videoUrl: '', sourceType: 'YouTube', requiredProgressPercentage: 80 });
    return <>
      <CurriculumVideoUpload targetId="M1" componentId="C1" title="Lesson" source={settings.videoUrl}
        onUploaded={patch => setSettings(previous => ({ ...previous, ...patch }))} />
      <output>{settings.requiredProgressPercentage}</output>
      {settings.videoUrl && <VideoPlayer title="Lesson" parsed={parseVideoUrl(settings.videoUrl)} />}
    </>;
  }
  const { container } = render(<Editor />);
  await waitFor(() => expect(coachFetch).toHaveBeenCalledTimes(1));
  fireEvent.change(screen.getByLabelText('Upload MP4 to LMS and Bunny'), { target: { files: [new File(['video'], 'lesson.mp4')] } });
  await screen.findByText('Waiting to upload');
  expect(container.querySelector('video')).toHaveAttribute('src', savedSettings.videoUrl);
  expect(screen.getByText('80')).toBeInTheDocument();
});

it('does not replace a newer draft source when an older upload finishes', async () => {
  let finish!: (response: Response) => void;
  vi.mocked(coachFetch).mockResolvedValueOnce(reply({ enabled: true }))
    .mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; }));
  const onUploaded = vi.fn();
  const { rerender } = render(<CurriculumVideoUpload targetId="M1" componentId="C1" title="Lesson" source={source} onUploaded={onUploaded} />);
  await waitFor(() => expect(coachFetch).toHaveBeenCalledTimes(1));
  fireEvent.change(screen.getByLabelText('Upload MP4 to LMS and Bunny'), { target: { files: [new File(['video'], 'lesson.mp4')] } });
  await waitFor(() => expect(coachFetch).toHaveBeenCalledTimes(2));
  rerender(<CurriculumVideoUpload targetId="M1" componentId="C1" title="Lesson" source="https://example.com/new.mp4" onUploaded={onUploaded} />);
  finish(reply({ import: ready, savedSettings }, 202));
  expect(await screen.findByRole('alert')).toHaveTextContent('Your current draft was kept');
  expect(onUploaded).not.toHaveBeenCalled();
});

it('never copies settings from status polling into an open draft', async () => {
  vi.mocked(coachFetch).mockResolvedValue(reply({ enabled: true, import: ready, savedSettings }));
  const onUploaded = vi.fn();
  render(<CurriculumVideoUpload targetId="M1" componentId="C1" title="Lesson" source={source} onUploaded={onUploaded} />);
  await screen.findByText('Stored on Bunny');
  expect(onUploaded).not.toHaveBeenCalled();
});

it('keeps the editor source when saving the LMS file fails', async () => {
  vi.mocked(coachFetch).mockResolvedValueOnce(reply({ enabled: true }))
    .mockResolvedValueOnce(reply({ error: 'The MP4 could not be saved for LMS playback. Retry the upload.' }, 400));
  const onUploaded = vi.fn();
  render(<CurriculumVideoUpload targetId="M1" componentId="C1" title="Lesson" source={source} onUploaded={onUploaded} />);
  await waitFor(() => expect(coachFetch).toHaveBeenCalledTimes(1));
  fireEvent.change(screen.getByLabelText('Upload MP4 to LMS and Bunny'), { target: { files: [new File(['video'], 'lesson.mp4')] } });
  expect(await screen.findByRole('alert')).toHaveTextContent('could not be saved for LMS playback');
  expect(onUploaded).not.toHaveBeenCalled();
});
