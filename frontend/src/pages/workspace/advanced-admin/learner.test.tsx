import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { Link, MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { SidebarNavItem } from '@/components/feature/Sidebar';
import { advancedAdminModuleProgress, advancedAdminWordPressCourses } from '@/api/advancedAdmin';
import { expect, it, vi } from 'vitest';
import AdvancedAdminLearnerPage from './learner';

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ auth: { account: { displayName: 'Reviewer' } } }) }));
vi.mock('@/components/feature/WorkspaceShell', () => ({
  WorkspaceShell: ({ children, navItems }: { children: ReactNode; navItems: SidebarNavItem[] }) => <main>
    <nav aria-label="Advanced Admin navigation">{navItems.map(item => <Link key={item.id} to={item.href || '#'}>{item.label}</Link>)}</nav>
    {children}
  </main>,
}));
vi.mock('@/api/advancedAdmin', () => ({
  advancedAdminLearner: vi.fn().mockResolvedValue({ learner: {
    id: 42, name: 'Sample Learner', programmeCode: 'PCP', programme: 'Project Control',
    group: 'Group A', coach: 'Sample Coach', programmeStatus: 'Active',
  } }),
  advancedAdminLearning: vi.fn().mockResolvedValue({ current: { id: 42 }, historical: { activities: [] } }),
  advancedAdminWordPressCourses: vi.fn().mockResolvedValue({ courses: [], source: 'wordpress-live' }),
  advancedAdminModuleProgress: vi.fn().mockResolvedValue({ progress: {
    modules: [], moduleLinks: {}, moduleProgress: {}, actual: [], actualAvailable: true, sessions: [],
  } }),
}));
vi.mock('./learningAssignments', () => ({ assignedAssessments: () => [] }));
vi.mock('./ReadOnlyLearning', () => ({ default: ({ wordpressCourses }: { wordpressCourses?: { id: number }[] }) =>
  <div data-testid="learning">Course catalogue <output data-testid="verified-courses">{wordpressCourses?.length ?? 0}</output></div> }));
vi.mock('./LearnerModuleProgress', () => ({ default: () => <div data-testid="module-progress">Module summary</div> }));
vi.mock('./InclusionDashboard', () => ({ default: ({ learnerId }: { learnerId: number }) =>
  <div data-testid="inclusion-dashboard">Learner {learnerId} Inclusion</div> }));
vi.mock('./ReviewSections', () => ({ default: ({ selectedTab }: { selectedTab: string }) =>
  <div data-testid="records">{selectedTab}{selectedTab === 'assessments' &&
    <h2 id="advanced-assessments" tabIndex={-1}>Assignments by Month</h2>}</div> }));

function CurrentPath() {
  const location = useLocation();
  return <output data-testid="current-path">{location.pathname}{location.search}</output>;
}

it('opens the selected learner section as its own route from the main navigation', async () => {
  render(<MemoryRouter initialEntries={['/workspace/advanced-admin/learners/42']}>
    <Routes>
      <Route path="/workspace/advanced-admin/learners/:learnerId" element={<AdvancedAdminLearnerPage />} />
      <Route path="/workspace/advanced-admin/learners/:learnerId/:section" element={<AdvancedAdminLearnerPage />} />
    </Routes>
  </MemoryRouter>);

  const navigation = await screen.findByRole('navigation', { name: 'Advanced Admin navigation' });
  expect(within(navigation).getAllByRole('link')).toHaveLength(6);
  expect(within(navigation).queryByRole('link', { name: 'Evidence & files' })).not.toBeInTheDocument();
  expect(within(navigation).queryByRole('link', { name: 'Monthly reports' })).not.toBeInTheDocument();
  expect(screen.queryByRole('navigation', { name: 'Learner file categories' })).not.toBeInTheDocument();
  expect(within(navigation).getByRole('link', { name: 'Learning & progress' })).toHaveAttribute('href', '/workspace/advanced-admin/learners/42/learning');
  expect(await screen.findByTestId('module-progress')).toBeVisible();
  expect(screen.queryByTestId('learning')).not.toBeInTheDocument();
  expect(screen.queryByTestId('records')).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'View as learner (read only)' })).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('tab', { name: 'Courses & Activities' }));
  expect(screen.getByTestId('learning')).toBeVisible();
  expect(screen.queryByTestId('module-progress')).not.toBeInTheDocument();

  fireEvent.click(within(navigation).getByRole('link', { name: 'Lectures & attendance' }));
  expect(screen.getByRole('heading', { name: 'Learner file' })).toBeVisible();
  expect(screen.queryByRole('link', { name: 'View as learner (read only)' })).not.toBeInTheDocument();

  fireEvent.click(within(navigation).getByRole('link', { name: 'Assignments & Marking' }));
  expect(within(navigation).getByRole('link', { name: 'Assignments & Marking' })).toHaveAttribute('href', '/workspace/advanced-admin/learners/42/assessments');
  expect(screen.getByText('Assignments & Marking')).toBeInTheDocument();
  expect(screen.queryByTestId('learning')).not.toBeInTheDocument();
  expect(screen.getByTestId('records')).toBeVisible();
  expect(screen.getByTestId('records')).toHaveTextContent('assessments');
  expect(screen.getByRole('heading', { name: 'Assignments by Month' })).toHaveFocus();
  expect(screen.getByRole('link', { name: 'Back to Student Profile' })).toHaveAttribute('href', '/workspace/advanced-admin/learners/42/learning');

  fireEvent.click(within(navigation).getByRole('link', { name: 'Inclusion & support' }));
  expect(screen.getByTestId('inclusion-dashboard')).toHaveTextContent('Learner 42 Inclusion');
  expect(screen.queryByTestId('records')).not.toBeInTheDocument();

  fireEvent.click(within(navigation).getByRole('link', { name: 'PR & MCM' }));
  expect(screen.getByTestId('records')).toHaveTextContent('reviews');
});

