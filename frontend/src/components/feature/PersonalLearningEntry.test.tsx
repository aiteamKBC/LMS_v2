import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement, StrictMode, useEffect, useState } from 'react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate, useRoutes } from 'react-router-dom';
import { PersonalLearningEntry } from './PersonalLearningEntry';
import { PersonalLearningBanner } from './PersonalLearningBanner';
import { readPersonalLearning, rememberPersonalLearning } from '@/lib/personalLearning';
import { createCachedResource } from '@/api/cachedRequest';
import { KeepAliveSlot, LEARNER_PREVIEW_FROM, useKeptLocation } from '@/router/keepAlive';
const auth = vi.hoisted(() => ({ account: { role: 'admin', id: 7 } }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ auth }) }));
function Destination() {
  const { pathname, search, hash, state } = useLocation();
  const hints = state as { learnerPreviewFrom?: string; learnerPreviewUnsaved?: boolean } | null;
  return <div data-testid="route" data-from={hints?.learnerPreviewFrom ?? ''}
    data-unsaved={String(hints?.learnerPreviewUnsaved === true)} data-search={search} data-hash={hash}>{pathname}</div>;
}
const open = (unsaved = false) => render(<MemoryRouter initialEntries={['/curriculum/module-builder?module=MOD-A']}><Routes>
  <Route path="/curriculum/module-builder" element={<PersonalLearningEntry moduleId="MOD-A" title="Marketing" unsaved={unsaved} onClose={vi.fn()} />} />
  <Route path="*" element={<Destination />} />
</Routes></MemoryRouter>);
beforeEach(() => { auth.account.role = 'admin'; sessionStorage.clear(); vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Unexpected network'))); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe('enter and leave the shared learner pages', () => {
  it('opens the normal learner preview directly without creating an enrolment', async () => {
    open();
    expect(await screen.findByTestId('route')).toHaveTextContent('/learner/my-learning/commercial/pl.7.preview.MOD-A');
    expect(fetch).not.toHaveBeenCalled();
    expect(readPersonalLearning()?.returnTo).toBe('/curriculum/module-builder?module=MOD-A');
    // Marks the builder to be kept mounted under the preview.
    expect(screen.getByTestId('route')).toHaveAttribute('data-from', '/curriculum/module-builder?module=MOD-A');
  });
  // The builder preview is for checking content, never for enrolling the
  // administrator: joining created personal learner records.
  it('opens without an enrolment or mode-selection dialog', () => {
    open();
    expect(screen.queryByRole('button', { name: /join/i })).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Preview/ })).toBeNull();
  });
  // The builder now stays mounted under the preview, so unsaved edits survive
  // it; they used to be lost, which is why entering was refused.
  it('previews with unsaved changes and carries the saved-version notice into the preview', async () => {
    open(true);
    expect(await screen.findByTestId('route')).toHaveTextContent('/learner/my-learning/commercial/pl.7.preview.MOD-A');
    expect(screen.getByTestId('route')).toHaveAttribute('data-unsaved', 'true');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('enters once under Strict Mode and keeps the builder return path', async () => {
    const close = vi.fn();
    render(<StrictMode><MemoryRouter initialEntries={['/curriculum/module-builder?module=MOD-A']}><Routes>
      <Route path="/curriculum/module-builder" element={<PersonalLearningEntry moduleId="MOD-A" title="Module" unsaved={false} onClose={close} />} />
      <Route path="*" element={<Destination />} />
    </Routes></MemoryRouter></StrictMode>);
    expect(await screen.findByTestId('route')).toHaveTextContent('/learner/my-learning/commercial/pl.7.preview.MOD-A');
    expect(close).toHaveBeenCalledOnce();
    expect(screen.getByTestId('route')).toHaveAttribute('data-from', '/curriculum/module-builder?module=MOD-A');
  });
  it('does not enter for a non-admin account', () => {
    auth.account.role = 'staff';
    open();
    expect(screen.queryByTestId('route')).toBeNull();
    expect(readPersonalLearning()).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('keeps a failed entry visible and keyboard-accessible without navigating', async () => {
    const close = vi.fn();
    render(<MemoryRouter><PersonalLearningEntry moduleId="invalid module" title="Module" unsaved={false} onClose={close} /></MemoryRouter>);
    expect(await screen.findByRole('alert')).toHaveTextContent('This course cannot be opened');
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(close).toHaveBeenCalledOnce();
    expect(readPersonalLearning()).toBeNull();
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
    expect(screen.queryByRole('button', { name: 'Show all content' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Use learner availability' })).toBeNull();
  });
});

function PreviewScreen() {
  const navigate = useNavigate();
  const context = readPersonalLearning();
  return <>{context && <PersonalLearningBanner context={context} />}<Destination />
    <button onClick={() => navigate(-1)}>Back one page</button></>;
}

const from = '/curriculum/module-builder?module=MOD-A';
const componentPath = '/learner/component/commercial/pl.7.preview.MOD-A/C1';
const previewAt = (entry: { pathname: string; search?: string; hash?: string; state?: Record<string, unknown> }) => render(
  <MemoryRouter initialEntries={[from, entry]} initialIndex={1}><Routes>
    <Route path="/curriculum/module-builder" element={<Destination />} />
    <Route path="*" element={<PreviewScreen />} />
  </Routes></MemoryRouter>,
);

describe('preview mode in the learner banner', () => {
  it('switches both ways while retaining the activity, query, hash, return state and unrelated caches', async () => {
    const reads = createCachedResource('preview-mode-test', async (key: string) => key);
    const oldRead = '/learner_api/my-learning/commercial/pl.7.preview.MOD-A/';
    const nextRead = '/learner_api/my-learning/commercial/pl.7.all.MOD-A/';
    const otherRead = '/learner_api/my-learning/commercial/pl.7.preview.MOD-B/';
    const builderRead = '/curriculum_api/modules/MOD-A/';
    await Promise.all([oldRead, nextRead, otherRead, builderRead].map(key => reads.read(key)));
    rememberPersonalLearning('pl.7.preview.MOD-A', from);
    previewAt({ pathname: componentPath, search: '?module=MOD-A&week=W1&activity=C1', hash: '#reading',
      state: { [LEARNER_PREVIEW_FROM]: from, learnerPreviewUnsaved: true } });
    expect(screen.getByRole('status')).toHaveTextContent('last saved version');
    fireEvent.click(screen.getByRole('button', { name: 'Show all content' }));
    expect(screen.getByTestId('route')).toHaveTextContent('/learner/component/commercial/pl.7.all.MOD-A/C1');
    expect(screen.getByTestId('route')).toHaveAttribute('data-search', '?module=MOD-A&week=W1&activity=C1');
    expect(screen.getByTestId('route')).toHaveAttribute('data-hash', '#reading');
    expect(screen.getByTestId('route')).toHaveAttribute('data-from', from);
    expect(screen.getByRole('status')).toHaveTextContent('unsaved changes stay in Module Builder');
    expect(screen.getByText('Preview · All content')).toBeInTheDocument();
    expect(readPersonalLearning()).toMatchObject({ id: 'pl.7.all.MOD-A', mode: 'all', returnTo: from });
    expect(reads.peek(oldRead)).toBeUndefined();
    expect(reads.peek(nextRead)).toBeUndefined();
    expect(reads.peek(otherRead)).toBe(otherRead);
    expect(reads.peek(builderRead)).toBe(builderRead);
    fireEvent.click(screen.getByRole('button', { name: 'Use learner availability' }));
    expect(screen.getByTestId('route')).toHaveTextContent(componentPath);
    expect(screen.getByText('Preview · Learner experience')).toBeInTheDocument();
    expect(readPersonalLearning()?.mode).toBe('preview');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('replaces the preview history entry so Back returns to the builder', () => {
    rememberPersonalLearning('pl.7.preview.MOD-A', from);
    previewAt({ pathname: componentPath });
    fireEvent.click(screen.getByRole('button', { name: 'Show all content' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back one page' }));
    expect(screen.getByTestId('route')).toHaveTextContent('/curriculum/module-builder');
  });

  it('opens an explicit module identity when switching from a parameterless learner route', () => {
    rememberPersonalLearning('pl.7.preview.MOD-A', from);
    previewAt({ pathname: '/learner/my-learning', search: '?subject=current%3AMOD-A' });
    fireEvent.click(screen.getByRole('button', { name: 'Show all content' }));
    expect(screen.getByTestId('route')).toHaveTextContent('/learner/my-learning/commercial/pl.7.all.MOD-A');
    expect(screen.getByTestId('route')).toHaveAttribute('data-search', '?subject=current%3AMOD-A');
  });

  it('reports a storage failure without changing the route or remembered mode', () => {
    rememberPersonalLearning('pl.7.preview.MOD-A', from);
    previewAt({ pathname: componentPath });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage blocked'); });
    fireEvent.click(screen.getByRole('button', { name: 'Show all content' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Storage blocked');
    expect(screen.getByTestId('route')).toHaveTextContent(componentPath);
    expect(readPersonalLearning()?.mode).toBe('preview');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('retains unsaved builder edits across direct entry, mode switches and return', () => {
    let mounts = 0;
    function Builder() {
      const [draft, setDraft] = useState('');
      const [opening, setOpening] = useState(false);
      useEffect(() => { mounts += 1; }, []);
      return <><input aria-label="Draft" value={draft} onChange={event => setDraft(event.target.value)} />
        <button onClick={() => setOpening(true)}>Preview as learner</button>
        {opening && <PersonalLearningEntry moduleId="MOD-A" title="Module" unsaved={!!draft} onClose={() => setOpening(false)} />}</>;
    }
    const routes = [{ path: '/curriculum/module-builder', element: <Builder /> }, { path: '/learner/*', element: <PreviewScreen /> }];
    function Host() {
      const location = useLocation();
      const kept = useKeptLocation(location);
      const element = useRoutes(routes, kept ?? location);
      const preview = useRoutes(routes, location);
      return <>{createElement(KeepAliveSlot, { hidden: !!kept }, element)}{kept ? preview : null}</>;
    }
    render(<MemoryRouter initialEntries={[from]}><Host /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText('Draft'), { target: { value: 'Keep this unsaved edit' } });
    screen.getByRole('button', { name: 'Preview as learner' }).focus();
    fireEvent.click(screen.getByRole('button', { name: 'Preview as learner' }));
    expect(screen.getByTestId('route')).toHaveTextContent('/learner/my-learning/commercial/pl.7.preview.MOD-A');
    fireEvent.click(screen.getByRole('button', { name: 'Show all content' }));
    fireEvent.click(screen.getByRole('button', { name: 'Use learner availability' }));
    fireEvent.click(screen.getByRole('button', { name: 'Return to Module Builder' }));
    expect(screen.getByLabelText('Draft')).toBeVisible();
    expect(screen.getByLabelText('Draft')).toHaveValue('Keep this unsaved edit');
    expect(screen.getByRole('button', { name: 'Preview as learner' })).toHaveFocus();
    expect(mounts).toBe(1);
    expect(fetch).not.toHaveBeenCalled();
  });
});
