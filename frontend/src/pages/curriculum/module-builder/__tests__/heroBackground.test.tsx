import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ModuleOverviewModal } from '../ModuleOverviewModal';
import { EMPTY_OVERVIEW, heroBackgroundUrlProblem, isUploadedHeroUrl, photoUrlProblem, type ModuleOverviewRecord } from '../moduleOverviewApi';
import { buildPreviewModel, type OverviewPreviewSource } from '../moduleOverviewPreview';
import { HERO_LIMITS, PHOTO_LIMITS, photoFileProblem, type InspectedPhoto } from '../instructorPhoto';
import type { MyLearningModule } from '@/api/myLearning';
import { buildModuleOverviewModel } from '@/pages/learner/my-learning/moduleOverviewModel';
import { ModuleOverviewView } from '@/pages/learner/my-learning/ModuleOverviewView';

const RAY = 'https://jokdxsdbxorzciulkdyl.supabase.co/storage/v1/object/public/images/8feac92ab1694a919754ce97fc4973f0.webp';
const REMOTE = 'https://images.example.org/banners/campus.webp';
const URL_BASE = '/curriculum_api/curriculum/modules/MOD-1/overview/';
const HERO_ENDPOINT = `${URL_BASE}hero-background/`;
const PHOTO_ENDPOINT = `${URL_BASE}instructor-photo/`;
const UPLOADED_HERO = '/curriculum_api/curriculum/uploads/MOD-1/hero-background/hero-20261114100000000000.jpg';
const UPLOADED_PHOTO = '/curriculum_api/curriculum/uploads/MOD-1/instructor-photo/instructor-20261114100000000000.png';
const SOURCE: OverviewPreviewSource = { title: 'Coaching Practice', programme: 'Apprenticeships', coverUrl: 'https://images.example.org/cover.png', weeks: [], outcomes: [] };

const record = (overrides: Partial<ModuleOverviewRecord> = {}): ModuleOverviewRecord => ({
  moduleCatalogueId: 'MOD-1', available: true, tutorName: 'Ray Mead', defaultPhotoUrl: RAY, hasOverview: false, updatedAt: null,
  overview: { ...EMPTY_OVERVIEW }, previousTutorDetails: null, ...overrides,
});
const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
const calls = () => vi.mocked(fetch).mock.calls.map(([url, init]) => ({ url: String(url), init: (init || {}) as RequestInit }));
const requests = (method: string, url?: string) => calls().filter(call => call.init.method === method && (!url || call.url === url));

type Handlers = { hero?: () => Response; photo?: () => Response; put?: () => Response };

function mockApi(initial: ModuleOverviewRecord, handlers: Handlers = {}) {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method || 'GET';
    if (url.endsWith('/module-overviews/csrf/')) return reply({ csrfToken: 'token-1' });
    if (url === URL_BASE && method === 'GET') return reply(initial);
    if (url === HERO_ENDPOINT && method === 'POST') return handlers.hero ? handlers.hero() : reply({ uploaded: true, url: UPLOADED_HERO }, 201);
    if (url === PHOTO_ENDPOINT && method === 'POST') return handlers.photo ? handlers.photo() : reply({ uploaded: true, url: UPLOADED_PHOTO }, 201);
    if ((url === HERO_ENDPOINT || url === PHOTO_ENDPOINT) && method === 'DELETE') return reply({ deleted: true });
    if (url === URL_BASE && method === 'PUT') {
      const body = JSON.parse(String(init!.body));
      return handlers.put ? handlers.put()
        : reply({ ...initial, hasOverview: true, updatedAt: '2026-11-14T10:00:00.000000Z', overview: body.overview, saved: true });
    }
    throw new Error(`Unexpected request ${method} ${url}`);
  }));
}

const WIDE: InspectedPhoto = { type: 'jpeg', width: 1600, height: 500 };

