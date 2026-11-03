import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { coachFetch } from '@/lib/coachFetch';
import { CurriculumVideoUpload } from './CurriculumVideoUpload';

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
  expect(screen.getByText(/The LMS keeps its current video link/)).toBeInTheDocument();
  expect(vi.mocked(coachFetch).mock.calls.every(([, options]) => !options?.method || options.method === 'GET')).toBe(true);
});

it('sends the file, title and verified programme/cohort/group in a protected request', async () => {
  vi.mocked(coachFetch).mockResolvedValueOnce(reply({ enabled: true, import: null,
    scope: { programme_id: 'P1', cohort_id: 'CO1', group_id: 'G1' } })).mockResolvedValueOnce(reply({ import: { ...ready, status: 'processing', bunnyUrl: undefined } }, 202));
  render(<CurriculumVideoUpload targetId="M1" componentId="C1" title="Lesson" source={source} />);
  await waitFor(() => expect(coachFetch).toHaveBeenCalledTimes(1));
  const file = new File(['video'], 'lesson.mp4', { type: 'video/mp4' });
  fireEvent.change(screen.getByLabelText('Upload video to Bunny'), { target: { files: [file] } });
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
});
