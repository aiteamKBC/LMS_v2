import type { ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { personalLearningJson, readPersonalLearning } from '@/lib/personalLearning';
import { useMyLearningModule } from '@/api/myLearning';
import { apprenticeNavItems, enrolmentNavItems } from '@/mocks/navigation';
import CoursesPage from './page';

const viewer = vi.hoisted(() => ({ account: { id: 7, role: 'admin' } }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ auth: { account: viewer.account } }) }));
vi.mock('../presentation/EnrolmentWorkspaceShell', () => ({ EnrolmentWorkspaceShell: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock('@/lib/personalLearning', async () => ({ ...await vi.importActual<typeof import('@/lib/personalLearning')>('@/lib/personalLearning'), personalLearningJson: vi.fn() }));
vi.mock('@/api/myLearning', () => ({ useMyLearningModule: vi.fn() }));
const course = { id: 'pl.7.study.M1', moduleId: 'M1', title: 'Example personal course', progressPercent: 25, trackableDone: 2, trackableTotal: 8, reviewCoach: 'Example Coach' };
function Location() { return <output aria-label="Current URL">{useLocation().pathname}</output>; }
function show() { return render(<MemoryRouter initialEntries={['/users/my-courses']}><CoursesPage /><Location /></MemoryRouter>); }
beforeEach(() => {
  vi.clearAllMocks(); sessionStorage.clear(); viewer.account = { id: 7, role: 'admin' };
  vi.mocked(personalLearningJson).mockReset().mockResolvedValue({ courses: [course] });
  vi.mocked(useMyLearningModule).mockReturnValue({ data: null, error: '', loading: false, refresh: vi.fn() });
});
afterEach(cleanup);

describe('Enrolment personal courses', () => {
  // The My Courses workspace owns personal learning, so neither enrolment
  // sidebar offers it: one page reached two ways read as two sections.
  it('keeps personal courses out of both enrolment sidebars', () => {
    for (const items of [apprenticeNavItems, enrolmentNavItems]) {
      expect(items.some(item => item.id === 'enrolment-courses')).toBe(false);
      expect(items.some(item => item.label === 'My Courses')).toBe(false);
      expect(items.some(item => item.href?.startsWith('/curriculum/'))).toBe(false);
    }
  });

  it('loads existing personal courses and derives activity completion from their counts', async () => {
    vi.mocked(personalLearningJson).mockResolvedValue({ courses: [course, { ...course, id: 'pl.7.study.M2', moduleId: 'M2', title: 'Second course', progressPercent: 100, trackableDone: 2, trackableTotal: 2 }] });
    show(); expect(screen.getByText('Loading your courses…')).toBeVisible();
    await screen.findByRole('article', { name: course.title });
    const stats = screen.getByText('Activities completed').closest('dl')!;
    expect(stats).toHaveTextContent('4 / 10'); expect(stats).toHaveTextContent('40%');
    expect(within(screen.getByRole('article', { name: course.title })).getByRole('progressbar')).toHaveAttribute('value', '25');
    expect(personalLearningJson).toHaveBeenCalledExactlyOnceWith('courses/', { signal: expect.any(AbortSignal) });
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('My Courses');
    expect([...document.querySelectorAll('a[href]')].some(link => link.getAttribute('href')?.startsWith('/curriculum/'))).toBe(false);
  });

  it('continues the exact personal course and remembers the enrolment return route', async () => {
    show(); const card = await screen.findByRole('article', { name: course.title });
    fireEvent.click(within(card).getByRole('button', { name: /^Continue learning/ }));
    expect(screen.getByLabelText('Current URL')).toHaveTextContent('/learner/my-learning/commercial/pl.7.study.M1');
    expect(readPersonalLearning()).toMatchObject({ id: course.id, returnTo: '/users/my-courses' });
    expect(personalLearningJson).toHaveBeenCalledTimes(1);
  });

  it('distinguishes missing progress and unavailable records from real zeroes', async () => {
    vi.mocked(personalLearningJson).mockResolvedValue({ courses: [{ ...course, progressPercent: undefined, trackableDone: undefined }, { ...course, id: 'pl.7.study.OLD', title: 'Unavailable course', unavailable: true }] });
    show(); const card = await screen.findByRole('article', { name: course.title });
    expect(within(card).queryByRole('progressbar')).not.toBeInTheDocument();
    expect(within(card).getByText('Activity progress unavailable')).toBeVisible();
    const unavailable = screen.getByRole('article', { name: 'Unavailable course' });
    expect(within(unavailable).queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText('Activities completed').closest('dl')).not.toHaveTextContent('0 /');
  });

  it('keeps error and empty states truthful and retries failed reads', async () => {
    vi.mocked(personalLearningJson).mockRejectedValueOnce(new Error('Courses unavailable')).mockResolvedValueOnce({ courses: [] });
    show(); expect(await screen.findByRole('alert')).toHaveTextContent('Courses unavailable');
    expect(screen.queryByText('No personal courses yet')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByText('No personal courses yet');
    expect(personalLearningJson).toHaveBeenCalledTimes(2);
  });

  it('does not read personal courses for a staff member or a learner', async () => {
    for (const role of ['staff', 'learner']) {
      viewer.account = { id: 8, role }; const view = show();
      expect(screen.getByRole('alert')).toHaveTextContent('Sign in as an administrator');
      expect(personalLearningJson).not.toHaveBeenCalled(); view.unmount();
    }
  });

  it('aborts reads on unmount and ignores late responses', async () => {
    let resolve!: (data: unknown) => void;
    vi.mocked(personalLearningJson).mockReturnValue(new Promise(done => { resolve = done; }));
    const view = show(); const signal = vi.mocked(personalLearningJson).mock.calls[0][1]!.signal!;
    view.unmount(); expect(signal.aborted).toBe(true);
    await act(async () => resolve({ courses: [course] }));
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
  });

  it('reads the owned course outline only when it is expanded', async () => {
    show(); await screen.findByRole('article', { name: course.title });
    expect(useMyLearningModule).toHaveBeenLastCalledWith('commercial', course.id, null);
    const details = screen.getByText('Course outline').closest('details')!;
    details.open = true; fireEvent(details, new Event('toggle'));
    await waitFor(() => expect(useMyLearningModule).toHaveBeenLastCalledWith('commercial', course.id, 'current:M1'));
  });
});