function renderModal(inspect: (file: File) => Promise<InspectedPhoto> = async () => WIDE) {
  const onClose = vi.fn();
  const view = render(<ModuleOverviewModal moduleCatalogueId="MOD-1" moduleTitle="Coaching Practice" onClose={onClose}
    loadPreviewSource={async () => SOURCE} inspectPhoto={vi.fn(inspect)} />);
  return { onClose, ...view };
}

const bannerFile = (name = 'campus.jpg', type = 'image/jpeg') => new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0])], name, { type });
const previewPane = () => within(screen.getByRole('region', { name: 'Live preview' }));
const previewBand = () => previewPane().queryByTestId('hero-background');
const thumbnail = () => screen.queryByRole('img', { name: 'Hero background preview' });
const heroUrlInput = () => screen.getByLabelText('Hero background image URL (optional)');
const chooseHeroUpload = () => fireEvent.click(screen.getByRole('radio', { name: 'Upload Hero background image' }));
const chooseHeroUrl = () => fireEvent.click(screen.getByRole('radio', { name: 'Use Hero background image URL' }));
const heroFileInput = () => screen.getByLabelText(/^(Choose|Replace) background image$/) as HTMLInputElement;
const selectHero = async (file: File) => {
  fireEvent.change(heroFileInput(), { target: { files: [file] } });
  await waitFor(() => expect(screen.queryByText('Checking the image…')).not.toBeInTheDocument());
};
const putBody = () => JSON.parse(String(requests('PUT')[0].init.body));

