import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { SidebarNavItem } from '@/components/feature/Sidebar';
import type { EmployerDocuments } from '@/api/employerPortal';

const documents: EmployerDocuments = {
  employer: { id: '9', name: 'Test Employer' },
  outstandingTotal: 1,
  items: [
    { kind: 'review', eventKey: 'e1', reviewType: 'progress', label: 'Progress Review', scheduledDate: '2026-12-16',
      signable: true, completed: true, sectionsTotal: 3, employerSignatureRequired: true, signed: false,
      signedName: '', signedAt: null, learnerSigned: true, adminSigned: false,
      learner: { id: '101', kind: 'commercial', name: 'Aya Test', programme: 'Final Test' } },
    { kind: 'review', eventKey: 'e2', reviewType: 'progress', label: 'Health & Safety Review', scheduledDate: '2027-03-10',
      signable: false, completed: false, sectionsTotal: 3, employerSignatureRequired: true, signed: false,
      signedName: '', signedAt: null, learnerSigned: false, adminSigned: false,
      learner: { id: '101', kind: 'commercial', name: 'Aya Test', programme: 'Final Test' } },
    { kind: 'document', id: 'd1', docType: 'ilr', label: 'ILR Form', generatedAt: '2026-08-01T10:00:00Z',
      signable: true, signed: true, signedName: 'Test Employer', signedAt: '2026-08-02T10:00:00Z', parties: ['employer'],
      learner: { id: '102', kind: 'apprenticeship', name: 'Ben Test', programme: 'Data L4' } },
  ],
};

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ auth: { account: { role: 'employer', subjectId: 9, displayName: 'Test Employer' } } }) }));
vi.mock('@/hooks/useToast', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock('@/pages/users/wizard/steps/SignaturePad', () => ({ SignaturePad: () => <div>Signature pad</div> }));
vi.mock('@/pages/learner/reviews/LearnerReviewInstanceForm', () => ({ LearnerReviewInstanceForm: () => null }));
vi.mock('@/components/feature/WorkspaceShell', () => ({
  WorkspaceShell: ({ children, navItems, appearance }: { children: ReactNode; navItems: SidebarNavItem[]; appearance?: string }) => (
    <div data-testid="workspace" data-appearance={appearance}>
      <nav aria-label="Sidebar">{navItems.map(item => <a key={item.id} href={item.href}>{item.label}</a>)}</nav>
      {children}
    </div>
  ),
}));
vi.mock('@/api/employerPortal', async importOriginal => ({
  ...(await importOriginal<typeof import('@/api/employerPortal')>()),
  fetchEmployerDocuments: vi.fn(() => Promise.resolve(documents)),
}));

import EmployerDocumentsPage from './EmployerDocumentsPage';

function renderPage() {
  return render(<MemoryRouter initialEntries={['/employers/9/documents']}>
    <Routes><Route path="/employers/:employerId/documents" element={<EmployerDocumentsPage />} /></Routes>
  </MemoryRouter>);
}

// ui.tsx relies on the build's auto-imported AppIcon global.
beforeEach(() => { vi.stubGlobal('AppIcon', ({ className }: { className?: string }) => <i className={className} />); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('All documents', () => {
  it('uses the employer workspace menu and the learner look', async () => {
    renderPage();
    const sidebar = screen.getByRole('navigation', { name: 'Sidebar' });
    expect(within(sidebar).getAllByRole('link').map(link => [link.textContent, link.getAttribute('href')])).toEqual([
      ['My learners', '/employers/9'],
      ['All documents', '/employers/9/documents'],
    ]);
    expect(screen.getByTestId('workspace')).toHaveAttribute('data-appearance', 'learner');
    await screen.findByText('Progress Review');
  });

  it('lists every learner’s documents with whose they are, actionable first', async () => {
    renderPage();
    await screen.findByText('Progress Review');
    const list = screen.getByRole('region', { name: 'Documents' });
    const titles = within(list).getAllByText(/Review|ILR Form/).map(node => node.textContent);
    expect(titles.filter(title => ['Progress Review', 'Health & Safety Review', 'ILR Form'].includes(title || '')))
      .toEqual(['Progress Review', 'Health & Safety Review', 'ILR Form']);
    expect(within(list).getAllByRole('link', { name: 'Aya Test' })[0]).toHaveAttribute('href', '/employers/9/learner/commercial/101');
    expect(within(list).getByRole('link', { name: 'Ben Test' })).toHaveAttribute('href', '/employers/9/learner/apprenticeship/102');
  });

  it('filters by what the employer can do and searches by learner', async () => {
    renderPage();
    await screen.findByText('Progress Review');
    const filters = screen.getByRole('navigation', { name: 'Filter documents' });
    fireEvent.click(within(filters).getByRole('button', { name: /To sign/ }));
    expect(screen.getByText('Progress Review')).toBeInTheDocument();
    expect(screen.queryByText('Health & Safety Review')).not.toBeInTheDocument();
    expect(screen.queryByText('ILR Form')).not.toBeInTheDocument();

    fireEvent.click(within(filters).getByRole('button', { name: /All/ }));
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search documents' }), { target: { value: 'ben' } });
    expect(screen.getByText('ILR Form')).toBeInTheDocument();
    expect(screen.queryByText('Progress Review')).not.toBeInTheDocument();
  });

  it('signs in place with the shared dialog', async () => {
    renderPage();
    await screen.findByText('Progress Review');
    fireEvent.click(screen.getByRole('button', { name: 'Sign' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Sign as employer')).toBeInTheDocument();
    expect(within(dialog).getByText('Progress Review')).toBeInTheDocument();
  });
});
