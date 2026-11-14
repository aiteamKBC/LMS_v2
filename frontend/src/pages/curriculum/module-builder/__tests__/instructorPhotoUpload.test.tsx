import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ModuleOverviewModal } from '../ModuleOverviewModal';
import { EMPTY_OVERVIEW, isUploadedPhotoUrl, photoUrlProblem, type ModuleOverviewRecord } from '../moduleOverviewApi';
import { PHOTO_LIMITS, photoFileProblem, sniffImageType, type InspectedPhoto } from '../instructorPhoto';
import type { OverviewPreviewSource } from '../moduleOverviewPreview';

const RAY = 'https://jokdxsdbxorzciulkdyl.supabase.co/storage/v1/object/public/images/8feac92ab1694a919754ce97fc4973f0.webp';
const CUSTOM = 'https://images.example.org/people/ray.png';
const URL_BASE = '/curriculum_api/curriculum/modules/MOD-1/overview/';
const PHOTO_ENDPOINT = `${URL_BASE}instructor-photo/`;
const UPLOADED = '/curriculum_api/curriculum/uploads/MOD-1/instructor-photo/instructor-20261114100000000000.png';
const SOURCE: OverviewPreviewSource = { title: 'Coaching Practice', programme: 'Apprenticeships', coverUrl: '', weeks: [], outcomes: [] };

const record = (overrides: Partial<ModuleOverviewRecord> = {}): ModuleOverviewRecord => ({
  moduleCatalogueId: 'MOD-1', available: true, tutorName: 'Ray Mead', defaultPhotoUrl: RAY, hasOverview: false, updatedAt: null,
  overview: { ...EMPTY_OVERVIEW }, previousTutorDetails: null, ...overrides,
});
const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
const calls = () => vi.mocked(fetch).mock.calls.map(([url, init]) => ({ url: String(url), init: (init || {}) as RequestInit }));
const requests = (method: string, url?: string) => calls().filter(call => call.init.method === method && (!url || call.url === url));

type Handlers = { upload?: () => Response; put?: (body: Record<string, unknown>) => Response; discard?: () => Response };

function mockApi(initial: ModuleOverviewRecord, handlers: Handlers = {}) {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method || 'GET';
    if (url.endsWith('/module-overviews/csrf/')) return reply({ csrfToken: 'token-1' });
    if (url === URL_BASE && method === 'GET') return reply(initial);
    if (url === PHOTO_ENDPOINT && method === 'POST') return handlers.upload ? handlers.upload() : reply({ uploaded: true, url: UPLOADED }, 201);
    if (url === PHOTO_ENDPOINT && method === 'DELETE') return handlers.discard ? handlers.discard() : reply({ deleted: true });
    if (url === URL_BASE && method === 'PUT') {
      const body = JSON.parse(String(init!.body));
      return handlers.put ? handlers.put(body)
        : reply({ ...initial, hasOverview: true, updatedAt: '2026-11-14T10:00:00.000000Z', overview: body.overview, saved: true });
    }
    throw new Error(`Unexpected request ${method} ${url}`);
  }));
}

const PNG_OK: InspectedPhoto = { type: 'png', width: 400, height: 400 };

function renderModal(inspect: (file: File) => Promise<InspectedPhoto> = async () => PNG_OK) {
  const onClose = vi.fn();
  const onSaved = vi.fn();
  const view = render(<ModuleOverviewModal moduleCatalogueId="MOD-1" moduleTitle="Coaching Practice" onClose={onClose} onSaved={onSaved}
    loadPreviewSource={async () => SOURCE} inspectPhoto={vi.fn(inspect)} />);
  return { onClose, onSaved, ...view };
}

const photoFile = (name = 'tutor.png', type = 'image/png', size?: number) => {
  const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])], name, { type });
  if (size !== undefined) Object.defineProperty(file, 'size', { value: size });
  return file;
};
const previewPane = () => within(screen.getByRole('region', { name: 'Live preview' }));
const previewPhoto = () => previewPane().queryByRole('img', { name: 'Ray Mead' });
const editorAvatar = () => screen.getByRole('img', { name: 'Ray Mead preview' });
const chooseUploadMode = () => fireEvent.click(screen.getByRole('radio', { name: 'Upload image' }));
const fileInput = () => screen.getByLabelText(/^(Choose|Replace) image$/) as HTMLInputElement;
const selectFile = async (file: File) => {
  fireEvent.change(fileInput(), { target: { files: [file] } });
  await waitFor(() => expect(screen.queryByText('Checking the image…')).not.toBeInTheDocument());
};

