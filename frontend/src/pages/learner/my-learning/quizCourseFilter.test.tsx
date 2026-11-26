import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LearnerQuizList } from '@/api/learnerQuizzes';
import { QuizzesTab } from './page';

const component = (id: string, quizId: number, moduleId: string | null, module: string | null) => ({
  componentId: id, component: `Quiz ${id}`, moduleId, module, week: 'Week 1', expectedOtjh: null,
  isQuiz: true, quizMeta: { quizId, questions: 5, duration: null, timeUnit: null },
});
const learner = (): LearnerQuizList => ({
  id: '17', name: 'Synthetic learner', programme: 'Programme', cohort: '',
  components: [component('A1', 1, 'A', 'Alpha'), component('A2', 2, 'A', 'Alpha'),
    component('B1', 3, 'B', 'Beta'), component('B2', 4, 'B', 'Beta')],
  quizAttempts: [
    { componentId: 'A1', quizId: 1, passed: true, grade: 1, startedAt: '', submittedAt: '' },
    { componentId: 'B1', quizId: 3, passed: true, grade: .8, startedAt: '', submittedAt: '' },
    { componentId: 'B2', quizId: 4, passed: false, grade: 0, startedAt: '', submittedAt: '' },
  ],
});
const panel = (real: LearnerQuizList) => <QuizzesTab real={real} loading={false} loadError={null}
  kind="commercial" id={real.id} canTake={false} navigate={vi.fn()} />;
const filters = () => within(screen.getByRole('navigation', { name: 'Filter quizzes' }));

beforeEach(() => {
  vi.stubGlobal('AppIcon', () => <span />);
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => vi.unstubAllGlobals());

describe('quiz course filter', () => {
  it('combines course and status filters, updates counts, and restores all courses without fetching', () => {
    render(panel(learner()), { wrapper: MemoryRouter });
    const course = screen.getByRole('combobox', { name: 'Course' });
    expect(course).toHaveValue('');
    expect(within(course).getAllByRole('option').map(option => option.textContent)).toEqual(['All courses', 'Alpha', 'Beta']);
    expect(filters().getByRole('button', { name: /^All\s*4$/ })).toBeVisible();
    fireEvent.click(filters().getByRole('button', { name: /^Completed\s*2$/ }));
    fireEvent.change(course, { target: { value: 'module:A' } });
    expect(filters().getByRole('button', { name: /^All\s*2$/ })).toBeVisible();
    expect(filters().getByRole('button', { name: /^Completed\s*1$/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Quiz A1')).toBeVisible();
    expect(screen.queryByText('Quiz B1')).not.toBeInTheDocument();
    fireEvent.click(filters().getByRole('button', { name: /^To Do\s*1$/ }));
    expect(screen.getByText('Quiz A2')).toBeVisible();
    fireEvent.change(course, { target: { value: 'module:B' } });
    expect(screen.getByText('No quizzes match this filter')).toBeVisible();
    fireEvent.change(course, { target: { value: '' } });
    expect(filters().getByRole('button', { name: /^All\s*4$/ })).toBeVisible();
    expect(screen.getByText('Quiz A2')).toBeVisible();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps reused quizzes and equally named courses separate by component and module identity', () => {
    const real = learner();
    real.components = [component('A1', 1, 'A', 'Shared title'), component('B1', 1, 'B', 'Shared title')];
    real.quizAttempts = [real.quizAttempts[0]];
    render(panel(real), { wrapper: MemoryRouter });
    const course = screen.getByRole('combobox', { name: 'Course' });
    expect(within(course).getAllByRole('option', { name: 'Shared title' })).toHaveLength(2);
    fireEvent.change(course, { target: { value: 'module:B' } });
    expect(screen.getByText('Quiz B1')).toBeVisible();
    expect(screen.queryByText('Quiz A1')).not.toBeInTheDocument();
    expect(filters().getByRole('button', { name: /^Completed\s*0$/ })).toBeVisible();
    expect(within(screen.getByRole('row', { name: /Quiz B1/ })).getByText('To do')).toBeVisible();
  });

  it('keeps a selected empty status visible when changing courses', () => {
    render(panel(learner()), { wrapper: MemoryRouter });
    fireEvent.click(filters().getByRole('button', { name: /^Failed\s*1$/ }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Course' }), { target: { value: 'module:A' } });
    expect(filters().getByRole('button', { name: /^Failed\s*0$/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('No quizzes match this filter')).toBeVisible();
    fireEvent.click(filters().getByRole('button', { name: /^All\s*2$/ }));
    expect(screen.getByText('Quiz A1')).toBeVisible();
  });

  it('supports historical course labels and unnamed placements, and recovers when a course is removed', () => {
    const real = learner();
    real.components = [component('OLD', 5, null, 'Historical course'), component('NONE', 6, null, null)];
    const view = render(panel(real), { wrapper: MemoryRouter });
    const course = screen.getByRole('combobox', { name: 'Course' });
    fireEvent.change(course, { target: { value: 'title:Historical course' } });
    expect(screen.getByText('Quiz OLD')).toBeVisible();
    expect(screen.queryByText('Quiz NONE')).not.toBeInTheDocument();
    view.rerender(panel({ ...real, components: [real.components[1]] }));
    expect(course).toHaveValue('');
    expect(screen.getByText('Quiz NONE')).toBeVisible();
    expect(within(course).getByRole('option', { name: 'No course specified' })).toBeVisible();
  });
});
