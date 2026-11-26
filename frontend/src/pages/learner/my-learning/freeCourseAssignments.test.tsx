import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FreeCoursesTab } from './FreeCoursesTab';
import { clearAllCachedResources } from '@/api/cachedRequest';
import type { FreeCourse } from '@/api/freeCourses';

vi.mock('./SubjectWorkspace', async importOriginal => ({ ...await importOriginal<typeof import('./SubjectWorkspace')>(),
  Cover: ({ title }: { title: string }) => <span>{title} cover</span> }));

const assigned: FreeCourse = {
  freeCourseId: 'FC-1', moduleId: 'MOD-FREE', courseName: 'Standalone skills',
  description: 'Independent study', coverImageUrl: '', weeks: [], weekCount: 2, activityCount: 4,
};
const legacy: FreeCourse = { freeCourseId: 'OLD-1', courseName: 'Legacy skills', description: '', coverImageUrl: '', weeks: [] };
function Location() {
  const location = useLocation();
  return <output aria-label="Learning location">{location.pathname}{location.search}</output>;
}
function renderCourses(kind: 'commercial' | 'apprenticeship' = 'commercial', query = '?mode=free') {
  return render(<MemoryRouter initialEntries={[`/learner/my-learning/${kind}/7${query}`]}>
    <FreeCoursesTab kind={kind} id="7" /><Location />
  </MemoryRouter>);
}
beforeEach(() => {
  clearAllCachedResources();
  window.localStorage.clear();
  vi.stubGlobal('AppIcon', () => <span />);
  vi.stubGlobal('fetch', vi.fn(async input => new Response(JSON.stringify(String(input).includes('/certificates/')
    ? { template: null, csrfToken: '' } : { freeCourses: [assigned, legacy] }))));
});
afterEach(() => { clearAllCachedResources(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('assigned Module Builder free courses', () => {
  it.each(['commercial', 'apprenticeship'] as const)('lists builder and legacy assignments for %s', async kind => {
    renderCourses(kind);
    const card = (await screen.findByRole('heading', { name: 'Standalone skills' })).closest('article')!;
    expect(within(card).getByText(/2 weeks.*4 activities/)).toBeVisible();
    expect(within(card).queryByText('No activities yet')).not.toBeInTheDocument();
    expect(within(card).queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Legacy skills' })).toBeVisible();
    expect(screen.queryByText(/No hours or targets/)).not.toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith(`/learner_api/free-courses/${kind}/7/`, expect.anything());
  });

  it('opens builder content through the normal module workspace to preserve progress and hours', async () => {
    renderCourses('commercial', '?mode=free&tab=quizzes&activity=stale&week=old');
    const card = (await screen.findByRole('heading', { name: 'Standalone skills' })).closest('article')!;
    fireEvent.click(within(card).getByRole('button'));
    const url = screen.getByLabelText('Learning location').textContent!;
    const query = new URLSearchParams(url.split('?')[1]);
    expect(query.get('subject')).toBe('current:MOD-FREE');
    expect(query.get('tab')).toBe('modules');
    for (const key of ['mode', 'activity', 'course', 'week']) expect(query.has(key)).toBe(false);
    expect(vi.mocked(fetch).mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true);
  });

  it('resolves an existing course bookmark to the normal workspace', async () => {
    renderCourses('apprenticeship', '?mode=free&course=FC-1');
    await waitFor(() => expect(screen.getByLabelText('Learning location')).toHaveTextContent('subject=current%3AMOD-FREE'));
    expect(screen.queryByText('Course not available')).not.toBeInTheDocument();
  });

  it('revalidates assignments on a revisit instead of retaining an empty cached list', async () => {
    vi.mocked(fetch).mockImplementationOnce(async () => new Response(JSON.stringify({ template: null, csrfToken: '' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ freeCourses: [] })));
    const first = renderCourses();
    await screen.findByText('No free courses yet');
    first.unmount();
    renderCourses();
    expect(await screen.findByRole('heading', { name: 'Standalone skills' })).toBeVisible();
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes('/free-courses/'))).toHaveLength(2);
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes('/certificates/'))).toHaveLength(1);
  });

  it('hides the previous learner while another learner is loading', async () => {
    const view = renderCourses();
    await screen.findByRole('heading', { name: 'Standalone skills' });
    vi.mocked(fetch).mockImplementation(() => new Promise(() => {}));
    view.rerender(<MemoryRouter><FreeCoursesTab kind="commercial" id="8" /></MemoryRouter>);
    expect(screen.queryByRole('heading', { name: 'Standalone skills' })).not.toBeInTheDocument();
  });
});

