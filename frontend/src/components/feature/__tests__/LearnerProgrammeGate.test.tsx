import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LearnerProgrammeGate } from '../LearnerProgrammeGate';

const state = vi.hoisted(() => ({ role: 'learner', result: {
  real: { learningAccess: { blocked: true, startDate: '2026-10-01' } }, loading: false, loadError: '', refresh: vi.fn(),
} }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ auth: { account: {
  role: state.role, subjectId: 499, learnerType: 'commercial',
} } }) }));
vi.mock('@/hooks/useLearnerSummaryParam', () => ({ useLearnerSummaryParam: () => state.result }));
const mounted = vi.fn();
function Activity() { mounted(); return <h1>Lesson content</h1>; }
function renderGate(path: string) {
  render(<MemoryRouter initialEntries={[path]}><Routes>
    <Route path="/workspace/learner" element={<h1>Programme and plan</h1>} />
    <Route path="*" element={<LearnerProgrammeGate><Activity /></LearnerProgrammeGate>} />
  </Routes></MemoryRouter>);
}
beforeEach(() => { state.role = 'learner'; state.result.real.learningAccess.blocked = true; state.result.loadError = ''; state.result.loading = false; mounted.mockClear(); });
afterEach(cleanup);
describe('cohort start route gate', () => {
  it.each(['/learner/my-learning', '/learner/modules/commercial/499', '/learner/quiz/commercial/499/1',
    '/learner/video/commercial/499/1', '/learner/component/commercial/499/1', '/learner/monthly-submission/commercial/499/1'])(
    'keeps %s from mounting before cohort start', path => {
      renderGate(path);
      expect(screen.getByText('Programme and plan')).toBeVisible();
      expect(mounted).not.toHaveBeenCalled();
    },
  );
  it('opens module content once the server reports the cohort has started', () => {
    state.result.real.learningAccess.blocked = false;
    renderGate('/learner/modules/commercial/499');
    expect(screen.getByText('Lesson content')).toBeVisible();
  });
  it('keeps staff reviews and learner profile pages available', () => {
    state.role = 'staff'; renderGate('/learner/component/commercial/499/1');
    expect(screen.getByText('Lesson content')).toBeVisible();
    cleanup(); state.role = 'learner'; renderGate('/learner/profile');
    expect(screen.getByText('Lesson content')).toBeVisible();
  });
  it('does not mount a lesson while checking the date or after a failed check', () => {
    state.result.loading = true; renderGate('/learner/my-learning');
    expect(mounted).not.toHaveBeenCalled();
    cleanup(); state.result.loading = false; state.result.loadError = 'Try again later';
    renderGate('/learner/my-learning');
    expect(screen.getByText('Try again later')).toBeVisible();
    expect(mounted).not.toHaveBeenCalled();
  });
});
