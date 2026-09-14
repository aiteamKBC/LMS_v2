import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '@/hooks/useTheme';
import type { HomeEvent } from './homeData';
import { StudentHomeHeader } from './StudentHomeHeader';

const { logout } = vi.hoisted(() => ({ logout: vi.fn() }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ logout }) }));
const events: HomeEvent[] = [
  { id: 'lecture-1', kind: 'lecture', title: 'Leadership', date: '2026-09-18T09:00:00Z', detail: 'Learning session', href: '/learner/attendance' },
  { id: 'assignment-1', kind: 'assignment', title: 'Marketing assignment', date: '2026-09-20', detail: 'Assignment due', href: '/learner/monthly-submission' },
];
function Location() { const location = useLocation(); return <output data-testid="destination">{location.pathname}{location.search}</output>; }
function view(overrides: Partial<Parameters<typeof StudentHomeHeader>[0]> = {}) {
  return <MemoryRouter initialEntries={['/workspace/learner']}><ThemeProvider>
    <StudentHomeHeader name="Ayman Ahmed" homeHref="/workspace/learner"
      identity="account-3:apprenticeship:71" events={[]} loading={false} error={false} onRetry={vi.fn()} {...overrides}/><Location/>
  </ThemeProvider></MemoryRouter>;
}
beforeEach(() => { localStorage.clear(); });
afterEach(() => { cleanup(); vi.clearAllMocks(); localStorage.clear(); });

describe('student home header', () => {
  it('shows the college logo and learner identity with only the requested account controls', () => {
    render(view());
    const header = within(screen.getByRole('banner'));
    expect(header.getByText('Kent Business College')).toBeVisible();
    expect(header.getByText('Learner Portal')).toBeVisible();
    expect(header.getByRole('img', { name: 'Kent Business College logo' })).toBeVisible();
    expect(header.getByRole('button', { name: 'Ayman Ahmed, account menu' })).toHaveAttribute('aria-expanded', 'false');
    expect(header.getByRole('button', { name: 'Notifications' })).toBeVisible();
    expect(header.queryByRole('search')).not.toBeInTheDocument();
    expect(header.queryByRole('link', { name: 'Dashboard' })).not.toBeInTheDocument();
  });

  it('opens My Profile from the account menu', () => {
    render(view());
    fireEvent.click(screen.getByRole('button', { name: 'Ayman Ahmed, account menu' }));
    const menu = within(screen.getByRole('menu', { name: 'Account' }));
    expect(menu.getAllByRole('menuitem').map(item => item.textContent)).toEqual(['My Profile', 'Settings', 'Sign out']);
    fireEvent.click(menu.getByRole('menuitem', { name: 'My Profile' }));
    expect(screen.getByTestId('destination')).toHaveTextContent('/learner/profile');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('supports menu keyboard navigation, Escape and dismissal outside the menu', () => {
    render(view());
    const trigger = screen.getByRole('button', { name: 'Ayman Ahmed, account menu' });
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    expect(screen.getByRole('menuitem', { name: 'My Profile' })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' });
    expect(screen.getByRole('menuitem', { name: 'Settings' })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    fireEvent.click(trigger);
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('opens functional settings and returns focus to the profile trigger when closed', () => {
    render(view());
    const trigger = screen.getByRole('button', { name: 'Ayman Ahmed, account menu' });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Settings' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Settings' }));
    fireEvent.change(dialog.getByRole('combobox', { name: 'Learning workspace appearance' }), { target: { value: 'dark' } });
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    expect(localStorage.getItem('theme')).toBe('dark');
    expect(dialog.getByRole('link', { name: 'Reset your password' })).toHaveAttribute('href', '/forgot-password');
    fireEvent.click(dialog.getByRole('button', { name: 'Close' }));
    expect(trigger).toHaveFocus();
  });

  it('signs out through the existing authentication flow', () => {
    render(view());
    fireEvent.click(screen.getByRole('button', { name: 'Ayman Ahmed, account menu' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Sign out' }));
    expect(logout).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('shows actual reminders, marks them read, and keeps read state scoped to the account and learner', () => {
    const first = render(view({ events }));
    fireEvent.click(screen.getByRole('button', { name: 'Notifications, 2 new' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Notifications' }));
    expect(dialog.getByRole('link', { name: /Leadership/ })).toHaveAttribute('href', '/learner/attendance');
    expect(dialog.getByRole('link', { name: /Marketing assignment/ })).toHaveAttribute('href', '/learner/monthly-submission');
    expect(screen.getByRole('button', { name: 'Notifications' })).toBeVisible();
    first.unmount();
    const second = render(view({ events }));
    expect(screen.getByRole('button', { name: 'Notifications' })).toBeVisible();
    second.unmount();
    render(view({ events, identity: 'account-4:apprenticeship:72' }));
    expect(screen.getByRole('button', { name: 'Notifications, 2 new' })).toBeVisible();
  });

  it('flags a rescheduled reminder as new and marks reminders arriving in an open panel read', () => {
    const { rerender } = render(view({ events: [events[0]] }));
    fireEvent.click(screen.getByRole('button', { name: 'Notifications, 1 new' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }));
    const changed = { ...events[0], date: '2026-09-19T09:00:00Z' };
    rerender(view({ events: [changed] }));
    fireEvent.click(screen.getByRole('button', { name: 'Notifications, 1 new' }));
    rerender(view({ events: [changed, events[1]] }));
    expect(within(screen.getByRole('dialog')).getByText('Marketing assignment')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Notifications' })).toBeVisible();
  });

  it('does not show an unread badge for placeholders and offers retry on loading errors', () => {
    const retry = vi.fn();
    render(view({ events: [{ ...events[0], date: null }], error: true, onRetry: retry }));
    fireEvent.click(screen.getByRole('button', { name: 'Notifications' }));
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.queryByText(/all caught up/)).not.toBeInTheDocument();
    fireEvent.click(dialog.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it('opens learner help with working guide and coaching destinations', () => {
    render(view());
    fireEvent.click(screen.getByRole('button', { name: 'Help & Support' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Help & Support' }));
    expect(dialog.getByRole('link', { name: 'Open the learner guide' })).toHaveAttribute('href', '/user-guide');
    expect(dialog.getByRole('link', { name: 'Get learning support from your coach' })).toHaveAttribute('href', '/learner/monthly-coaching');
  });
});