describe('standalone free-course certificates', () => {
  const template = { id: 1, version: 2, title: 'Achievement', minimumProgress: 80, requireFinalTest: true };
  const course = (completed: number, total = 5): FreeCourse => ({ ...legacy, weeks: [{ weekId: 'W1', weekNumber: 1, weekTitle: 'Learning', displayOrder: 1,
    activities: Array.from({ length: total }, (_, i) => ({ componentId: `C${i}`, title: `Reading ${i}`, type: 'reading', expectedOtjh: 1, contentHtml: '<p>Read this lesson.</p>', completed: i < completed })) }] });
  function setup(completed: number, published = true, total = 5) {
    vi.mocked(fetch).mockImplementation(async input => new Response(JSON.stringify(String(input).endsWith('/issue/')
      ? { certificate: { verificationUrl: '/verify-certificate/synthetic' }, issued: true }
      : String(input).includes('/certificates/') ? { template: published ? template : null, csrfToken: 'csrf-token' }
      : String(input).endsWith('/complete/') ? { completed: true }
      : { freeCourses: [course(completed, total)] })));
  }

  it.each(['commercial', 'apprenticeship'] as const)('issues an eligible %s course without an exam and uses the verification link', async kind => {
    setup(4);
    const replace = vi.fn();
    vi.spyOn(window, 'open').mockReturnValue({ document: { title: '', body: { innerHTML: '' } }, location: { replace }, close: vi.fn() } as unknown as Window);
    renderCourses(kind);
    fireEvent.click(await screen.findByRole('button', { name: 'Get certificate' }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/verify-certificate/synthetic'));
    expect(fetch).toHaveBeenCalledWith(`/learner_api/certificates/${kind}/7/modules/free%3AOLD-1/issue/`, expect.objectContaining({
      method: 'POST', headers: { 'X-CSRFToken': 'csrf-token', 'X-Requested-With': 'XMLHttpRequest' },
    }));
    expect(screen.getByRole('button', { name: 'View certificate' })).toBeVisible();
  });

  it('unlocks inside the course immediately after completion reaches the threshold', async () => {
    setup(3);
    renderCourses('commercial', '?mode=free&course=OLD-1');
    const complete = await screen.findByRole('button', { name: 'Mark as complete' });
    expect(screen.queryByRole('button', { name: 'Get certificate' })).not.toBeInTheDocument();
    fireEvent.click(complete);
    expect(await screen.findByRole('button', { name: 'Get certificate' })).toBeVisible();
  });

  it.each(['commercial', 'apprenticeship'] as const)('unlocks from Required activities while retaining ordinary %s course progress', async kind => {
    const mixed = course(4);
    mixed.weeks[0].activities.push(...Array.from({ length: 5 }, (_, i) => ({ componentId: `O${i}`, title: `Extra ${i}`,
      type: 'reading', expectedOtjh: 0, contentHtml: '<p>Extra</p>', completed: false })));
    vi.mocked(fetch).mockImplementation(async input => new Response(JSON.stringify(String(input).includes('/certificates/')
      ? { template, csrfToken: 'csrf' } : { freeCourses: [mixed] })));
    renderCourses(kind);
    expect(await screen.findByRole('button', { name: 'Get certificate' })).toBeVisible();
    expect(screen.getByRole('progressbar', { name: 'Legacy skills progress' })).toHaveAttribute('aria-valuenow', '40');
  });

  it('keeps certificates locked if only optional activities are completed', async () => {
    const optional = course(5);
    optional.weeks[0].activities.forEach(activity => { activity.expectedOtjh = 0; });
    vi.mocked(fetch).mockImplementation(async input => new Response(JSON.stringify(String(input).includes('/certificates/')
      ? { template: { ...template, minimumProgress: 0 }, csrfToken: 'csrf' } : { freeCourses: [optional] })));
    renderCourses();
    expect(await screen.findByRole('progressbar', { name: 'Legacy skills progress' })).toHaveAttribute('aria-valuenow', '100');
    expect(screen.queryByRole('button', { name: 'Get certificate' })).not.toBeInTheDocument();
  });

  it('keeps an existing free-course certificate visible below a newer threshold', async () => {
    vi.mocked(fetch).mockImplementation(async input => new Response(JSON.stringify(String(input).includes('/certificates/')
      ? { template: { ...template, minimumProgress: 100, issuedModuleRefs: ['free:OLD-1'] }, csrfToken: 'csrf-token' }
      : { freeCourses: [course(4)] })));
    renderCourses();
    expect(await screen.findByRole('button', { name: 'View certificate' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Get certificate' })).not.toBeInTheDocument();
  });

  it('does not offer a certificate without a published template', async () => {
    setup(5, false);
    renderCourses();
    await screen.findByRole('heading', { name: 'Legacy skills' });
    expect(screen.queryByRole('button', { name: 'Get certificate' })).not.toBeInTheDocument();
  });

  it('displays 79.5% and keeps the certificate locked below the 80% threshold', async () => {
    setup(159, true, 200);
    renderCourses();
    expect(await screen.findByRole('progressbar', { name: 'Legacy skills progress' })).toHaveAttribute('aria-valuenow', '79.5');
    expect(screen.getByText('159 of 200 completed')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Get certificate' })).not.toBeInTheDocument();
  });

  it('shows an issuance failure and never caches a successful certificate', async () => {
    setup(4);
    const normal = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation((input, init) => String(input).endsWith('/issue/')
      ? Promise.resolve(new Response(JSON.stringify({ error: 'Progress could not be verified.' }), { status: 409 })) : normal(input, init));
    const close = vi.fn();
    vi.spyOn(window, 'open').mockReturnValue({ document: { title: '', body: { innerHTML: '' } }, close } as unknown as Window);
    renderCourses();
    fireEvent.click(await screen.findByRole('button', { name: 'Get certificate' }));
    expect(await screen.findByText('Progress could not be verified.')).toBeVisible();
    expect(close).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'View certificate' })).not.toBeInTheDocument();
  });
});
