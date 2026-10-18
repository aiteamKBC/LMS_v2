import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import EmployerPortalPage from './EmployerPortalPage';

const fetchEmployerPortal = vi.fn();

vi.mock('@/api/employerPortal', () => ({
  fetchEmployerPortal: (...args: unknown[]) => fetchEmployerPortal(...args),
}));
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ auth: { account: { role: 'employer', displayName: 'Test Employer' } } }),
}));
vi.mock('@/components/feature/WorkspaceShell', () => ({
  WorkspaceShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

function CurrentPath() {
  const location = useLocation();
  return <output data-testid="path">{location.pathname}</output>;
}

function showPage() {
  return render(
    <MemoryRouter initialEntries={['/employers/8']}>
      <Routes>
        <Route path="/employers/:employerId/*" element={<><EmployerPortalPage /><CurrentPath /></>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('employer portal design', () => {
  beforeEach(() => {
    fetchEmployerPortal.mockReset();
    fetchEmployerPortal.mockResolvedValue({
      employer: { id: '8', name: 'Test employer', email: 'employer@example.test', employerGroupNames: ['Test org'] },
      outstandingTotal: 2,
      learners: [
        { id: '11', kind: 'apprenticeship', name: 'Aya Khater', email: 'aya@example.test', programme: 'Final Test', cohort: 'Final Cohort', programmeStatus: 'Active', onboardingStatus: '', isActive: true, outstandingCount: 0, documentsTotal: 2 },
        { id: '12', kind: 'apprenticeship', name: 'Ayman Learner', email: 'ayman@example.test', programme: 'Marketing', cohort: 'October 2026', programmeStatus: 'Onboarding', onboardingStatus: 'Onboarding', isActive: false, outstandingCount: 2, documentsTotal: 2 },
      ],
    });
  });

  it('shows the animated loading state while learners are being prepared', () => {
    fetchEmployerPortal.mockReturnValueOnce(new Promise(() => undefined));
    showPage();

    expect(screen.getByRole('status', { name: 'Loading learners' })).toBeVisible();
    expect(screen.getByTestId('learners-loading-spinner')).toHaveClass('animate-spin');
  });

  it('renders the supplied banner artwork and filters learner cards', async () => {
    const { container } = showPage();

    expect(await screen.findByRole('heading', { name: 'Test employer' })).toBeInTheDocument();
    expect(container.querySelector('img[src="/assets/employer/graduation-group.webp"]')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View Aya Khater' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View Ayman Learner' })).toBeInTheDocument();

    await userEvent.type(screen.getByRole('searchbox', { name: 'Search learners' }), 'Ayman');

    expect(screen.queryByRole('button', { name: 'View Aya Khater' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'View Ayman Learner' }));
    expect(screen.getByTestId('path')).toHaveTextContent('/employers/8/learner/apprenticeship/12');
  });
});
