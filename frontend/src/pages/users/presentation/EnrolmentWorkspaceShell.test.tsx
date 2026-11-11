import type { RefObject } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { roleNavMap } from '@/mocks/navigation';
import { EnrolmentWorkspaceShell } from './EnrolmentWorkspaceShell';

const state = vi.hoisted(() => ({ denied: new Set<string>(), logout: vi.fn() }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({
  auth: { account: { displayName: 'Test administrator' } }, isAdmin: true,
  canSeeNavItem: (id: string) => !state.denied.has(id),
  logout: state.logout,
}) }));
vi.mock('@/components/feature/Header', () => ({ Header: ({ onToggleMobileSidebar, mobileMenuButtonRef, onOpenSearch }: {
  onToggleMobileSidebar: () => void; mobileMenuButtonRef: RefObject<HTMLButtonElement | null>; onOpenSearch: () => void;
}) => <header><button ref={mobileMenuButtonRef} onClick={onToggleMobileSidebar}>Open menu</button><button onClick={onOpenSearch}>Search workspace</button></header>,
  SignOutConfirmModal: ({ onClose, onConfirm }: { onClose: () => void; onConfirm: () => void }) => <div role="alertdialog" aria-label="Confirm sign out"><button onClick={onClose}>Cancel sign out</button><button onClick={onConfirm}>Confirm sign out</button></div>,
}));
vi.mock('@/components/feature/GlobalSearch', () => ({ GlobalSearch: ({ isOpen }: { isOpen: boolean }) => isOpen ? <div role="dialog" aria-label="Global search" /> : null }));

beforeEach(() => { state.denied.clear(); state.logout.mockClear(); localStorage.clear(); });
afterEach(cleanup);
function open(path = '/users', directoryLayout = false) {
  const config = roleNavMap.apprentice;
  return render(<MemoryRouter initialEntries={[path]}><EnrolmentWorkspaceShell role="compliance" roleLabel={config.label}
    navItems={config.items} workspaceLabel="Enrolment" pageTitle="Users" directoryLayout={directoryLayout}><p>Existing page content</p></EnrolmentWorkspaceShell></MemoryRouter>);
}

describe('Enrollment navigation presentation', () => {
  it('keeps drawer navigation expanded without clearing the saved sidebar preference', () => {
    localStorage.setItem('kbc_enrolment_sidebar_collapsed', 'true');
    const { container } = open('/users', true);
    expect(container.querySelector('[data-collapsed]')).toHaveAttribute('data-collapsed', 'false');
    expect(localStorage.getItem('kbc_enrolment_sidebar_collapsed')).toBe('true');
    const menu = screen.getByRole('button', { name: 'Open menu' });
    menu.focus();
    fireEvent.click(menu);
    expect(screen.getByRole('dialog', { name: 'Enrolment navigation' })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('button', { name: 'Open menu' })).toHaveFocus();
  });

  it('keeps the permitted destinations and highlights the most specific route', () => {
    open('/users/coach-directory');
    const navigation = screen.getByRole('navigation', { name: /primary navigation/ });
    expect(within(navigation).getAllByRole('link').map(link => link.getAttribute('href')))
      .toEqual(['/users', '/users/first-sessions', '/users/coach-directory', '/users/progress-transfers', '/users/my-courses']);
    expect(within(navigation).getByRole('link', { name: 'Coach directory' })).toHaveAttribute('aria-current', 'page');
    expect(within(navigation).getByRole('link', { name: 'Users' })).not.toHaveAttribute('aria-current');
    expect(screen.getByText('Existing page content')).toBeInTheDocument();
  });

  it('does not expose a navigation item denied by the existing permission check', () => {
    state.denied.add('enrolment-progress-transfers');
    state.denied.add('enrolment-courses');
    open();
    expect(screen.queryByRole('link', { name: 'Transfer Progress' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'My Courses' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Coach directory' })).toBeInTheDocument();
  });

  it.each([
    ['/users', true], ['/users/first-sessions', false], ['/users/coach-directory', false], ['/users/progress-transfers', false],
    ['/users/my-courses', true],
  ] as const)('pins the expanded sidebar on %s even with a saved collapsed preference', (path, directoryLayout) => {
    localStorage.setItem('kbc_sidebar_pinned', 'true');
    localStorage.setItem('kbc_learner_sidebar_collapsed', 'false');
    localStorage.setItem('kbc_enrolment_sidebar_collapsed', 'true');
    const { container } = open(path, directoryLayout);
    expect(container.querySelector('[data-collapsed]')).toHaveAttribute('data-collapsed', 'false');
    expect(container.querySelector('[data-collapsed]')).toHaveStyle({ '--enrolment-sidebar-width': '16.5rem' });
    expect(screen.queryByRole('button', { name: /Collapse sidebar|Expand sidebar/ })).not.toBeInTheDocument();
    expect(localStorage.getItem('kbc_enrolment_sidebar_collapsed')).toBe('true');
    expect(localStorage.getItem('kbc_sidebar_pinned')).toBe('true');
    expect(localStorage.getItem('kbc_learner_sidebar_collapsed')).toBe('false');
  });

  it('releases the mobile focus trap when resizing to the pinned desktop layout', () => {
    open('/users', true);
    const menu = screen.getByRole('button', { name: 'Open menu' });
    menu.focus(); fireEvent.click(menu);
    expect(screen.getByRole('dialog', { name: 'Enrolment navigation' })).toBeInTheDocument();
    fireEvent(window, new Event('resize'));
    expect(screen.queryByRole('dialog', { name: 'Enrolment navigation' })).not.toBeInTheDocument();
    expect(document.body.style.overflow).toBe('');
    expect(screen.getByRole('main')).not.toHaveAttribute('inert');
  });

  it('closes mobile navigation with Escape and restores the menu focus and body scrolling', () => {
    open();
    const menu = screen.getByRole('button', { name: 'Open menu' });
    menu.focus(); fireEvent.click(menu);
    expect(screen.getByRole('dialog', { name: 'Enrolment navigation' })).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('button', { name: 'Close navigation' })).toHaveFocus();
    expect(document.body.style.overflow).toBe('hidden');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Enrolment navigation' })).not.toBeInTheDocument();
    expect(menu).toHaveFocus(); expect(document.body.style.overflow).toBe('');
  });

  it('retains the existing global-search action', () => {
    open(); fireEvent.click(screen.getByRole('button', { name: 'Search workspace' }));
    expect(screen.getByRole('dialog', { name: 'Global search' })).toBeInTheDocument();
  });

  it('keeps sign-out confirmation before calling the existing logout action', () => {
    open(); fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(screen.getByRole('alertdialog', { name: 'Confirm sign out' })).toBeInTheDocument();
    expect(state.logout).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel sign out' }));
    expect(state.logout).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm sign out' }));
    expect(state.logout).toHaveBeenCalledTimes(1);
  });
});
