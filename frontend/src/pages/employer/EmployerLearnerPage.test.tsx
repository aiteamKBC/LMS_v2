import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SidebarNavItem } from '@/components/feature/Sidebar';

const mocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
  fetchEmployerLearner: vi.fn(() => new Promise(() => undefined)),
}));

vi.mock('@/hooks/useAuth', () => ({ useAuth: mocks.useAuth }));
vi.mock('@/hooks/useToast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));
vi.mock('@/api/employerPortal', () => ({
  fetchEmployerLearner: mocks.fetchEmployerLearner,
  fetchEmployerLearnerPlan: vi.fn(),
  fetchEmployerReviewInstance: vi.fn(),
  signDocumentAsEmployer: vi.fn(),
  signAgreementAsEmployer: vi.fn(),
  signTrainingPlanAsEmployer: vi.fn(),
  signWrittenAgreementAsEmployer: vi.fn(),
  signReviewAsEmployer: vi.fn(),
}));
vi.mock('@/components/feature/WorkspaceShell', () => ({
  WorkspaceShell: ({
    role,
    roleLabel,
    navItems,
    userName,
    children,
  }: {
    role: string;
    roleLabel: string;
    navItems: SidebarNavItem[];
    userName: string;
    children: ReactNode;
  }) => {
    const allItems = navItems.flatMap((item) => [item, ...(item.children ?? [])]);
    const notifications = allItems.find((item) => item.id === 'employer-notifications');
    return (
      <div
        data-testid="workspace-shell"
        data-role={role}
        data-role-label={roleLabel}
        data-user-name={userName}
        data-notifications-href={notifications?.href ?? ''}
      >
        {children}
      </div>
    );
  },
}));

import EmployerLearnerPage from './EmployerLearnerPage';

function renderPage() {
  render(
    <MemoryRouter initialEntries={['/employers/7/learner/commercial/499']}>
      <Routes>
        <Route path="/employers/:employerId/learner/:kind/:learnerId" element={<EmployerLearnerPage />} />
      </Routes>
    </MemoryRouter>,
  );
  return screen.getByTestId('workspace-shell');
}

describe('EmployerLearnerPage workspace identity', () => {
  beforeEach(() => {
    mocks.fetchEmployerLearner.mockClear();
  });

  it('keeps an employer in the employer workspace with notifications available', () => {
    mocks.useAuth.mockReturnValue({
      auth: { account: { role: 'employer', displayName: 'Test Employer' } },
    });

    const shell = renderPage();

    expect(shell).toHaveAttribute('data-role', 'employer');
    expect(shell).toHaveAttribute('data-role-label', 'Employer');
    expect(shell).toHaveAttribute('data-user-name', 'Test Employer');
    expect(shell).toHaveAttribute('data-notifications-href', '/notifications');
  });

  it('preserves the enrolment workspace for staff viewing the same learner', () => {
    mocks.useAuth.mockReturnValue({
      auth: { account: { role: 'staff', accessNavRole: 'compliance' } },
    });

    const shell = renderPage();

    expect(shell).toHaveAttribute('data-role', 'compliance');
    expect(shell).toHaveAttribute('data-role-label', 'Enrolment Officer');
    expect(shell).toHaveAttribute('data-user-name', 'Enrolment Officer');
    expect(shell).toHaveAttribute('data-notifications-href', '');
  });
});
