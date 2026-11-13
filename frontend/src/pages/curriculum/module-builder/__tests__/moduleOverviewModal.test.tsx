import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ModuleOverviewModal } from '../ModuleOverviewModal';
import {
  copyOverviewAfterDuplicate, normaliseOverview, photoUrlProblem, validateOverview, withOverviewDefaults, EMPTY_OVERVIEW,
  type ModuleOverviewRecord,
} from '../moduleOverviewApi';
import { buildPreviewModel, previewSourceFromStructure, type OverviewPreviewSource } from '../moduleOverviewPreview';
import type { MyLearningModule } from '@/api/myLearning';
import { buildModuleOverviewModel } from '@/pages/learner/my-learning/moduleOverviewModel';
import { ModuleOverviewView } from '@/pages/learner/my-learning/ModuleOverviewView';

const RAY = 'https://jokdxsdbxorzciulkdyl.supabase.co/storage/v1/object/public/images/8feac92ab1694a919754ce97fc4973f0.webp';
const URL_BASE = '/curriculum_api/curriculum/modules/MOD-1/overview/';

const record = (overrides: Partial<ModuleOverviewRecord> = {}): ModuleOverviewRecord => ({
  moduleCatalogueId: 'MOD-1', available: true, tutorName: 'Ray Mead', defaultPhotoUrl: RAY, hasOverview: false, updatedAt: null,
  overview: { ...EMPTY_OVERVIEW }, previousTutorDetails: null, ...overrides,
});
const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
const calls = () => vi.mocked(fetch).mock.calls.map(([url, init]) => ({ url: String(url), init: (init || {}) as RequestInit }));

const SOURCE: OverviewPreviewSource = {
  title: 'Coaching Practice', programme: 'Apprenticeships (Levy Funded)', coverUrl: '',
  weeks: [
    { key: 'W1', label: 'Week 1: Foundations', items: [
      { id: 'c1', title: 'Coaching models', type: 'video', questions: null, completed: null },
      { id: 'c2', title: 'Check-in quiz', type: 'quiz', questions: null, completed: null }] },
    { key: 'W2', label: 'Week 2: Practice', items: [{ id: 'c3', title: 'Role-play session', type: 'live_session', questions: null, completed: null }] },
  ],
  outcomes: ['Use a coaching model'],
};

function mockApi(initial: ModuleOverviewRecord, onPut?: (body: Record<string, unknown>) => Response) {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/module-overviews/csrf/')) return reply({ csrfToken: 'token-1' });
    if (url === URL_BASE && (!init || !init.method || init.method === 'GET')) return reply(initial);
    if (url === URL_BASE && init?.method === 'PUT') {
      const body = JSON.parse(String(init.body));
      return onPut ? onPut(body) : reply({ ...initial, hasOverview: true, updatedAt: '2026-11-12T10:00:00.000000Z', overview: body.overview, saved: true });
    }
    throw new Error(`Unexpected request ${url}`);
  }));
}

function renderModal(source: OverviewPreviewSource | null = SOURCE) {
  const onClose = vi.fn();
  const onSaved = vi.fn();
  const loadPreviewSource = vi.fn(async () => source);
  render(<ModuleOverviewModal moduleCatalogueId="MOD-1" moduleTitle="Coaching Practice" onClose={onClose} onSaved={onSaved}
    loadPreviewSource={loadPreviewSource} />);
  return { onClose, onSaved, loadPreviewSource };
}

const previewPane = () => within(screen.getByRole('region', { name: 'Live preview' }));
const editor = () => within(screen.getByRole('form', { name: 'Module overview content' }));
const puts = () => calls().filter(call => call.init.method === 'PUT');

