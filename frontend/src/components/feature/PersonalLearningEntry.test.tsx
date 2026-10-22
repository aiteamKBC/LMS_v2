import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { PersonalLearningEntry } from './PersonalLearningEntry';
import { PersonalLearningBanner } from './PersonalLearningBanner';
import { readPersonalLearning, rememberPersonalLearning } from '@/lib/personalLearning';
import { createCachedResource } from '@/api/cachedRequest';
const auth = vi.hoisted(() => ({ account: { role: 'admin', id: 7 } }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ auth }) }));
function Destination() {
  const { pathname, state } = useLocation();
  return <div data-testid="route" data-from={(state as { learnerPreviewFrom?: string } | null)?.learnerPreviewFrom ?? ''}>{pathname}</div>;
}
const open = (unsaved = false) => render(<MemoryRouter initialEntries={['/curriculum/module-builder?module=MOD-A']}><Routes>
  <Route path="/curriculum/module-builder" element={<PersonalLearningEntry moduleId="MOD-A" title="Marketing" unsaved={unsaved} onClose={vi.fn()} />} />
  <Route path="*" element={<Destination />} />
</Routes></MemoryRouter>);
beforeEach(() => { sessionStorage.clear(); vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Unexpected network'))); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe('enter and leave the shared learner pages', () => {
  it.each([['Preview as a learner sees it today', 'preview'], ['Preview all content now', 'all']])('opens %s without creating an enrolment', async (label, mode) => {
    open(); fireEvent.click(screen.getByRole('button', { name: new RegExp(label) }));
    expect(await screen.findByTestId('route')).toHaveTextContent(`/learner/my-learning/commercial/pl.7.${mode}.MOD-A`);
    expect(fetch).not.toHaveBeenCalled();
    expect(readPersonalLearning()?.returnTo).toBe('/curriculum/module-builder?module=MOD-A');
    // Marks the builder to be kept mounted under the preview.
    expect(screen.getByTestId('route')).toHaveAttribute('data-from', '/curriculum/module-builder?module=MOD-A');
  });
  // The builder preview is for checking content, never for enrolling the
  // administrator: joining created personal learner records.
  it('offers no enrolment', () => {
    open();
    expect(screen.queryByRole('button', { name: /join/i })).toBeNull();
    expect(screen.getAllByRole('button', { name: /^Preview/ })).toHaveLength(2);
  });
  // The builder now stays mounted under the preview, so unsaved edits survive
  // it; they used to be lost, which is why entering was refused.
  it('previews with unsaved changes, saying the preview shows the saved version', async () => {
    open(true);
    expect(screen.getByRole('status')).toHaveTextContent('last saved version');
    fireEvent.click(screen.getByRole('button', { name: /Preview all/ }));
    expect(await screen.findByTestId('route')).toHaveTextContent('/learner/my-learning/commercial/pl.7.all.MOD-A');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('returns to the builder and clears personal mode and only that course cached reads', async () => {
    const reads = createCachedResource('entry-test', async (key: string) => key);
    await reads.read('/learner_api/my-learning/commercial/pl.7.preview.MOD-A/');
    await reads.read('/curriculum_api/modules/MOD-A/');
    rememberPersonalLearning('pl.7.preview.MOD-A', '/curriculum/module-builder?module=MOD-A');
    render(<MemoryRouter initialEntries={['/learner/my-learning']}><Routes>
      <Route path="/learner/my-learning" element={<PersonalLearningBanner context={readPersonalLearning()!} />} />
      <Route path="*" element={<Destination />} />
    </Routes></MemoryRouter>);
    expect(screen.queryByRole('link', { name: 'My Courses' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Return to Module Builder' }));
    expect(await screen.findByTestId('route')).toHaveTextContent('/curriculum/module-builder');
    expect(readPersonalLearning()).toBeNull();
    expect(reads.peek('/learner_api/my-learning/commercial/pl.7.preview.MOD-A/')).toBeUndefined();
    expect(reads.peek('/curriculum_api/modules/MOD-A/')).toBe('/curriculum_api/modules/MOD-A/');
  });
  it('keeps the personal study banner unchanged', () => {
    rememberPersonalLearning('pl.7.study.MOD-A', '/my-courses');
    render(<MemoryRouter><PersonalLearningBanner context={readPersonalLearning()!} /></MemoryRouter>);
    expect(screen.getByRole('link', { name: 'My Courses' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Return to admin' })).toBeInTheDocument();
  });
});
