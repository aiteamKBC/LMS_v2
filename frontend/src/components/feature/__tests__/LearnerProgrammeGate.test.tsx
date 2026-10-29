import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LearnerProgrammeGate } from '../LearnerProgrammeGate';
import { useLearnerSummaryParam } from '@/hooks/useLearnerSummaryParam';

const state = vi.hoisted(() => ({ role: 'learner', result: {
  real: { learningAccess: { blocked: true, startDate: '2026-10-01' } }, loading: false, loadError: '', refresh: vi.fn(),
} }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ auth: { account: {
  role: state.role, subjectId: 499, learnerType: 'commercial',
} } }) }));
vi.mock('@/hooks/useLearnerSummaryParam', () => ({ useLearnerSummaryParam: vi.fn(() => state.result) }));
const mounted = vi.fn();
function Activity() { mounted(); return <h1>Lesson content</h1>; }
function renderGate(path: string) {
  render(<MemoryRouter initialEntries={[path]}><Routes>
    <Route path="/workspace/learner/dashboard" element={<h1>Programme and plan</h1>} />
    <Route path="*" element={<LearnerProgrammeGate><Activity /></LearnerProgrammeGate>} />
  </Routes></MemoryRouter>);
}
beforeEach(() => { state.role = 'learner'; state.result.real.learningAccess.blocked = true; state.result.loadError = ''; state.result.loading = false; vi.clearAllMocks(); });
afterEach(cleanup);
describe('cohort start route gate', () => {
  it.each(['/learner/my-learning', '/learner/modules/commercial/499', '/learner/quiz/commercial/499/1',
    '/learner/video/commercial/499/1', '/learner/component/commercial/499/1', '/learner/monthly-submission/commercial/499/1'])(
    'opens %s even though the cohort start date is still ahead', path => {
      renderGate(path);
      expect(screen.getByText('Lesson content')).toBeVisible();
      expect(mounted).toHaveBeenCalled();
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
  it.each([
    { loading: true, loadError: '' },
    { loading: false, loadError: 'Loading is taking longer than expected. Please try again.' },
  ])('opens the page independently of an ancillary summary read: %j', result => {
    Object.assign(state.result, result);
    renderGate('/learner/monthly-submission/commercial/499/ASSIGNMENT');
    expect(screen.getByText('Lesson content')).toBeVisible();
    expect(mounted).toHaveBeenCalled();
    expect(useLearnerSummaryParam).not.toHaveBeenCalled();
  });

  it('keeps unsaved answers editable when an unrelated summary refresh fails', () => {
    state.result.real.learningAccess.blocked = false;
    const view = () => <MemoryRouter initialEntries={['/learner/my-learning']}><LearnerProgrammeGate><input aria-label="Unsaved answer" defaultValue="" /></LearnerProgrammeGate></MemoryRouter>;
    const { rerender } = render(view());
    const answer = screen.getByRole('textbox', { name: 'Unsaved answer' });
    fireEvent.change(answer, { target: { value: 'My work' } });
    state.result.loadError = 'Server unavailable';
    rerender(view());
    expect(screen.getByRole('textbox', { name: 'Unsaved answer' })).toBe(answer);
    expect(answer).toHaveValue('My work');
    expect(answer.closest('[inert]')).toBeNull();
    fireEvent.change(answer, { target: { value: 'My continued work' } });
    state.result.loadError = '';
    rerender(view());
    expect(answer).toHaveValue('My continued work');
    expect(answer.closest('[inert]')).toBeNull();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('leaves the activity own loading failure visible', () => {
    render(<MemoryRouter initialEntries={['/learner/component/commercial/499/ASSIGNMENT']}>
      <LearnerProgrammeGate><div role="alert">Could not load this assignment.</div></LearnerProgrammeGate>
    </MemoryRouter>);
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load this assignment.');
  });
});
