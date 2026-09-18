import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { PersonalLearningEntry } from './PersonalLearningEntry';
import { PersonalLearningBanner } from './PersonalLearningBanner';
import { readPersonalLearning, rememberPersonalLearning } from '@/lib/personalLearning';
const auth = vi.hoisted(() => ({ account: { role: 'admin', id: 7 } }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ auth }) }));
function Destination() { return <div data-testid="route">{useLocation().pathname}</div>; }
const open = (unsaved = false) => render(<MemoryRouter initialEntries={['/curriculum/module-builder?module=MOD-A']}><Routes>
  <Route path="/curriculum/module-builder" element={<PersonalLearningEntry moduleId="MOD-A" title="Marketing" unsaved={unsaved} onClose={vi.fn()} />} />
  <Route path="*" element={<Destination />} />
</Routes></MemoryRouter>);
beforeEach(() => { sessionStorage.clear(); vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Unexpected network'))); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe('enter and leave the shared learner pages', () => {
  it.each([['Preview the learner experience', 'preview'], ['Preview all content', 'all']])('opens %s without creating an enrolment', async (label, mode) => {
    open(); fireEvent.click(screen.getByRole('button', { name: new RegExp(label) }));
    expect(await screen.findByTestId('route')).toHaveTextContent(`/learner/my-learning/commercial/pl.7.${mode}.MOD-A`);
    expect(fetch).not.toHaveBeenCalled();
    expect(readPersonalLearning()?.returnTo).toBe('/curriculum/module-builder?module=MOD-A');
  });
  it('confirms enrolment in only the open module and uses the returned owner identity', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ id: 'pl.7.study.MOD-A' }), { status: 200 }));
    open(); fireEvent.click(screen.getByRole('button', { name: /Confirm and join/ }));
    expect(await screen.findByTestId('route')).toHaveTextContent('/learner/my-learning/commercial/pl.7.study.MOD-A');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith('/learner_api/personal-learning/courses/', expect.objectContaining({ method: 'POST', body: '{"moduleId":"MOD-A"}' }));
  });
  it('retains the builder on failure and permits retry', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ error: 'Course unavailable' }), { status: 503 }));
    open(); fireEvent.click(screen.getByRole('button', { name: /Confirm and join/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Course unavailable');
    await waitFor(() => expect(screen.getByRole('button', { name: /Confirm and join/ })).toBeEnabled());
    expect(readPersonalLearning()).toBeNull();
  });
  it('protects unsaved module changes', () => {
    open(true);
    expect(screen.getByRole('alert')).toHaveTextContent('Save your module changes');
    expect(screen.getByRole('button', { name: /Preview all/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Confirm and join/ })).toBeDisabled();
  });
  it('returns to the builder and clears personal mode', async () => {
    rememberPersonalLearning('pl.7.preview.MOD-A', '/curriculum/module-builder?module=MOD-A');
    render(<MemoryRouter initialEntries={['/learner/my-learning']}><Routes>
      <Route path="/learner/my-learning" element={<PersonalLearningBanner context={readPersonalLearning()!} />} />
      <Route path="*" element={<Destination />} />
    </Routes></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Return to admin' }));
    expect(await screen.findByTestId('route')).toHaveTextContent('/curriculum/module-builder');
    expect(readPersonalLearning()).toBeNull();
  });
});
