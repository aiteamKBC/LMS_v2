import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { AccessWorkspace } from '@/api/auth';
import { Header } from './Header';

const state = vi.hoisted(() => ({ workspaces: [] as AccessWorkspace[] }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({
  auth: { isAuthenticated: true, account: { role: 'staff', access: 'coach', accessWorkspaces: state.workspaces }, roles: [] },
  isAdmin: false, logout: vi.fn(),
}) }));
vi.mock('@/hooks/useTheme', () => ({ useTheme: () => ({ theme: 'light', toggleTheme: vi.fn() }) }));
vi.mock('@/features/old-otjh/PreviousRecordMenuItem', () => ({ PreviousRecordMenuItem: () => null }));

function Path() { return <output data-testid="path">{useLocation().pathname}</output>; }
function show() {
  render(<MemoryRouter initialEntries={['/workspace/learner/commercial/512']}>
    <Header role="learner" personalLearning pageTitle="My Learning" onOpenSearch={() => {}} />
    <Path />
  </MemoryRouter>);
}

describe('workspace navigation from personal learning', () => {
  beforeEach(() => { state.workspaces = [{ access: 'coach', home: '/workspace/coach' }]; });

  it('lets a staff learner return to their granted coaching workspace', async () => {
    state.workspaces.push({ access: 'learner', home: '/workspace/learner/commercial/512' });
    show();
    await userEvent.click(screen.getByTitle('Switch workspace'));
    await userEvent.click(screen.getByRole('menuitem', { name: /Coach/ }));
    expect(screen.getByTestId('path')).toHaveTextContent('/workspace/coach');
  });

  it('keeps the switcher hidden when there is no second grant', () => {
    show();
    expect(screen.queryByTitle('Switch workspace')).not.toBeInTheDocument();
  });
});