let objectUrlCount = 0;
beforeEach(() => {
  objectUrlCount = 0;
  // jsdom has no object URLs; this file's environment is isolated by Vitest.
  URL.createObjectURL = vi.fn(() => `blob:hero-${++objectUrlCount}`);
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('Hero background validation', () => {
  it('accepts public https images and uploaded Hero backgrounds only', () => {
    expect(heroBackgroundUrlProblem('')).toBe('');
    expect(heroBackgroundUrlProblem(REMOTE)).toBe('');
    expect(heroBackgroundUrlProblem(UPLOADED_HERO)).toBe('');
    expect(isUploadedHeroUrl(UPLOADED_HERO)).toBe(true);
    for (const url of ['http://x.org/a.png', 'javascript:alert(1)', UPLOADED_PHOTO, '/curriculum_api/curriculum/uploads/MOD-1/cover/a.png',
      '/curriculum_api/curriculum/uploads/MOD-1/hero-background/a.svg']) {
      expect(heroBackgroundUrlProblem(url), url).not.toBe('');
    }
    // A Hero upload is not an instructor photo either.
    expect(photoUrlProblem(UPLOADED_HERO)).not.toBe('');
  });

  it('uses banner limits for Hero files and leaves the instructor photo limits alone', async () => {
    const square = async () => ({ type: 'jpeg' as const, width: 400, height: 400 });
    expect(await photoFileProblem(bannerFile(), square, HERO_LIMITS)).toMatch(/at least 640 × 200 pixels/);
    expect(await photoFileProblem(bannerFile(), square)).toBe(''); // still a fine instructor photo
    expect(PHOTO_LIMITS).toMatchObject({ maxBytes: 5 * 1024 * 1024, minSide: 64, maxSide: 6000 });
    const big = bannerFile();
    Object.defineProperty(big, 'size', { value: HERO_LIMITS.maxBytes + 1 });
    expect(await photoFileProblem(big, async () => WIDE, HERO_LIMITS)).toMatch(/maximum size is 8 MB/);
  });
});

describe('Manage Module Overview: Hero background', () => {
  it('previews a URL immediately in the editor and the Live Preview, and removing it restores the standard band', async () => {
    mockApi(record());
    renderModal();
    expect(await screen.findByLabelText('Short summary')).toBeVisible(); // existing field kept
    expect(previewBand()).not.toBeInTheDocument();
    expect(screen.getByText('Standard lilac background')).toBeVisible();
    fireEvent.change(heroUrlInput(), { target: { value: REMOTE } });
    expect(thumbnail()).toHaveAttribute('src', REMOTE);
    expect(previewBand()).toHaveAttribute('src', REMOTE);
    fireEvent.click(screen.getByRole('button', { name: 'Remove background URL' }));
    expect(previewBand()).not.toBeInTheDocument();
    expect(requests('PUT')).toHaveLength(0);
  });

  it('refuses an invalid URL before saving and never previews it', async () => {
    mockApi(record());
    renderModal();
    fireEvent.change(await screen.findByLabelText('Hero background image URL (optional)'), { target: { value: 'http://images.example.org/a.jpg' } });
    expect(previewBand()).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save overview' }));
    expect(await screen.findByText('The image must use an https:// address.')).toBeVisible();
    expect(heroUrlInput()).toHaveAttribute('aria-invalid', 'true');
    expect(requests('PUT')).toHaveLength(0);
  });

  it('saves a URL in the overview and reopens with it', async () => {
    mockApi(record());
    renderModal();
    fireEvent.change(await screen.findByLabelText('Hero background image URL (optional)'), { target: { value: REMOTE } });
    fireEvent.click(screen.getByRole('button', { name: 'Save overview' }));
    await screen.findByText('Module overview saved.');
    expect(putBody().overview.heroBackgroundUrl).toBe(REMOTE);
    expect(requests('POST')).toHaveLength(0);
    expect(heroUrlInput()).toHaveValue(REMOTE);
    expect(previewBand()).toHaveAttribute('src', REMOTE);
  });

  it('previews a selected file without uploading, then uploads on Save and saves the returned URL', async () => {
    mockApi(record());
    renderModal();
    await screen.findByLabelText('Short summary');
    chooseHeroUpload();
    expect(screen.getByText('No image selected. Learners see the standard lilac background.')).toBeVisible();
    await selectHero(bannerFile());
    expect(previewBand()).toHaveAttribute('src', 'blob:hero-1');
    expect(thumbnail()).toHaveAttribute('src', 'blob:hero-1');
    expect(screen.getByText('Unsaved changes')).toBeVisible();
    expect(requests('POST')).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'Save overview' }));
    expect(await screen.findByText('Module overview saved.')).toBeVisible();
    const [upload] = requests('POST', HERO_ENDPOINT);
    expect((upload.init.body as FormData).get('file')).toBeInstanceOf(File);
    expect(new Headers(upload.init.headers).get('X-CSRFToken')).toBe('token-1');
    expect(requests('POST', PHOTO_ENDPOINT)).toHaveLength(0);
    expect(putBody().overview.heroBackgroundUrl).toBe(UPLOADED_HERO);
    // Reopened on the saved upload.
    expect(screen.getByText('Using the uploaded background image.')).toBeVisible();
    expect(screen.getByRole('radio', { name: 'Upload Hero background image' })).toBeChecked();
    expect(previewBand()).toHaveAttribute('src', UPLOADED_HERO);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:hero-1');
  });

  it('explains a file that is too small for a banner and keeps the current background', async () => {
    mockApi(record({ hasOverview: true, updatedAt: 'r1', overview: { ...EMPTY_OVERVIEW, heroBackgroundUrl: REMOTE } }));
    renderModal(async () => ({ type: 'jpeg', width: 300, height: 300 }));
    expect(await screen.findByLabelText('Hero background image URL (optional)')).toHaveValue(REMOTE);
    chooseHeroUpload();
    await selectHero(bannerFile());
    expect(screen.getByRole('alert')).toHaveTextContent('The image is too small. Use at least 640 × 200 pixels.');
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it('saves nothing when the upload fails', async () => {
    mockApi(record(), { hero: () => reply({ error: 'Check the highlighted fields.',
      fields: [{ field: 'heroBackground', message: 'The file is not a valid JPG, PNG or WebP image.' }] }, 400) });
    renderModal();
    await screen.findByLabelText('Short summary');
    chooseHeroUpload();
    await selectHero(bannerFile());
    fireEvent.click(screen.getByRole('button', { name: 'Save overview' }));
    expect(await screen.findByText(/The background image could not be uploaded, so nothing was saved/)).toBeVisible();
    expect(screen.getByText('The file is not a valid JPG, PNG or WebP image.')).toBeVisible();
    expect(requests('PUT')).toHaveLength(0);
    expect(previewBand()).toHaveAttribute('src', 'blob:hero-1');
  });

  it('cleans up the uploads when the overview save fails, and when a second upload fails', async () => {
    mockApi(record(), { put: () => reply({ error: 'The module overview could not be saved. Please try again.' }, 503) });
    const first = renderModal();
    await screen.findByLabelText('Short summary');
    chooseHeroUpload();
    await selectHero(bannerFile());
    fireEvent.click(screen.getByRole('button', { name: 'Save overview' }));
    expect(await screen.findByText('The module overview could not be saved. Please try again.')).toBeVisible();
    await waitFor(() => expect(requests('DELETE', HERO_ENDPOINT)).toHaveLength(1));
    expect(JSON.parse(String(requests('DELETE', HERO_ENDPOINT)[0].init.body))).toEqual({ url: UPLOADED_HERO });
    expect(screen.getByText(/Selected: campus.jpg/)).toBeVisible();
    first.unmount();

    // Photo uploads, then the Hero upload fails: the photo is removed and nothing is saved.
    mockApi(record(), { hero: () => reply({ error: 'The background image could not be uploaded. Nothing was saved; please try again.' }, 503) });
    renderModal(async file => (file.name.endsWith('.png') ? { type: 'png', width: 400, height: 400 } : WIDE));
    await screen.findByLabelText('Short summary');
    fireEvent.click(screen.getByRole('radio', { name: 'Upload image' })); // instructor photo
    fireEvent.change(screen.getByLabelText('Choose image'), { target: { files: [new File([new Uint8Array([0x89])], 'tutor.png', { type: 'image/png' })] } });
    await screen.findByText(/Selected: tutor.png/);
    chooseHeroUpload();
    await selectHero(bannerFile());
    fireEvent.click(screen.getByRole('button', { name: 'Save overview' }));
    expect(await screen.findByText(/The background image could not be uploaded, so nothing was saved/)).toBeVisible();
    await waitFor(() => expect(requests('DELETE', PHOTO_ENDPOINT)).toHaveLength(1));
    expect(requests('PUT')).toHaveLength(0);
  });

  it('Cancel and Discard changes never upload or save', async () => {
    mockApi(record({ hasOverview: true, updatedAt: 'r1', overview: { ...EMPTY_OVERVIEW, heroBackgroundUrl: REMOTE } }));
    const { onClose, unmount } = renderModal();
    await screen.findByLabelText('Hero background image URL (optional)');
    chooseHeroUpload();
    await selectHero(bannerFile());
    expect(previewBand()).toHaveAttribute('src', 'blob:hero-1');
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(heroUrlInput()).toHaveValue(REMOTE);
    expect(previewBand()).toHaveAttribute('src', REMOTE);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:hero-1');
    chooseHeroUpload();
    await selectHero(bannerFile('second.jpg'));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:hero-2');
    expect(requests('POST')).toHaveLength(0);
    expect(requests('PUT')).toHaveLength(0);
  });

  it('replaces and removes an image, keeps one active method, and never deletes a saved file', async () => {
    mockApi(record({ hasOverview: true, updatedAt: 'r1', overview: { ...EMPTY_OVERVIEW, heroBackgroundUrl: UPLOADED_HERO } }));
    renderModal();
    expect(await screen.findByText('Using the uploaded background image.')).toBeVisible();
    await selectHero(bannerFile('first.jpg'));
    await selectHero(bannerFile('second.jpg'));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:hero-1');
    expect(previewBand()).toHaveAttribute('src', 'blob:hero-2');
    // Switch to URL: the selected file is set aside, never shown together with a URL.
    chooseHeroUrl();
    expect(heroUrlInput()).toHaveValue('');
    expect(previewBand()).not.toBeInTheDocument();
    fireEvent.change(heroUrlInput(), { target: { value: REMOTE } });
    expect(previewBand()).toHaveAttribute('src', REMOTE);
    chooseHeroUpload();
    expect(previewBand()).toHaveAttribute('src', 'blob:hero-2');
    fireEvent.click(screen.getByRole('button', { name: 'Remove background image' }));
    expect(previewBand()).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save overview' }));
    await screen.findByText('Module overview saved.');
    expect(putBody().overview.heroBackgroundUrl).toBe('');
    expect(requests('POST')).toHaveLength(0);
    expect(requests('DELETE')).toHaveLength(0);
  });

  it('hides a broken background gracefully, keeping the Hero text and cover', async () => {
    mockApi(record({ hasOverview: true, updatedAt: 'r1', overview: { ...EMPTY_OVERVIEW, summary: 'Practise coaching.', heroBackgroundUrl: REMOTE } }));
    renderModal();
    await screen.findByLabelText('Hero background image URL (optional)');
    fireEvent.error(thumbnail()!);
    expect(screen.getByText(/the standard background is shown instead/)).toBeVisible();
    fireEvent.error(previewBand()!);
    expect(previewBand()).not.toBeInTheDocument();
    expect(previewPane().getByRole('heading', { name: 'Coaching Practice' })).toBeVisible();
    expect(previewPane().getByText('Practise coaching.')).toBeVisible();
    expect(previewPane().getByRole('button', { name: /Start learning/ })).toBeVisible();
  });
});

describe('learner page and editor preview: Hero background', () => {
  const learnerModule = (overview: Record<string, unknown>) => ({
    subjectId: 'current:MOD-1', activity: null, metadata: {}, sessions: [],
    detail: { id: 'L1', components: [] },
    schedule: { modules: [{ id: 'MOD-1', title: 'Coaching Practice', programme_name: 'Apprenticeships', tutor_name: 'Ray Mead', learning_outcomes: [] }] },
    overview: { summary: '', description: '', targetAudience: [], prerequisites: [], requirements: [],
      instructor: { name: 'Ray Mead', bio: '', photoUrl: RAY }, ...overview },
  }) as unknown as MyLearningModule;

  it('renders the same background from the learner read and the editor draft', () => {
    const learner = buildModuleOverviewModel({ moduleId: 'MOD-1', title: 'Coaching Practice', module: learnerModule({ heroBackgroundUrl: UPLOADED_HERO }) });
    const preview = buildPreviewModel(SOURCE, record(), { ...EMPTY_OVERVIEW, heroBackgroundUrl: UPLOADED_HERO });
    expect(learner.heroBackgroundUrl).toBe(UPLOADED_HERO);
    expect(preview.heroBackgroundUrl).toBe(UPLOADED_HERO);
    const { unmount } = render(<ModuleOverviewView model={learner} progress={null} ctaLabel="Start learning" />);
    const learnerImage = screen.getByTestId('hero-background');
    expect(learnerImage).toHaveAttribute('src', UPLOADED_HERO);
    expect(learnerImage).toHaveAttribute('alt', '');
    expect(learnerImage.parentElement).toHaveAttribute('aria-hidden', 'true');
    unmount();
    render(<ModuleOverviewView preview model={preview} progress={null} ctaLabel="Start learning" />);
    expect(screen.getByTestId('hero-background')).toHaveAttribute('src', UPLOADED_HERO);
  });

  it('keeps the standard band for older records and servers without the field', () => {
    const learner = buildModuleOverviewModel({ moduleId: 'MOD-1', title: 'Coaching Practice', module: learnerModule({}) });
    expect(learner.heroBackgroundUrl).toBe('');
    render(<ModuleOverviewView model={learner} progress={null} ctaLabel="Start learning" />);
    expect(screen.queryByTestId('hero-background')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Coaching Practice' })).toBeVisible();
  });
});

describe('Hero content order and typography hooks', () => {
  const LONG_TITLE = 'Managing Successful Programmes: Project Controls for Transformational Change and Benefits Realisation Across Portfolios';
  const learnerModule = (title: string, overview: Record<string, unknown> = {}) => ({
    subjectId: 'current:MOD-1', activity: null, metadata: {}, sessions: [],
    detail: { id: 'L1', components: [] },
    schedule: { modules: [{ id: 'MOD-1', title, programme_name: 'Project Controls Professional Level 6', tutor_name: 'Ray Mead', learning_outcomes: [] }] },
    overview: { summary: '', description: '', targetAudience: [], prerequisites: [], requirements: [],
      instructor: { name: 'Ray Mead', bio: 'Ray has led programmes for 20 years.', photoUrl: RAY }, ...overview },
  }) as unknown as MyLearningModule;
  const precedes = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

  const expectOrder = (scope: ReturnType<typeof within>, title: string) => {
    const heading = scope.getByRole('heading', { level: 2, name: title });
    const programme = scope.getByText('Programme: Project Controls Professional Level 6');
    const instructor = scope.getByRole('region', { name: 'Your instructor' });
    expect(precedes(heading, programme)).toBe(true);
    expect(precedes(programme, instructor)).toBe(true);
    // Title and programme are grouped, inside the Hero header with the instructor.
    expect(heading.parentElement).toBe(programme.parentElement);
    expect(heading.closest('header')).toBe(instructor.closest('header'));
    expect(scope.getAllByText('Programme: Project Controls Professional Level 6')).toHaveLength(1);
  };

  it('shows the title, then the programme, then the instructor on the learner page, with the full title and a working CTA', () => {
    const onStart = vi.fn();
    const model = buildModuleOverviewModel({ moduleId: 'MOD-1', title: LONG_TITLE, module: learnerModule(LONG_TITLE, { heroBackgroundUrl: REMOTE }) });
    render(<ModuleOverviewView model={model} coverUrl="https://images.example.org/cover.png" progress={{ done: 0, total: 10, percent: 0 }}
      ctaLabel="Start learning" onStart={onStart} />);
    expectOrder(within(document.body), LONG_TITLE);
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe(LONG_TITLE); // never truncated
    expect(screen.getByTestId('hero-background')).toHaveAttribute('src', REMOTE);
    expect(within(screen.getByRole('region', { name: 'Your instructor' })).getByRole('img', { name: 'Ray Mead' })).toHaveAttribute('src', RAY);
    fireEvent.click(screen.getByRole('button', { name: /Start learning/ }));
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('uses the same order in the Manage Module Overview Live Preview', async () => {
    mockApi(record({ hasOverview: true, updatedAt: 'r1', overview: { ...EMPTY_OVERVIEW, instructorBio: 'Ray has led programmes for 20 years.' } }));
    render(<ModuleOverviewModal moduleCatalogueId="MOD-1" moduleTitle={LONG_TITLE} onClose={vi.fn()}
      loadPreviewSource={async () => ({ ...SOURCE, title: LONG_TITLE, programme: 'Project Controls Professional Level 6' })} />);
    await waitFor(() => expect(previewPane().getByRole('heading', { level: 2, name: LONG_TITLE })).toBeVisible());
    expectOrder(previewPane(), LONG_TITLE);
  });

  it('omits the programme line when there is none, keeping title then instructor', () => {
    const module = learnerModule('Short title');
    (module.schedule.modules[0] as { programme_name: string }).programme_name = '';
    render(<ModuleOverviewView model={buildModuleOverviewModel({ moduleId: 'MOD-1', title: 'Short title', module })} progress={null} ctaLabel="Start learning" />);
    expect(screen.queryByText(/^Programme:/)).not.toBeInTheDocument();
    expect(precedes(screen.getByRole('heading', { level: 2 }), screen.getByRole('region', { name: 'Your instructor' }))).toBe(true);
  });
});