beforeEach(() => vi.stubGlobal('AppIcon', () => <span />));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('module overview validation', () => {
  it('accepts public https images and refuses everything else', () => {
    expect(photoUrlProblem('')).toBe('');
    expect(photoUrlProblem(RAY)).toBe('');
    for (const url of ['http://x.org/a.png', 'javascript:alert(1)', 'https://localhost/a.png', 'https://127.0.0.1/a.png',
      'https://user:pw@x.org/a.png', 'https://x.org/a.svg', 'https://x.org/page', 'https://x.org/a b.png', 'https://x.org:8443/a.png']) {
      expect(photoUrlProblem(url), url).not.toBe('');
    }
  });

  it('refuses HTML, long values and instructor details without a tutor', () => {
    const errors = validateOverview({ ...EMPTY_OVERVIEW, summary: '<b>x</b>', description: 'x'.repeat(5001), instructorBio: 'Bio',
      targetAudience: ['<script>'], highlights: ['x'.repeat(201)] }, '');
    expect(errors.map(error => error.field).sort()).toEqual(['description', 'highlights[0]', 'instructorBio', 'summary', 'targetAudience[0]']);
  });

  it('validates sections: a heading is required for content, HTML and lengths are refused', () => {
    const errors = validateOverview({ ...EMPTY_OVERVIEW, descriptionSections: [
      { id: 'a', heading: '', body: 'Body without heading', bullets: [] },
      { id: 'b', heading: 'Fine', body: '<p>x</p>', bullets: ['ok', 'x'.repeat(201)] },
      { id: 'c', heading: 'x'.repeat(121), body: '', bullets: [] },
    ] }, 'Ray Mead');
    expect(errors.map(error => error.field)).toEqual([
      'descriptionSections[0].heading', 'descriptionSections[1].body', 'descriptionSections[1].bullets[1]', 'descriptionSections[2].heading',
    ]);
  });

  it('drops blank sections and rows, and fills keys a version 1 record lacks', () => {
    expect(normaliseOverview({ ...EMPTY_OVERVIEW, highlights: [' a ', ''], descriptionSections: [
      { id: 'blank', heading: ' ', body: ' ', bullets: [' '] }, { id: 'kept', heading: ' H ', body: ' B ', bullets: [' x ', ''] },
    ] })).toMatchObject({ highlights: ['a'], descriptionSections: [{ id: 'kept', heading: 'H', body: 'B', bullets: ['x'] }] });
    expect(withOverviewDefaults({ summary: 'v1' } as never)).toEqual({ ...EMPTY_OVERVIEW, summary: 'v1' });
  });
});

describe('preview model', () => {
  it('uses the stored structure for title, programme and curriculum, and the draft for authored text', () => {
    const source = previewSourceFromStructure({
      title: 'Stored title', programmeName: 'Programme', coverImage: 'https://x.org/c.png',
      weekStructure: [
        { id: 'w2', weekNumber: 2, title: '', components: [{ id: 'q', title: 'Quiz', type: 'quiz' }], learningOutcomes: ['B'] },
        { id: 'w1', weekNumber: 1, title: 'Intro', components: [{ id: 'v', title: 'Video', type: 'video' }, { id: 'e', title: ' ', type: 'reading' }], learningOutcomes: ['A'] },
      ],
    } as never);
    // The server's week order (display_order, as the learner read uses) is kept, never re-sorted.
    expect(source.weeks.map(week => [week.label, week.items.map(item => item.title)])).toEqual([['Week 2', ['Quiz']], ['Intro', ['Video']]]);
    const model = buildPreviewModel(source, record(), { ...EMPTY_OVERVIEW, summary: 'Draft', instructorPhotoUrl: 'http://not-https.org/a.png' });
    expect(model).toMatchObject({ title: 'Stored title', programme: 'Programme', summary: 'Draft', outcomes: ['B', 'A'], grades: null });
    // An invalid photo URL is not previewed as if learners would see it.
    expect(model.instructor).toEqual({ name: 'Ray Mead', bio: '', photoUrl: '' });
    expect(buildPreviewModel(source, record(), EMPTY_OVERVIEW).instructor?.photoUrl).toBe(RAY);
  });
});

describe('overview copy after Duplicate module', () => {
  const copyWith = (response: Response) => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => String(input).endsWith('/csrf/') ? reply({ csrfToken: 'token-1' }) : response));
  };

  it('copies by the explicit source id when the tutor is the same', async () => {
    copyWith(reply({ copied: true, instructorCopied: true, instructorDropped: false }));
    const result = await copyOverviewAfterDuplicate({ sourceId: 'MOD-1', duplicateId: 'MOD-2', sourceHasOverview: true });
    expect(result).toEqual({ copied: true, message: ' Its module overview was copied.' });
    const post = calls().find(call => call.init.method === 'POST')!;
    expect(post.url).toBe('/curriculum_api/curriculum/modules/MOD-2/overview/copy/');
    expect(JSON.parse(String(post.init.body))).toEqual({ sourceModuleCatalogueId: 'MOD-1' });
  });

  it('says so when a different tutor means the instructor details were not copied', async () => {
    copyWith(reply({ copied: true, instructorCopied: false, instructorDropped: true }));
    expect((await copyOverviewAfterDuplicate({ sourceId: 'MOD-1', duplicateId: 'MOD-2', sourceHasOverview: true })).message)
      .toContain('the tutor biography and photo were not, because the new module has a different tutor');
  });

  it('does nothing without a source overview and never fails the duplicate', async () => {
    copyWith(reply({ error: 'down' }, 503));
    expect(await copyOverviewAfterDuplicate({ sourceId: 'MOD-1', duplicateId: 'MOD-2', sourceHasOverview: false }))
      .toEqual({ copied: false, message: '' });
    expect(fetch).not.toHaveBeenCalled();
    expect(await copyOverviewAfterDuplicate({ sourceId: 'MOD-1', duplicateId: 'MOD-2', sourceHasOverview: true }))
      .toEqual({ copied: false, message: ' The module overview could not be copied. Add it from the new module card.' });
  });
});

