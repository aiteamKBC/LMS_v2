import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import type { SidebarNavItem } from '@/components/feature/Sidebar';
import { curriculumNavItems, roleNavMap } from '@/mocks/navigation';
import { curriculumNavigation, curriculumSidebar } from '../curriculumSidebarNavigation';
import { LEARNER_LOGO_URL } from '@/components/feature/learnerShellAssets';

const viewer = vi.hoisted(() => ({ denied: new Set<string>(), admin: false }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({
  auth: { account: { role: viewer.admin ? 'admin' : 'staff' }, user: { fullName: 'Navigation Test' }, roles: [] },
  isAdmin: viewer.admin,
  canSeeNavItem: (id: string) => !viewer.denied.has(id),
  logout: vi.fn(),
}) }));
vi.mock('@/hooks/useLearnerNavGate', () => ({ useLearnerNavGate: (_role: string, items: SidebarNavItem[]) => items }));
vi.mock('@/components/feature/GlobalSearch', () => ({ GlobalSearch: () => null }));
vi.mock('@/components/feature/CoachViewAsBar', () => ({ CoachViewAsBar: () => null }));
vi.mock('@/components/feature/Header', () => ({
  Header: ({ onToggleMobileSidebar }: { onToggleMobileSidebar: () => void }) => <button onClick={onToggleMobileSidebar}>Open mobile navigation</button>,
  SignOutConfirmModal: () => null,
}));

function CurrentRoute() { return <output data-testid="route">{useLocation().pathname}</output>; }
function Harness({ role = 'curriculum', navItems = curriculumNavItems }: { role?: keyof typeof roleNavMap; navItems?: SidebarNavItem[] }) {
  const config = roleNavMap[role];
  return <WorkspaceShell role={role} roleLabel={config.label} navItems={navItems} workspaceLabel={config.workspaceLabel} pageTitle="Curriculum Home"><CurrentRoute /></WorkspaceShell>;
}
function show(path = '/workspace/curriculum', navItems = curriculumNavItems) {
  return render(<MemoryRouter initialEntries={[path]}><Harness navItems={navItems} /></MemoryRouter>);
}
const desktop = () => within(screen.getByRole('complementary', { name: 'Curriculum Designer sidebar' }));
const menu = () => within(desktop().getByRole('navigation', { name: 'Curriculum Designer primary navigation' }));

beforeEach(() => { viewer.denied.clear(); viewer.admin = false; localStorage.clear(); sessionStorage.clear(); });