let objectUrlCount = 0;
beforeEach(() => {
  objectUrlCount = 0;
  // jsdom has no object URLs; this file's environment is isolated by Vitest.
  URL.createObjectURL = vi.fn(() => `blob:preview-${++objectUrlCount}`);
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('instructor photo file checks', () => {
  it('reads the image type from the file signature', () => {
    expect(sniffImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpeg');
    expect(sniffImageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('png');
    expect(sniffImageType(new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50]))).toBe('webp');
    expect(sniffImageType(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
  });

  it('refuses wrong types, spoofed names, empty, oversized and badly sized images', async () => {
    const ok = async () => PNG_OK;
    expect(await photoFileProblem(photoFile(), ok)).toBe('');
    expect(await photoFileProblem(photoFile('a.gif', 'image/gif'), ok)).toMatch(/JPG, PNG or WebP/);
    expect(await photoFileProblem(photoFile('a.svg', 'image/svg+xml'), ok)).toMatch(/JPG, PNG or WebP/);
    expect(await photoFileProblem(photoFile('a.png', 'image/png', 0), ok)).toMatch(/empty/);
    expect(await photoFileProblem(photoFile('a.png', 'image/png', PHOTO_LIMITS.maxBytes + 1), ok)).toMatch(/maximum size is 5 MB/);
    expect(await photoFileProblem(photoFile('a.jpg', 'image/jpeg'), ok)).toMatch(/does not match/);
    expect(await photoFileProblem(photoFile(), async () => ({ type: null, width: 0, height: 0 }))).toMatch(/not a valid/);
    expect(await photoFileProblem(photoFile(), async () => { throw new Error('decode'); })).toMatch(/not a valid/);
    expect(await photoFileProblem(photoFile(), async () => ({ type: 'png', width: 40, height: 400 }))).toMatch(/too small/);
    expect(await photoFileProblem(photoFile(), async () => ({ type: 'png', width: 6001, height: 400 }))).toMatch(/too large/);
  });

  it('accepts only the uploaded instructor-photo path as a relative photo URL', () => {
    expect(isUploadedPhotoUrl(UPLOADED)).toBe(true);
    expect(photoUrlProblem(UPLOADED)).toBe('');
    for (const url of ['/curriculum_api/curriculum/uploads/MOD-1/cover/a.png', '/curriculum_api/curriculum/uploads/MOD-1/instructor-photo/a.svg',
      '/curriculum_api/curriculum/uploads/MOD-1/instructor-photo/../a.png', '/a.png']) {
      expect(photoUrlProblem(url), url).not.toBe('');
    }
  });
});

describe('Manage Module Overview: instructor photo upload', () => {
  it('previews a selected file in the editor and the live preview without uploading or saving', async () => {
    mockApi(record());
    renderModal();
    expect(await screen.findByLabelText('Instructor photo URL (optional)')).toBeVisible(); // URL mode by default
    chooseUploadMode();
    expect(screen.getByText(/No image selected. Learners see the standard/)).toBeVisible();
    await selectFile(photoFile());
    expect(editorAvatar()).toHaveAttribute('src', 'blob:preview-1');
    expect(previewPhoto()).toHaveAttribute('src', 'blob:preview-1');
    expect(screen.getByText(/Selected: tutor.png .* uploaded when you click Save overview/)).toBeVisible();
    expect(screen.getByText('Unsaved changes')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Save overview' })).toBeEnabled();
    expect(requests('POST')).toHaveLength(0);
    expect(requests('PUT')).toHaveLength(0);
  });

  it('explains an invalid or oversized file and keeps the previous photo', async () => {
    mockApi(record());
    renderModal();
    await screen.findByLabelText('Instructor photo URL (optional)');
    chooseUploadMode();
    await selectFile(photoFile('notes.gif', 'image/gif'));
    expect(screen.getByRole('alert')).toHaveTextContent('Choose a JPG, PNG or WebP image.');
    await selectFile(photoFile('big.png', 'image/png', PHOTO_LIMITS.maxBytes + 1));
    expect(screen.getByRole('alert')).toHaveTextContent('The maximum size is 5 MB.');
    expect(editorAvatar()).toHaveAttribute('src', RAY);
    expect(previewPhoto()).toHaveAttribute('src', RAY);
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument();
  });

  it('uploads on Save, then saves the returned URL in the overview and reopens on the uploaded photo', async () => {
    mockApi(record());
    const { onSaved } = renderModal();
    await screen.findByLabelText('Instructor photo URL (optional)');
    chooseUploadMode();
    await selectFile(photoFile());
    fireEvent.click(screen.getByRole('button', { name: 'Save overview' }));
    expect(await screen.findByText('Module overview saved.')).toBeVisible();

    const [upload] = requests('POST', PHOTO_ENDPOINT);
    expect(upload.init.body).toBeInstanceOf(FormData);
    expect((upload.init.body as FormData).get('file')).toBeInstanceOf(File);
    expect(new Headers(upload.init.headers).get('X-CSRFToken')).toBe('token-1');
    expect(new Headers(upload.init.headers).get('Content-Type')).toBeNull();
    const order = calls().filter(call => call.init.method === 'POST' || call.init.method === 'PUT').map(call => call.init.method);
    expect(order).toEqual(['POST', 'PUT']);
    const body = JSON.parse(String(requests('PUT')[0].init.body));
    expect(body.overview.instructorPhotoUrl).toBe(UPLOADED);
    expect(onSaved).toHaveBeenCalledWith(true);
    expect(screen.getByText('Using the uploaded photo.')).toBeVisible();
    expect(previewPhoto()).toHaveAttribute('src', UPLOADED);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview-1');
    expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument();
  });

  it('saves nothing when the upload fails', async () => {
    mockApi(record(), { upload: () => reply({ error: 'Check the highlighted fields.',
      fields: [{ field: 'instructorPhoto', message: 'The file is not a valid JPG, PNG or WebP image.' }] }, 400) });
    renderModal();
    await screen.findByLabelText('Instructor photo URL (optional)');
    chooseUploadMode();
    await selectFile(photoFile());
    fireEvent.click(screen.getByRole('button', { name: 'Save overview' }));
    expect(await screen.findByText(/The photo could not be uploaded, so nothing was saved/)).toBeVisible();
    expect(screen.getByText('The file is not a valid JPG, PNG or WebP image.')).toBeVisible();
    expect(requests('PUT')).toHaveLength(0);
    expect(requests('DELETE')).toHaveLength(0);
    // The selection stays so staff can replace it or retry.
    expect(previewPhoto()).toHaveAttribute('src', 'blob:preview-1');
  });

  it('removes the just-uploaded file when the overview save then fails, keeping the selection for a retry', async () => {
    mockApi(record(), { put: () => reply({ error: 'The module overview could not be saved. Please try again.' }, 503) });
    renderModal();
    await screen.findByLabelText('Instructor photo URL (optional)');
    chooseUploadMode();
    await selectFile(photoFile());
    fireEvent.click(screen.getByRole('button', { name: 'Save overview' }));
    expect(await screen.findByText('The module overview could not be saved. Please try again.')).toBeVisible();
    await waitFor(() => expect(requests('DELETE', PHOTO_ENDPOINT)).toHaveLength(1));
    expect(JSON.parse(String(requests('DELETE')[0].init.body))).toEqual({ url: UPLOADED });
    expect(screen.getByText(/Selected: tutor.png/)).toBeVisible();
    expect(screen.getByText('Unsaved changes')).toBeVisible();
  });

  it('Cancel and Discard changes before Save never upload or save', async () => {
    mockApi(record({ hasOverview: true, updatedAt: 'r1', overview: { ...EMPTY_OVERVIEW, instructorPhotoUrl: CUSTOM } }));
    const { onClose, unmount } = renderModal();
    await screen.findByLabelText('Instructor photo URL (optional)');
    chooseUploadMode();
    await selectFile(photoFile());
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(screen.getByLabelText('Instructor photo URL (optional)')).toHaveValue(CUSTOM);
    expect(previewPhoto()).toHaveAttribute('src', CUSTOM);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview-1');

    chooseUploadMode();
    await selectFile(photoFile('second.png'));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(confirm).toHaveBeenLastCalledWith('Discard your unsaved changes to this module overview?');
    expect(onClose).toHaveBeenCalled();
    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview-2');
    expect(requests('POST')).toHaveLength(0);
    expect(requests('PUT')).toHaveLength(0);
    expect(requests('DELETE')).toHaveLength(0);
  });

  it('replaces and removes the selected image; removing falls back to the tutor’s standard photo', async () => {
    mockApi(record());
    renderModal();
    await screen.findByLabelText('Instructor photo URL (optional)');
    chooseUploadMode();
    await selectFile(photoFile('first.png'));
    await selectFile(photoFile('second.png'));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview-1');
    expect(previewPhoto()).toHaveAttribute('src', 'blob:preview-2');
    fireEvent.click(screen.getByRole('button', { name: 'Remove photo' }));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview-2');
    expect(previewPhoto()).toHaveAttribute('src', RAY);
    expect(screen.getByLabelText('Choose image')).toBeInTheDocument();
  });

  it('removing a saved uploaded photo saves an empty photo URL and never deletes the file', async () => {
    mockApi(record({ hasOverview: true, updatedAt: 'r1', overview: { ...EMPTY_OVERVIEW, instructorPhotoUrl: UPLOADED } }));
    renderModal();
    // A saved upload opens in Upload mode, previewed.
    expect(await screen.findByText('Using the uploaded photo.')).toBeVisible();
    expect(screen.getByRole('radio', { name: 'Upload image' })).toBeChecked();
    expect(previewPhoto()).toHaveAttribute('src', UPLOADED);
    fireEvent.click(screen.getByRole('button', { name: 'Remove photo' }));
    expect(previewPhoto()).toHaveAttribute('src', RAY);
    fireEvent.click(screen.getByRole('button', { name: 'Save overview' }));
    await screen.findByText('Module overview saved.');
    expect(JSON.parse(String(requests('PUT')[0].init.body)).overview.instructorPhotoUrl).toBe('');
    expect(requests('POST')).toHaveLength(0);
    expect(requests('DELETE')).toHaveLength(0);
  });

  it('keeps one active method: switching sets the other method’s draft aside and restores it', async () => {
    mockApi(record());
    renderModal();
    fireEvent.change(await screen.findByLabelText('Instructor photo URL (optional)'), { target: { value: CUSTOM } });
    expect(previewPhoto()).toHaveAttribute('src', CUSTOM);
    chooseUploadMode();
    expect(previewPhoto()).toHaveAttribute('src', RAY); // no file chosen yet: never the URL and a file at once
    await selectFile(photoFile());
    expect(previewPhoto()).toHaveAttribute('src', 'blob:preview-1');
    fireEvent.click(screen.getByRole('radio', { name: 'Use image URL' }));
    expect(screen.getByLabelText('Instructor photo URL (optional)')).toHaveValue(CUSTOM);
    expect(previewPhoto()).toHaveAttribute('src', CUSTOM);
    chooseUploadMode();
    expect(previewPhoto()).toHaveAttribute('src', 'blob:preview-1');
    fireEvent.click(screen.getByRole('radio', { name: 'Use image URL' }));
    // Saving in URL mode sends the URL and uploads nothing.
    fireEvent.click(screen.getByRole('button', { name: 'Save overview' }));
    await screen.findByText('Module overview saved.');
    expect(requests('POST')).toHaveLength(0);
    expect(JSON.parse(String(requests('PUT')[0].init.body)).overview.instructorPhotoUrl).toBe(CUSTOM);
  });

  it('offers no photo controls without a tutor and keeps a previous tutor’s details hidden', async () => {
    mockApi(record({ tutorName: '', defaultPhotoUrl: '', previousTutorDetails: 'Andrew Millington' }));
    renderModal();
    expect(await screen.findByText(/No tutor is assigned to this module/)).toBeVisible();
    expect(screen.getByText(/Instructor details saved for Andrew Millington are kept but hidden/)).toBeVisible();
    expect(screen.queryByRole('radio', { name: 'Upload image' })).not.toBeInTheDocument();
  });

  it('hides a broken uploaded photo gracefully in the preview', async () => {
    mockApi(record({ hasOverview: true, updatedAt: 'r1', overview: { ...EMPTY_OVERVIEW, instructorPhotoUrl: UPLOADED } }));
    renderModal();
    await screen.findByText('Using the uploaded photo.');
    fireEvent.error(editorAvatar());
    expect(screen.getByText(/This image could not be loaded/)).toBeVisible();
    fireEvent.error(previewPhoto()!);
    expect(within(previewPane().getByRole('region', { name: 'Your instructor' })).queryByRole('img')).not.toBeInTheDocument();
    expect(within(previewPane().getByRole('region', { name: 'Your instructor' })).getByText('Ray Mead')).toBeVisible();
  });
});