describe('Manage Module Overview editor', () => {
  it('loads the overview with the module tutor, and previews the module’s own data', async () => {
    mockApi(record());
    const { loadPreviewSource } = renderModal();
    expect(await screen.findByText('Manage Module Overview')).toBeVisible();
    expect(screen.getByRole('img', { name: 'Ray Mead preview' })).toHaveAttribute('src', RAY);
    expect(screen.getByRole('button', { name: 'Save overview' })).toBeDisabled();
    expect(loadPreviewSource).toHaveBeenCalledWith('MOD-1');
    await waitFor(() => expect(previewPane().getByText('Programme: Apprenticeships (Levy Funded)')).toBeVisible());
    expect(previewPane().getByRole('heading', { level: 2, name: 'Coaching Practice' })).toBeVisible();
    expect(previewPane().getByRole('img', { name: 'Ray Mead' })).toHaveAttribute('src', RAY);
    const details = within(previewPane().getByRole('region', { name: 'Course details' }));
    expect(details.getByText('Sections').nextSibling).toHaveTextContent('2');
    // Same tabs as the learner page. No learner here, so no Grade tab and no
    // progress: nothing learner-specific is invented.
    expect(previewPane().getAllByRole('tab').map(item => item.textContent)).toEqual(['Description', 'Curriculum']);
    expect(previewPane().queryByRole('progressbar')).not.toBeInTheDocument();
    expect(previewPane().queryByText(/% complete/)).not.toBeInTheDocument();
    expect(previewPane().queryByText(/Best score|Passed|attempt/i)).not.toBeInTheDocument();
    // The module's existing learning outcomes show in the preview, as for learners.
    expect(within(previewPane().getByRole('region', { name: "What you'll learn" })).getByText('Use a coaching model')).toBeVisible();
    expect(previewPane().queryByText(/has not been added/)).not.toBeInTheDocument();
    expect(previewPane().queryByText(/Full curriculum available/)).not.toBeInTheDocument();
    fireEvent.click(previewPane().getByRole('tab', { name: 'Curriculum' }));
    // Weeks start collapsed, as on the learner page.
    expect(previewPane().queryByText('Role-play session')).not.toBeInTheDocument();
    fireEvent.click(previewPane().getByRole('button', { name: /Week 2: Practice/ }));
    expect(previewPane().getByText('Role-play session')).toBeVisible();
    // No learner in the builder: completion is unknown, so no lock or check.
    expect(previewPane().queryByText('Not completed yet')).not.toBeInTheDocument();
    expect(previewPane().queryByText('Completed')).not.toBeInTheDocument();
  });

  it('shows a curriculum skeleton in the preview while the structure loads, never an empty curriculum', async () => {
    mockApi(record());
    let resolve: (value: OverviewPreviewSource | null) => void = () => {};
    const pending = new Promise<OverviewPreviewSource | null>(done => { resolve = done; });
    render(<ModuleOverviewModal moduleCatalogueId="MOD-1" moduleTitle="Coaching Practice" onClose={vi.fn()} loadPreviewSource={() => pending} />);
    await screen.findByLabelText('Short summary');
    fireEvent.click(previewPane().getByRole('tab', { name: 'Curriculum' }));
    expect(within(previewPane().getByRole('tabpanel')).getByText('Loading the curriculum…')).toBeInTheDocument();
    expect(previewPane().queryByText(/No learning activities/)).not.toBeInTheDocument();
    fireEvent.click(previewPane().getByRole('tab', { name: 'Description' }));
    // Outcomes are part of the curriculum read: while it loads, Description never claims "no description".
    expect(within(previewPane().getByRole('tabpanel')).getByText('Loading learning outcomes…')).toBeInTheDocument();
    expect(previewPane().queryByText(/has not been added/)).not.toBeInTheDocument();
    resolve(SOURCE);
    expect(await previewPane().findByText('Use a coaching model')).toBeVisible();
    fireEvent.click(previewPane().getByRole('tab', { name: 'Curriculum' }));
    expect(previewPane().getByRole('button', { name: /Week 1: Foundations/ })).toHaveAttribute('aria-expanded', 'false');
  });

  it('never reports a missing description when the curriculum read fails', async () => {
    mockApi(record());
    renderModal(null);
    expect(await previewPane().findByText('The learning outcomes could not be loaded for this preview.')).toBeVisible();
    expect(previewPane().queryByText(/has not been added/)).not.toBeInTheDocument();
  });

  it('updates the live preview as fields change, without saving', async () => {
    mockApi(record());
    renderModal();
    fireEvent.change(await screen.findByLabelText('Short summary'), { target: { value: 'Practise real coaching conversations.' } });
    expect(previewPane().getByText('Practise real coaching conversations.')).toBeVisible();
    fireEvent.change(screen.getByLabelText('Instructor biography (optional)'), { target: { value: 'Ray coaches coaches.' } });
    expect(within(previewPane().getByRole('region', { name: 'Your instructor' })).getByText('Ray coaches coaches.')).toBeVisible();
    const audience = editor().getByRole('group', { name: 'Target audience' });
    fireEvent.click(within(audience).getByRole('button', { name: 'Add item' }));
    fireEvent.change(within(audience).getByLabelText('Target audience item 1'), { target: { value: 'New coaches' } });
    expect(previewPane().getByRole('region', { name: 'Who this module is for' })).toHaveTextContent('New coaches');
    expect(screen.getByText('Unsaved changes')).toBeVisible();
    expect(puts()).toHaveLength(0);
  });

  it('adds, edits, reorders and deletes sections and bullets in the draft and preview', async () => {
    mockApi(record());
    renderModal();
    await screen.findByLabelText('Short summary');
    fireEvent.click(editor().getByRole('button', { name: "What you'll practise" }));
    expect(editor().getByRole('button', { name: "What you'll practise" })).toBeDisabled();
    fireEvent.change(editor().getByLabelText('Section 1 text'), { target: { value: 'Role-play a five-minute conversation.' } });
    const bullets = editor().getByRole('group', { name: 'Section 1 bullet points' });
    fireEvent.click(within(bullets).getByRole('button', { name: 'Add item' }));
    fireEvent.change(within(bullets).getByLabelText('Section 1 bullet points item 1'), { target: { value: 'Ask an open question' } });
    fireEvent.click(within(bullets).getByRole('button', { name: 'Add item' }));
    fireEvent.change(within(bullets).getByLabelText('Section 1 bullet points item 2'), { target: { value: 'Agree an action' } });
    fireEvent.click(editor().getByRole('button', { name: 'Custom section' }));
    fireEvent.change(editor().getByLabelText('Section 2 heading'), { target: { value: 'Assessment preparation' } });

    const headings = () => within(previewPane().getByRole('tabpanel')).getAllByRole('heading', { level: 3 }).map(item => item.textContent);
    expect(headings()).toEqual(["What you'll practise", 'Assessment preparation', "What you'll learn"]);
    expect(previewPane().getByRole('region', { name: "What you'll practise" })).toHaveTextContent('Ask an open question');

    fireEvent.click(editor().getByRole('button', { name: 'Move Assessment preparation up' }));
    expect(headings()).toEqual(['Assessment preparation', "What you'll practise", "What you'll learn"]);

    // Remove one bullet: the preview updates immediately.
    fireEvent.click(within(editor().getByRole('group', { name: 'Section 2 bullet points' })).getByRole('button', { name: 'Remove section 2 bullet points item 1' }));
    expect(previewPane().getByRole('region', { name: "What you'll practise" })).not.toHaveTextContent('Ask an open question');

    // Deleting a section with content asks first.
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    fireEvent.click(editor().getByRole('button', { name: "Delete What you'll practise" }));
    expect(confirm).toHaveBeenCalled();
    expect(headings()).toContain("What you'll practise");
    confirm.mockReturnValue(true);
    fireEvent.click(editor().getByRole('button', { name: "Delete What you'll practise" }));
    expect(headings()).toEqual(['Assessment preparation', "What you'll learn"]);
    expect(editor().getByRole('button', { name: "What you'll practise" })).toBeEnabled();
    expect(puts()).toHaveLength(0);
  });

  it('saves the whole overview as schemaVersion 2 with CSRF and the loaded revision, then reopens with it', async () => {
    mockApi(record());
    const { onSaved } = renderModal();
    fireEvent.change(await screen.findByLabelText('Short summary'), { target: { value: '  Practise coaching.  ' } });
    fireEvent.click(editor().getByRole('button', { name: 'Enrolment and access' }));
    fireEvent.change(editor().getByLabelText('Section 1 text'), { target: { value: 'Open enrolment.' } });
    fireEvent.click(editor().getByRole('button', { name: 'Custom section' })); // left blank: never sent
    const highlights = editor().getByRole('group', { name: 'Course highlights' });
    fireEvent.click(within(highlights).getByRole('button', { name: 'Add item' }));
    fireEvent.change(within(highlights).getByLabelText('Course highlights item 1'), { target: { value: 'Self-paced study' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save overview' }));
    expect(await screen.findByText('Module overview saved.')).toBeVisible();
    const put = puts()[0];
    expect(put.init.headers).toMatchObject({ 'X-CSRFToken': 'token-1' });
    const body = JSON.parse(String(put.init.body));
    expect(body.expectedUpdatedAt).toBeNull();
    expect(body.overview).toEqual({
      ...EMPTY_OVERVIEW, schemaVersion: 2, summary: 'Practise coaching.', highlights: ['Self-paced study'],
      descriptionSections: [{ id: expect.stringMatching(/^[A-Za-z0-9_-]{1,40}$/), heading: 'Enrolment and access', body: 'Open enrolment.', bullets: [] }],
    });
    expect(onSaved).toHaveBeenCalledWith(true);
    expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save overview' })).toBeDisabled();
    expect(editor().getByLabelText('Section 1 heading')).toHaveValue('Enrolment and access');
  });

  it('opens a version 1 record without writing it back', async () => {
    const v1 = { ...record({ hasOverview: true, updatedAt: '2026-01-01T00:00:00.000000Z' }),
      overview: { summary: 'Old summary', description: '', targetAudience: ['A'], prerequisites: [], requirements: [], instructorBio: '', instructorPhotoUrl: '' } };
    mockApi(v1 as unknown as ModuleOverviewRecord);
    renderModal();
    expect(await screen.findByLabelText('Short summary')).toHaveValue('Old summary');
    expect(editor().getByRole('group', { name: 'Course highlights' })).toBeInTheDocument();
    expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument();
    expect(previewPane().getByText('Old summary')).toBeVisible();
    expect(puts()).toHaveLength(0);
  });

  it('discards unsaved changes back to the saved overview', async () => {
    mockApi(record({ hasOverview: true, updatedAt: 'r1', overview: { ...EMPTY_OVERVIEW, summary: 'Saved' } }));
    renderModal();
    fireEvent.change(await screen.findByLabelText('Short summary'), { target: { value: 'Draft' } });
    fireEvent.click(editor().getByRole('button', { name: 'Custom section' }));
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(screen.getByLabelText('Short summary')).toHaveValue('Saved');
    expect(editor().queryByLabelText('Section 1 heading')).not.toBeInTheDocument();
    expect(previewPane().getByText('Saved')).toBeVisible();
    expect(puts()).toHaveLength(0);
  });

  it('removes the photo override and biography with explicit actions', async () => {
    mockApi(record({ hasOverview: true, updatedAt: 'r1', overview: { ...EMPTY_OVERVIEW, instructorBio: 'Bio', instructorPhotoUrl: 'https://images.example.org/ray.png' } }));
    renderModal();
    expect(await screen.findByRole('img', { name: 'Ray Mead preview' })).toHaveAttribute('src', 'https://images.example.org/ray.png');
    fireEvent.click(screen.getByRole('button', { name: 'Remove photo URL' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove biography' }));
    expect(screen.getByLabelText('Instructor photo URL (optional)')).toHaveValue('');
    expect(screen.getByRole('img', { name: 'Ray Mead preview' })).toHaveAttribute('src', RAY);
    expect(previewPane().getByRole('img', { name: 'Ray Mead' })).toHaveAttribute('src', RAY);
    expect(within(previewPane().getByRole('region', { name: 'Your instructor' })).queryByText('Bio')).not.toBeInTheDocument();
  });

  it('explains invalid input before sending anything, on the right section', async () => {
    mockApi(record());
    renderModal();
    fireEvent.change(await screen.findByLabelText('Instructor photo URL (optional)'), { target: { value: 'http://images.example.org/a.png' } });
    fireEvent.click(editor().getByRole('button', { name: 'Custom section' }));
    fireEvent.click(editor().getByRole('button', { name: 'Custom section' }));
    fireEvent.change(editor().getByLabelText('Section 2 text'), { target: { value: 'Text without a heading' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save overview' }));
    expect(await screen.findByText('The image must use an https:// address.')).toBeVisible();
    expect(screen.getByLabelText('Instructor photo URL (optional)')).toHaveAttribute('aria-invalid', 'true');
    expect(editor().getByLabelText('Section 2 heading')).toHaveAttribute('aria-invalid', 'true');
    expect(editor().getByLabelText('Section 1 heading')).toHaveAttribute('aria-invalid', 'false');
    expect(puts()).toHaveLength(0);
  });

  it('shows server field errors', async () => {
    mockApi(record(), () => reply({ error: 'Check the highlighted fields.', fields: [{ field: 'summary', message: 'HTML is not allowed. Use plain text.' }] }, 400));
    renderModal();
    fireEvent.change(await screen.findByLabelText('Short summary'), { target: { value: 'Fine' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save overview' }));
    expect(await screen.findByText('HTML is not allowed. Use plain text.')).toBeVisible();
  });

  it('keeps the editor’s text on a conflict and can load the latest version', async () => {
    const latest = record({ hasOverview: true, updatedAt: '2026-11-12T09:00:00.000000Z', overview: { ...EMPTY_OVERVIEW, summary: 'Saved by someone else' } });
    mockApi(record(), () => reply({ error: 'Someone else changed this module overview after you opened it.', conflict: true, current: latest }, 409));
    renderModal();
    fireEvent.change(await screen.findByLabelText('Short summary'), { target: { value: 'Mine' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save overview' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Someone else changed');
    expect(screen.getByLabelText('Short summary')).toHaveValue('Mine');
    fireEvent.click(screen.getByRole('button', { name: 'Load latest version' }));
    expect(screen.getByLabelText('Short summary')).toHaveValue('Saved by someone else');
  });

  it('notes a broken photo and keeps a previous tutor’s details hidden', async () => {
    mockApi(record({ previousTutorDetails: 'Andrew Millington' }));
    renderModal();
    expect(await screen.findByText(/Instructor details saved for Andrew Millington are kept but hidden/)).toBeVisible();
    fireEvent.change(screen.getByLabelText('Instructor photo URL (optional)'), { target: { value: 'https://images.example.org/missing.png' } });
    fireEvent.error(screen.getByRole('img', { name: 'Ray Mead preview' }));
    expect(screen.getByText(/This image could not be loaded/)).toBeVisible();
    fireEvent.error(previewPane().getByRole('img', { name: 'Ray Mead' }));
    expect(within(previewPane().getByRole('region', { name: 'Your instructor' })).queryByRole('img')).not.toBeInTheDocument();
  });

  it('keeps editing available when the curriculum cannot be read for the preview', async () => {
    mockApi(record());
    renderModal(null);
    expect(await screen.findByText(/curriculum could not be loaded for the preview/)).toBeVisible();
    expect(previewPane().getByRole('heading', { level: 2, name: 'Coaching Practice' })).toBeVisible();
    expect(screen.getByLabelText('Short summary')).toBeEnabled();
  });

  it('asks before discarding unsaved changes on close', async () => {
    mockApi(record());
    const { onClose } = renderModal();
    fireEvent.change(await screen.findByLabelText('Short summary'), { target: { value: 'Draft' } });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(confirm).toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('reports when storage is not set up yet', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply({
      error: 'Module overview storage is not set up on this database yet.', code: 'overview_storage_missing' }, 503)));
    renderModal();
    expect(await screen.findByRole('alert')).toHaveTextContent('storage is not set up');
    expect(screen.getByRole('button', { name: 'Save overview' })).toBeDisabled();
  });
});


describe('learner page and editor preview parity', () => {
  // One module, described twice: as the learner's module read returns it and
  // as the Module Builder's structure read returns it (same curriculum.weeks /
  // curriculum.components rows, same order).
  const overview = {
    summary: 'Run better coaching conversations.', description: 'About text.',
    descriptionSections: [{ id: 'practise', heading: "What you'll practise", body: 'Role-play.', bullets: ['Open question'] }],
    highlights: ['Self-paced'], targetAudience: ['New coaches'], prerequisites: ['Module 1'], requirements: ['A laptop'],
  };
  const learnerModule = {
    subjectId: 'current:MOD-1', activity: null, metadata: { covers: {} }, sessions: [],
    detail: { id: '7', components: [
      { componentId: 'c1', moduleId: 'MOD-1', week: 'Week 1: Foundations', weekId: 'W1', component: 'Coaching models', type: 'video', expectedOtjh: null },
      { componentId: 'c2', moduleId: 'MOD-1', week: 'Week 2: Practice', weekId: 'W2', component: 'Role-play session', type: 'live_session', expectedOtjh: null },
    ] },
    schedule: { modules: [{ id: 'MOD-1', title: 'Coaching Practice', programme_name: 'Apprenticeships', tutor_name: 'Ray Mead',
      learning_outcomes: ['Use a coaching model', 'Agree actions', 'Review evidence'] }], moduleLinks: {}, generatedAt: '' },
    overview: { ...overview, instructor: { name: 'Ray Mead', bio: 'Bio.', photoUrl: RAY } },
  } as unknown as MyLearningModule;
  const structure = {
    title: 'Coaching Practice', programmeName: 'Apprenticeships', coverImage: '',
    weekStructure: [
      { id: 'W1', weekNumber: 1, title: 'Week 1: Foundations', learningOutcomes: ['Use a coaching model', 'Agree actions'],
        components: [{ id: 'c1', title: 'Coaching models', type: 'video' }] },
      { id: 'W2', weekNumber: 2, title: 'Week 2: Practice', learningOutcomes: ['Agree actions', 'Review evidence'],
        components: [{ id: 'c2', title: 'Role-play session', type: 'live_session' }] },
    ],
  };
  const fields = { ...EMPTY_OVERVIEW, ...overview, instructorBio: 'Bio.' };
  const learnerModel = () => buildModuleOverviewModel({ moduleId: 'MOD-1', title: 'Fallback', module: learnerModule });
  const previewModel = () => buildPreviewModel(previewSourceFromStructure(structure as never), record(), fields);

  it('builds the same module-level model from both reads', () => {
    const shared = (model: ReturnType<typeof learnerModel>) => ({
      title: model.title, programme: model.programme, summary: model.summary, description: model.descriptionParagraphs,
      sections: model.sections, highlights: model.highlights, outcomes: model.outcomes, instructor: model.instructor,
      audience: model.targetAudience, prerequisites: model.prerequisites, requirements: model.requirements,
      weeks: model.weeks.map(week => [week.label, week.items.map(item => [item.title, item.type])]), counts: model.counts,
    });
    expect(shared(previewModel())).toEqual(shared(learnerModel()));
    expect(previewModel().outcomes).toEqual(['Use a coaching model', 'Agree actions', 'Review evidence']);
    // Only learner-specific values differ: completion and grades are unknown in the preview.
    expect(previewModel().weeks.flatMap(week => week.items.map(item => item.completed))).toEqual([null, null]);
    expect(previewModel().grades).toBeNull();
  });

  it('renders the same Description, Curriculum and sidebar text', () => {
    const text = (model: ReturnType<typeof learnerModel>) => {
      const view = render(<ModuleOverviewView model={model} progress={null} ctaLabel="Start learning" preview />);
      const panel = () => view.getByRole('tabpanel').textContent;
      const description = panel();
      fireEvent.click(view.getByRole('tab', { name: 'Curriculum' }));
      fireEvent.click(view.getByRole('button', { name: /Week 1/ }));
      // Completion indicators are learner-specific: the only allowed difference.
      const curriculum = (panel() || '').replace(/Not completed yet|Completed/g, '');
      const sidebar = view.getByRole('complementary', { name: 'Module summary' }).textContent;
      const hero = view.getByRole('banner').textContent;
      view.unmount();
      return { description, curriculum, sidebar, hero };
    };
    expect(text(previewModel())).toEqual(text(learnerModel()));
  });
});


describe('custom sidebar sections', () => {
  const sideCards = () => within(previewPane().getByRole('complementary', { name: 'Module summary' }))
    .queryAllByRole('heading', { level: 3 }).map(item => item.textContent);

  it('adds, edits, reorders and deletes sidebar sections with the preview in step', async () => {
    mockApi(record({ hasOverview: true, updatedAt: 'r1', overview: { ...EMPTY_OVERVIEW, targetAudience: ['New coaches'],
      descriptionSections: [{ id: 'd1', heading: 'About the practice', body: 'Text.', bullets: [] }] } }));
    renderModal();
    await screen.findByLabelText('Short summary');
    await waitFor(() => expect(sideCards()).toEqual(['Course details', 'Who this module is for']));
    const group = () => within(editor().getByRole('group', { name: 'Custom sidebar sections' }));

    fireEvent.click(group().getByRole('button', { name: 'Add Sidebar Section' }));
    // A blank section is never shown to learners.
    expect(sideCards()).toEqual(['Course details', 'Who this module is for']);
    fireEvent.change(group().getByLabelText('Sidebar section 1 heading'), { target: { value: 'Tools & software' } });
    fireEvent.change(group().getByLabelText('Sidebar section 1 text'), { target: { value: 'Used throughout.' } });
    const bullets = within(group().getByRole('group', { name: 'Sidebar section 1 bullet points' }));
    fireEvent.click(bullets.getByRole('button', { name: 'Add item' }));
    fireEvent.change(bullets.getByLabelText('Sidebar section 1 bullet points item 1'), { target: { value: 'Microsoft Excel' } });
    fireEvent.click(bullets.getByRole('button', { name: 'Add item' }));
    fireEvent.change(bullets.getByLabelText('Sidebar section 1 bullet points item 2'), { target: { value: 'Microsoft Project' } });
    // Below the system-managed cards, which are unchanged.
    expect(sideCards()).toEqual(['Course details', 'Who this module is for', 'Tools & software']);
    const tools = () => previewPane().getByRole('region', { name: 'Tools & software' });
    expect(tools()).toHaveTextContent('Used throughout.');
    expect(within(tools()).getAllByRole('listitem').map(item => item.textContent)).toEqual(['Microsoft Excel', 'Microsoft Project']);

    fireEvent.click(bullets.getByRole('button', { name: 'Remove sidebar section 1 bullet points item 1' }));
    expect(within(tools()).getAllByRole('listitem').map(item => item.textContent)).toEqual(['Microsoft Project']);

    fireEvent.click(group().getByRole('button', { name: 'Add Sidebar Section' }));
    fireEvent.change(group().getByLabelText('Sidebar section 2 heading'), { target: { value: 'Getting help' } });
    expect(sideCards()).toEqual(['Course details', 'Who this module is for', 'Tools & software', 'Getting help']);
    fireEvent.click(group().getByRole('button', { name: 'Move Getting help up' }));
    expect(sideCards()).toEqual(['Course details', 'Who this module is for', 'Getting help', 'Tools & software']);

    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(group().getByRole('button', { name: 'Delete Tools & software' }));
    expect(confirm).toHaveBeenCalled();
    expect(sideCards()).toEqual(['Course details', 'Who this module is for', 'Getting help']);
    // Description sections are untouched by every sidebar edit.
    expect(editor().getByLabelText('Section 1 heading')).toHaveValue('About the practice');
    expect(within(previewPane().getByRole('tabpanel')).getByRole('heading', { name: 'About the practice' })).toBeVisible();
    expect(puts()).toHaveLength(0);
  });

  it('saves sidebar sections through the existing overview save and reopens with them', async () => {
    mockApi(record());
    renderModal();
    await screen.findByLabelText('Short summary');
    const group = within(editor().getByRole('group', { name: 'Custom sidebar sections' }));
    fireEvent.click(group.getByRole('button', { name: 'Add Sidebar Section' }));
    fireEvent.change(group.getByLabelText('Sidebar section 1 heading'), { target: { value: 'Tools' } });
    fireEvent.click(group.getByRole('button', { name: 'Add Sidebar Section' })); // left blank: never sent
    fireEvent.click(screen.getByRole('button', { name: 'Save overview' }));
    expect(await screen.findByText('Module overview saved.')).toBeVisible();
    const body = JSON.parse(String(puts()[0].init.body));
    expect(body.overview.sidebarSections).toEqual([{ id: expect.stringMatching(/^[A-Za-z0-9_-]{1,40}$/), heading: 'Tools', body: '', bullets: [] }]);
    expect(body.overview.descriptionSections).toEqual([]);
    // The saved record is what the editor now shows (as on reopening).
    expect(editor().getByLabelText('Sidebar section 1 heading')).toHaveValue('Tools');
    expect(editor().queryByLabelText('Sidebar section 2 heading')).not.toBeInTheDocument();
    expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument();
  });

  it('reports a sidebar heading problem on the sidebar section, not a Description section', async () => {
    mockApi(record());
    renderModal();
    await screen.findByLabelText('Short summary');
    fireEvent.click(editor().getByRole('button', { name: 'Custom section' }));
    fireEvent.change(editor().getByLabelText('Section 1 heading'), { target: { value: 'Fine' } });
    const group = within(editor().getByRole('group', { name: 'Custom sidebar sections' }));
    fireEvent.click(group.getByRole('button', { name: 'Add Sidebar Section' }));
    fireEvent.change(group.getByLabelText('Sidebar section 1 text'), { target: { value: 'No heading' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save overview' }));
    expect(await screen.findByText('Add a heading for this section.')).toBeVisible();
    expect(group.getByLabelText('Sidebar section 1 heading')).toHaveAttribute('aria-invalid', 'true');
    expect(editor().getByLabelText('Section 1 heading')).toHaveAttribute('aria-invalid', 'false');
    expect(puts()).toHaveLength(0);
  });

  it('discards sidebar edits without writing', async () => {
    mockApi(record({ hasOverview: true, updatedAt: 'r1', overview: { ...EMPTY_OVERVIEW,
      sidebarSections: [{ id: 's1', heading: 'Saved card', body: '', bullets: [] }] } }));
    renderModal();
    const group = within(await screen.findByRole('group', { name: 'Custom sidebar sections' }));
    fireEvent.change(group.getByLabelText('Sidebar section 1 heading'), { target: { value: 'Draft card' } });
    expect(previewPane().getByRole('region', { name: 'Draft card' })).toBeInTheDocument();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(group.getByLabelText('Sidebar section 1 heading')).toHaveValue('Saved card');
    expect(previewPane().getByRole('region', { name: 'Saved card' })).toBeInTheDocument();
    expect(puts()).toHaveLength(0);
  });

  it('validates sidebar sections with their own limit and keys', () => {
    const many = Array.from({ length: 7 }, (_, index) => ({ id: `s${index}`, heading: `Card ${index}`, body: '', bullets: [] }));
    expect(validateOverview({ ...EMPTY_OVERVIEW, sidebarSections: many }, 'Ray Mead').map(error => error.field)).toEqual(['sidebarSections']);
    expect(validateOverview({ ...EMPTY_OVERVIEW, sidebarSections: [{ id: 'a', heading: 'Ok', body: '<i>x</i>', bullets: [] }] }, 'Ray Mead')
      .map(error => error.field)).toEqual(['sidebarSections[0].body']);
    expect(withOverviewDefaults({ summary: 'older record' } as never).sidebarSections).toEqual([]);
  });
});
