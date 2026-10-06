import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { Header } from './Header';

const state = vi.hoisted(() => ({
  account: { subjectType: 'learner', subjectId: 125 } as { subjectType: string; subjectId: number } | null,
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    auth: {
      user: { fullName: 'Aya Aya Test', email: 'aya@example.test' },
      account: state.account,
      roles: [{ name: 'Apprentice learner' }],
    },
    logout: vi.fn(),
  }),
}));
vi.mock('@/hooks/useTheme', () => ({ useTheme: () => ({ theme: 'light', toggle: vi.fn() }) }));
vi.mock('./WorkspaceSwitcher', () => ({ WorkspaceSwitcher: () => null }));
vi.mock('@/features/old-otjh/PreviousRecordMenuItem', () => ({ PreviousRecordMenuItem: () => null }));

function CurrentPath() {
  const location = useLocation();
  return <output data-testid="path">{location.pathname}</output>;
}

function showHeader(role: string) {
  render(<MemoryRouter initialEntries={['/learner/my-learning']}>
    <Header role={role} workspaceLabel="Learner" pageTitle="My Learning" onOpenSearch={() => {}} />
    <CurrentPath />
  </MemoryRouter>);
}

describe('learner account menu', () => {
  beforeEach(() => { state.account = { subjectType: 'learner', subjectId: 125 }; });

  it('shows the signed-in name and opens the available learner profile', async () => {
    showHeader('learner');
    const button = screen.getByRole('button', { name: 'Account menu' });
    expect(button.querySelector('.kbc-topbar-user-name')).toHaveTextContent('Aya Aya Test');

    await userEvent.click(button);
    const profile = within(screen.getByRole('menu')).getByRole('menuitem', { name: 'My Profile' });
    expect(profile).toHaveAttribute('href', '/learner/profile');
    await userEvent.click(profile);
    expect(screen.getByTestId('path')).toHaveTextContent('/learner/profile');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('hides My Profile when the account has no learner record', async () => {
    state.account = null;
    showHeader('learner');
    await userEvent.click(screen.getByRole('button', { name: 'Account menu' }));
    expect(within(screen.getByRole('menu')).queryByRole('menuitem', { name: 'My Profile' })).not.toBeInTheDocument();
  });

  it('keeps the existing account label outside the learner workspace', async () => {
    showHeader('staff');
    const button = screen.getByRole('button', { name: 'Account menu' });
    expect(button.querySelector('.kbc-topbar-user-name')).toHaveTextContent('Learner');
    await userEvent.click(button);
    expect(within(screen.getByRole('menu')).queryByRole('menuitem', { name: 'My Profile' })).not.toBeInTheDocument();
  });
});
