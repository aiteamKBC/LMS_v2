import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FreeCoursesTab } from './FreeCoursesTab';
import { clearAllCachedResources } from '@/api/cachedRequest';
import type { FreeCourse } from '@/api/freeCourses';

vi.mock('./SubjectWorkspace', () => ({ Cover: ({ title }: { title: string }) => <span>{title} cover</span> }));

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
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ freeCourses: [assigned, legacy] }))));
});
afterEach(() => { clearAllCachedResources(); vi.unstubAllGlobals(); });

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
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ freeCourses: [] })));
    const first = renderCourses();
    await screen.findByText('No free courses yet');
    first.unmount();
    renderCourses();
    expect(await screen.findByRole('heading', { name: 'Standalone skills' })).toBeVisible();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('hides the previous learner while another learner is loading', async () => {
    const view = renderCourses();
    await screen.findByRole('heading', { name: 'Standalone skills' });
    vi.mocked(fetch).mockImplementation(() => new Promise(() => {}));
    view.rerender(<MemoryRouter><FreeCoursesTab kind="commercial" id="8" /></MemoryRouter>);
    expect(screen.queryByRole('heading', { name: 'Standalone skills' })).not.toBeInTheDocument();
  });
});