describe('Curriculum workspace sidebar presentation', () => {
  it('orders verified destinations and retains the original additional tools without mutating navigation', () => {
    const before = JSON.stringify(curriculumNavItems);
    const items = curriculumNavigation(curriculumNavItems);
    expect(items.map(item => item.label)).toEqual(['Home', 'Programmes', 'Module Builder', 'Courses', 'Library', 'Quality', 'Bulk Attendance', 'Archive', 'Additional tools']);
    expect(items[2].children?.map(item => [item.label, item.href])).toEqual([
      ['Modules', '/curriculum/module-builder'], ['Session recordings', '/curriculum/recordings'], ['Bank holidays', '/curriculum/england-holidays'],
    ]);
    // Transfer Progress belongs to the enrolment sidebars (/users/progress-transfers), not curriculum.
    expect(items[8].children?.map(item => item.href)).toEqual(['/curriculum/coach-directory', '/curriculum/coaching-recordings']);
    expect(curriculumNavItems.some(item => item.href === '/curriculum/delivery')).toBe(false);
    expect(JSON.stringify(curriculumNavItems)).toBe(before);
    show();
    expect(menu().getByText('Curriculum Studio')).toBeInTheDocument();
    expect(menu().getByText('Workspace')).toBeInTheDocument();
    expect(menu().getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page');
    for (const label of ['Route map', 'Feature matrix', 'Integrations', 'States gallery']) expect(menu().queryByText(label)).not.toBeInTheDocument();
  });

  it('preserves parent and child permission checks', () => {
    viewer.denied.add('curriculum-delivery');
    viewer.denied.add('curriculum-library');
    viewer.denied.add('curriculum-courses');
    show();
    expect(menu().queryByRole('button', { name: 'Module Builder' })).not.toBeInTheDocument();
    expect(menu().queryByRole('link', { name: 'Modules' })).not.toBeInTheDocument();
    expect(menu().queryByRole('link', { name: 'Delivery' })).not.toBeInTheDocument();
    expect(menu().queryByRole('link', { name: 'Library' })).not.toBeInTheDocument();
    expect(menu().queryByRole('link', { name: 'Courses' })).not.toBeInTheDocument();
  });

  it('filters an individually denied child and preserves locked delivery destinations', () => {
    viewer.denied.add('curriculum-recordings');
    show('/workspace/curriculum', curriculumNavItems.map(item => item.id === 'curriculum-delivery' ? { ...item, locked: true, lockedReason: 'Restricted delivery' } : item));
    expect(menu().queryByRole('link', { name: 'Session recordings' })).not.toBeInTheDocument();
    expect(menu().getByRole('link', { name: /Modules/ })).toHaveAttribute('aria-disabled', 'true');
    expect(menu().getByRole('link', { name: /Modules/ })).not.toHaveAttribute('href');
  });

  it.each([
    ['/curriculum/module-builder?module=M1', 'Modules'],
    ['/curriculum/modules/M1', 'Modules'],
    ['/curriculum/recordings', 'Session recordings'],
    ['/curriculum/england-holidays', 'Bank holidays'],
  ])('preserves active-route detection for %s', (path, label) => {
    show(path);
    expect(menu().getByRole('link', { name: label })).toHaveAttribute('aria-current', 'page');
    expect(menu().getByRole('button', { name: 'Module Builder' })).toHaveAttribute('aria-current', 'true');
    expect(menu().queryByRole('link', { name: 'Delivery' })).not.toBeInTheDocument();
  });

  it.each([
    ['/curriculum/programmes/P1', 'Programmes'],
    ['/curriculum/library', 'Library'],
    ['/curriculum/courses', 'Courses'],
    ['/curriculum/free-courses', 'Courses'],
    ['/curriculum/quality', 'Quality'],
    ['/curriculum/bulk-attendance', 'Bulk Attendance'],
    ['/curriculum/archive', 'Archive'],
    ['/curriculum/coach-directory', 'Coach directory'],
  ])('keeps the same Curriculum menu on a direct visit to %s', (path, label) => {
    show(path);
    expect(menu().getByText('Curriculum Studio')).toBeInTheDocument();
    expect(menu().getByRole('button', { name: 'Module Builder' })).toBeInTheDocument();
    expect(menu().getByRole('link', { name: label })).toHaveAttribute('aria-current', 'page');
    expect(menu().getAllByRole('link').filter(link => link.getAttribute('aria-current') === 'page')).toHaveLength(1);
  });

  it('uses existing expansion handlers with Curriculum-scoped persisted state', () => {
    localStorage.setItem('kbc_sidebar_expanded', '["original-group"]');
    show();
    const builder = menu().getByRole('button', { name: 'Module Builder' });
    expect(builder).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(builder);
    expect(builder).toHaveAttribute('aria-expanded', 'false');
    expect(menu().queryByRole('link', { name: 'Modules' })).not.toBeInTheDocument();
    fireEvent.click(builder);
    expect(menu().getByRole('link', { name: 'Modules' })).toBeVisible();
    expect(localStorage.getItem('kbc_sidebar_expanded')).toBe('["original-group"]');
    expect(JSON.parse(localStorage.getItem('kbc_curriculum_home_sidebar_expanded')!)).toContain('curriculum-module-builder');
  });

  it('keeps mobile navigation and desktop collapse behavior intact', () => {
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Open mobile navigation' }));
    const drawer = screen.getByLabelText('Curriculum Designer mobile navigation');
    expect(drawer).toHaveAttribute('aria-hidden', 'false');
    fireEvent.click(within(drawer).getByRole('link', { name: 'Session recordings' }));
    expect(screen.getByTestId('route')).toHaveTextContent('/curriculum/recordings');
    expect(drawer).toHaveAttribute('aria-hidden', 'true');
    fireEvent.click(desktop().getByRole('button', { name: 'Collapse sidebar' }));
    expect(desktop().getByRole('button', { name: 'Expand sidebar' })).toBeVisible();
    fireEvent.click(menu().getByRole('button', { name: 'Module Builder' }));
    expect(desktop().getByRole('button', { name: 'Collapse sidebar' })).toBeVisible();
  });

  it('replaces the Curriculum footer sign out with working collapse and expand controls', () => {
    show();
    const branding = desktop().getByAltText('Kent Business College').parentElement!.outerHTML;
    expect(desktop().queryByRole('button', { name: 'Collapse Curriculum Designer navigation' })).not.toBeInTheDocument();
    expect(desktop().queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument();
    fireEvent.click(desktop().getByRole('button', { name: 'Collapse sidebar' }));
    expect(localStorage.getItem('kbc_curriculum_sidebar_collapsed')).toBe('true');
    expect(desktop().getByRole('button', { name: 'Expand sidebar' })).toHaveAttribute('aria-expanded', 'false');
    expect(desktop().queryByRole('button', { name: 'Expand Curriculum Designer navigation' })).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: /sign out/i })).not.toBeInTheDocument();
    fireEvent.click(desktop().getByRole('button', { name: 'Expand sidebar' }));
    expect(localStorage.getItem('kbc_curriculum_sidebar_collapsed')).toBe('false');
    expect(desktop().getByRole('button', { name: 'Collapse sidebar' })).toHaveAttribute('aria-expanded', 'true');
    expect(desktop().getByAltText('Kent Business College').parentElement!.outerHTML).toBe(branding);
  });

  it('restores the collapsed state after remounting and keeps navigation usable', () => {
    const view = show();
    fireEvent.click(desktop().getByRole('button', { name: 'Collapse sidebar' }));
    view.unmount();
    show('/curriculum/programmes');
    expect(desktop().getByRole('button', { name: 'Expand sidebar' })).toBeVisible();
    expect(menu().getByRole('link', { name: 'Programmes' })).toHaveAttribute('aria-current', 'page');
    fireEvent.click(desktop().getByRole('button', { name: 'Expand sidebar' }));
    expect(menu().getByRole('link', { name: 'Programmes' })).toHaveAttribute('aria-current', 'page');
  });

  it('uses the mobile Collapse footer to close the drawer without collapsing the desktop sidebar', () => {
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Open mobile navigation' }));
    const drawer = screen.getByLabelText('Curriculum Designer mobile navigation');
    expect(within(drawer).queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument();
    fireEvent.click(within(drawer).getByRole('button', { name: 'Collapse sidebar' }));
    expect(drawer).toHaveAttribute('aria-hidden', 'true');
    expect(localStorage.getItem('kbc_curriculum_sidebar_collapsed')).not.toBe('true');
    expect(desktop().getByRole('button', { name: 'Collapse sidebar' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Open mobile navigation' }));
    expect(within(drawer).getByRole('link', { name: 'Programmes' })).toBeVisible();
  });

  it('preserves the branding DOM across Curriculum destinations', () => {
    const view = show('/workspace/curriculum');
    const branding = desktop().getByAltText('Kent Business College').parentElement!.outerHTML;
    expect(desktop().getByAltText('Kent Business College')).toHaveAttribute('src', LEARNER_LOGO_URL);
    view.unmount();
    show('/curriculum/quality');
    expect(desktop().getByAltText('Kent Business College').parentElement!.outerHTML).toBe(branding);
    expect(menu().getByText('Workspace')).toBeInTheDocument();
  });

  it('retains the menu, expansion state and active destination when changing Curriculum pages', () => {
    const view = show();
    const destinations = menu().getAllByRole('link').map(link => link.getAttribute('href'));
    fireEvent.click(menu().getByRole('button', { name: 'Module Builder' }));
    fireEvent.click(menu().getByRole('link', { name: 'Quality' }));
    expect(screen.getByTestId('route')).toHaveTextContent('/curriculum/quality');
    expect(menu().getByRole('link', { name: 'Quality' })).toHaveAttribute('aria-current', 'page');
    expect(menu().getByRole('link', { name: 'Home' })).not.toHaveAttribute('aria-current');
    view.unmount();
    show('/curriculum/quality');
    expect(menu().getByRole('button', { name: 'Module Builder' })).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(menu().getByRole('button', { name: 'Module Builder' }));
    expect(menu().getAllByRole('link').map(link => link.getAttribute('href'))).toEqual(destinations);
  });

  it.each(['admin', 'learner', 'advanced-admin'] as const)('keeps the %s workspace navigation unchanged', role => {
    const config = roleNavMap[role];
    const initialPath = config.items.find(item => item.href)?.href ?? '/';
    render(<MemoryRouter initialEntries={[initialPath]}><Harness role={role} navItems={config.items} /></MemoryRouter>);
    const sidebar = within(screen.getByRole('complementary', { name: `${config.label} sidebar` }));
    const navigation = sidebar.getByRole('navigation', { name: `${config.label} primary navigation` });
    expect(navigation).not.toHaveClass(curriculumSidebar.className!);
    expect(within(navigation).queryByText('Workspace', { exact: true })).not.toBeInTheDocument();
    expect(within(navigation).queryByRole('button', { name: 'Module Builder' })).not.toBeInTheDocument();
    expect(localStorage.getItem(curriculumSidebar.expandedStorageKey)).toBeNull();
    const main = screen.getByRole('main');
    main.scrollTop = 700;
    fireEvent.scroll(main);
    expect(screen.queryByRole('button', { name: 'Back to top' })).not.toBeInTheDocument();
    if (role === 'learner' || role === 'advanced-admin') {
      expect(sidebar.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
      expect(sidebar.queryByRole('button', { name: 'Collapse sidebar' })).not.toBeInTheDocument();
    }
  });

  it('keeps My Courses out of the Curriculum workspace for an administrator', () => {
    viewer.admin = true;
    show();
    expect(menu().queryByRole('link', { name: 'My Courses' })).not.toBeInTheDocument();
  });

  it('retains main personal course navigation in the admin workspace', () => {
    viewer.admin = true;
    const role = 'admin';
    const config = roleNavMap[role];
    render(<MemoryRouter initialEntries={['/workspace/' + role]}>
      <Harness role={role} navItems={config.items} />
    </MemoryRouter>);
    const sidebar = within(screen.getByRole('complementary', { name: `${config.label} sidebar` }));
    expect(sidebar.getByRole('link', { name: 'My Courses' })).toHaveAttribute('href', '/my-courses');
  });

  it('shows Back to top after scrolling Curriculum content and returns focus to that content', () => {
    show('/curriculum/archive');
    const main = screen.getByRole('main');
    const scrollTo = vi.fn();
    main.scrollTo = scrollTo;
    expect(screen.queryByRole('button', { name: 'Back to top' })).not.toBeInTheDocument();
    main.scrollTop = 700;
    fireEvent.scroll(main);
    expect(screen.getByRole('button', { name: 'Back to top' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Back to top' }));
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
    expect(main).toHaveFocus();
    main.scrollTop = 0;
    fireEvent.scroll(main);
    expect(screen.queryByRole('button', { name: 'Back to top' })).not.toBeInTheDocument();
  });

  it('returns immediately when reduced motion is requested', () => {
    const original = window.matchMedia.bind(window);
    const media = vi.spyOn(window, 'matchMedia').mockImplementation(query => query === '(prefers-reduced-motion: reduce)'
      ? { ...original(query), matches: true } : original(query));
    try {
      show('/curriculum/programmes');
      const main = screen.getByRole('main');
      main.scrollTo = vi.fn();
      main.scrollTop = 700;
      fireEvent.scroll(main);
      fireEvent.click(screen.getByRole('button', { name: 'Back to top' }));
      expect(main.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'auto' });
    } finally {
      media.mockRestore();
    }
  });
});
