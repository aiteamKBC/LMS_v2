import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { Link, MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import type { SidebarNavItem } from '@/components/feature/Sidebar';
import { useEmployerPortalChrome } from './employerPortalNav';

const viewer = vi.hoisted(() => ({ role: 'employer' }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({
  auth: { account: { role: viewer.role, displayName: 'Example Employer' }, roles: [] },
  isAdmin: viewer.role === 'admin', canSeeNavItem: () => true,
}) }));
vi.mock('@/hooks/useLearnerNavGate', () => ({ useLearnerNavGate: (_role: string, items: SidebarNavItem[]) => items }));
vi.mock('@/components/feature/GlobalSearch', () => ({ GlobalSearch: () => null }));
vi.mock('@/components/feature/CoachViewAsBar', () => ({ CoachViewAsBar: () => null }));
vi.mock('@/components/feature/Header', () => ({ Header: () => null }));

function Portal() {
  const { shell } = useEmployerPortalChrome('7');
  const location = useLocation();
  const navigate = useNavigate();
  return <WorkspaceShell {...shell} pageTitle="Learner">
    <output data-testid="route">{location.pathname}{location.search}</output>
    <output data-testid="return-to">{(location.state as { employerReturnTo?: string } | null)?.employerReturnTo}</output>
    <Link to="/employers/7/learner/commercial/101?tab=reviews&reviewId=example">Open learner reviews</Link>
    <Link to="/employers/7/learner/commercial/101?tab=documents">Open learner documents</Link>
    <Link to="/employers/7/learner/commercial/101?tab=plan">Open learning plan</Link>
    <button onClick={() => navigate(-1)}>Browser back</button>
    <button onClick={() => navigate(1)}>Browser forward</button>
  </WorkspaceShell>;
}

beforeEach(() => {
  viewer.role = 'employer';
  localStorage.clear();
  sessionStorage.clear();
});

function expectSection(label: string, href: string) {
  const sidebar = within(screen.getByRole('complementary', { name: 'Employer sidebar' }));
  const activeLinks = sidebar.getAllByRole('link').filter(link => link.getAttribute('aria-current') === 'page');
  expect(activeLinks).toHaveLength(1);
  expect(activeLinks[0]).toHaveAccessibleName(label);
  expect(activeLinks[0]).toHaveAttribute('href', href);
  expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toHaveTextContent(label);
}

it.each([
  ['/employers/7', 'Home', '/employers/7'],
  ['/employers/7/learners', 'My learners', '/employers/7/learners'],
  ['/employers/7/reviews', 'Progress reviews', '/employers/7/reviews'],
  ['/employers/7/documents', 'Documents', '/employers/7/documents'],
  ...['commercial', 'apprenticeship'].flatMap(kind => [
    [`/employers/7/learner/${kind}/101?tab=reviews`, 'Progress reviews', '/employers/7/reviews'],
    [`/employers/7/learner/${kind}/101/?reviewId=example&tab=reviews`, 'Progress reviews', '/employers/7/reviews'],
    [`/employers/7/learner/${kind}/101?tab=documents`, 'Documents', '/employers/7/documents'],
    [`/employers/7/learner/${kind}/101`, 'My learners', '/employers/7/learners'],
    [`/employers/7/learner/${kind}/101?tab=unknown`, 'My learners', '/employers/7/learners'],
  ]),
])('resolves the sidebar and breadcrumb on a direct visit to %s', (path, label, href) => {
  render(<MemoryRouter initialEntries={[path]}><Portal /></MemoryRouter>);
  expectSection(label, href);
});

it.each(['employer', 'staff', 'admin'])('tracks tabs and browser history for %s without changing menu destinations', role => {
  viewer.role = role;
  render(<MemoryRouter initialEntries={['/employers/7/learner/commercial/101']}><Portal /></MemoryRouter>);
  const sidebar = within(screen.getByRole('complementary', { name: 'Employer sidebar' }));
  const destinations = () => sidebar.getAllByRole('link').map(link => link.getAttribute('href'));
  const original = destinations();
  fireEvent.click(screen.getByRole('link', { name: 'Open learner reviews' }));
  expectSection('Progress reviews', '/employers/7/reviews');
  fireEvent.click(screen.getByRole('link', { name: 'Open learner documents' }));
  expectSection('Documents', '/employers/7/documents');
  fireEvent.click(screen.getByRole('button', { name: 'Browser back' }));
  expectSection('Progress reviews', '/employers/7/reviews');
  fireEvent.click(screen.getByRole('button', { name: 'Browser forward' }));
  expectSection('Documents', '/employers/7/documents');
  fireEvent.click(screen.getByRole('link', { name: 'Open learning plan' }));
  expectSection('My learners', '/employers/7/learners');
  expect(destinations()).toEqual(original);
  fireEvent.click(sidebar.getByRole('link', { name: 'Progress reviews' }));
  expect(screen.getByTestId('route')).toHaveTextContent('/employers/7/reviews');
  expectSection('Progress reviews', '/employers/7/reviews');
  fireEvent.click(sidebar.getByRole('link', { name: 'Home' }));
  expectSection('Home', '/employers/7');
});

it('preserves the staff return destination when switching Employer sections from the sidebar', () => {
  viewer.role = 'admin';
  render(<MemoryRouter initialEntries={[{ pathname: '/employers/7', state: { employerReturnTo: '/workspace/admin/employers?search=kent' } }]}><Portal /></MemoryRouter>);

  fireEvent.click(within(screen.getByRole('complementary', { name: 'Employer sidebar' })).getByRole('link', { name: 'My learners' }));

  expect(screen.getByTestId('route')).toHaveTextContent('/employers/7/learners');
  expect(screen.getByTestId('return-to')).toHaveTextContent('/workspace/admin/employers?search=kent');
});