it.each(['evidence', 'monthly'])('redirects the removed %s learner page to Learning & progress', async section => {
  render(<MemoryRouter initialEntries={[`/workspace/advanced-admin/learners/42/${section}`]}>
    <Routes>
      <Route path="/workspace/advanced-admin/learners/:learnerId/:section" element={<><AdvancedAdminLearnerPage /><CurrentPath /></>} />
    </Routes>
  </MemoryRouter>);

  await waitFor(() => expect(screen.getByTestId('current-path')).toHaveTextContent('/workspace/advanced-admin/learners/42/learning'));
  expect(screen.getByRole('heading', { name: 'Learning & progress' })).toBeVisible();
  expect(screen.queryByTestId('records')).not.toBeInTheDocument();
});

it('shows ready module metrics and current course content while verified courses are pending', async () => {
  vi.mocked(advancedAdminModuleProgress).mockResolvedValueOnce({ progress: {
    modules: [{ id: 'module-1', title: 'Planning', total_otjh: 20 }], moduleLinks: {},
    moduleProgress: { 'module-1': { hours: { actual: 4 }, ksb: { completed: 2, total: 3 } } },
    actual: [], actualAvailable: true, sessions: [],
  } } as never);
  let resolveCourses!: (value: { courses: { id: number; title: string; completedActivities: number;
    startedActivities: number; activities: { id: number; title: string; type: string; completed: boolean; started: boolean }[] }[];
    source: 'wordpress-live' }) => void;
  vi.mocked(advancedAdminWordPressCourses).mockImplementationOnce(() => new Promise(resolve => { resolveCourses = resolve; }));
  render(<MemoryRouter initialEntries={['/workspace/advanced-admin/learners/42/learning']}>
    <Routes><Route path="/workspace/advanced-admin/learners/:learnerId/:section" element={<AdvancedAdminLearnerPage />} /></Routes>
  </MemoryRouter>);

  expect(await screen.findByRole('region', { name: 'Available module metrics' })).toBeVisible();
  expect(screen.getByText('Recorded OTH: 4h')).toBeVisible();
  expect(screen.getByText('KSBs: 2 / 3')).toBeVisible();
  expect(screen.queryByTestId('module-progress')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: 'Courses & Activities' }));
  expect(await screen.findByTestId('learning')).toBeVisible();
  expect(screen.getByTestId('verified-courses')).toHaveTextContent('0');

  resolveCourses({ source: 'wordpress-live', courses: [{ id: 8, title: 'Verified course',
    completedActivities: 6, startedActivities: 6,
    activities: Array.from({ length: 6 }, (_, index) => ({ id: index + 1, title: `Activity ${index + 1}`,
      type: 'reading', completed: true, started: true })) }] });
  await waitFor(() => expect(screen.getByTestId('verified-courses')).toHaveTextContent('1'));
  fireEvent.click(screen.getByRole('tab', { name: 'Module Progress' }));
  expect(await screen.findByTestId('module-progress')).toBeVisible();
  expect(screen.queryByRole('region', { name: 'Available module metrics' })).not.toBeInTheDocument();
});

it('loads module progress when its tab is opened', async () => {
  const priorCalls = vi.mocked(advancedAdminModuleProgress).mock.calls.length;
  render(<MemoryRouter initialEntries={['/workspace/advanced-admin/learners/42/learning?view=courses']}>
    <Routes><Route path="/workspace/advanced-admin/learners/:learnerId/:section" element={<AdvancedAdminLearnerPage />} /></Routes>
  </MemoryRouter>);
  expect(await screen.findByTestId('learning')).toBeVisible();
  expect(advancedAdminModuleProgress).toHaveBeenCalledTimes(priorCalls);
  fireEvent.click(screen.getByRole('tab', { name: 'Module Progress' }));
  await waitFor(() => expect(advancedAdminModuleProgress).toHaveBeenCalledTimes(priorCalls + 1));
});

it('reuses verified courses when returning to the same learner section', async () => {
  const priorCalls = vi.mocked(advancedAdminWordPressCourses).mock.calls.length;
  render(<MemoryRouter initialEntries={['/workspace/advanced-admin/learners/42/learning']}>
    <Routes><Route path="/workspace/advanced-admin/learners/:learnerId/:section" element={<AdvancedAdminLearnerPage />} /></Routes>
  </MemoryRouter>);
  expect(await screen.findByTestId('module-progress')).toBeVisible();
  expect(advancedAdminWordPressCourses).toHaveBeenCalledTimes(priorCalls + 1);
  const navigation = screen.getByRole('navigation', { name: 'Advanced Admin navigation' });
  fireEvent.click(within(navigation).getByRole('link', { name: 'Lectures & attendance' }));
  fireEvent.click(within(navigation).getByRole('link', { name: 'Learning & progress' }));
  expect(await screen.findByTestId('module-progress')).toBeVisible();
  expect(advancedAdminWordPressCourses).toHaveBeenCalledTimes(priorCalls + 1);
});
