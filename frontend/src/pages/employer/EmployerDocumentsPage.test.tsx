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

const documentsApi = vi.hoisted(() => ({ fetchDocuments: vi.fn(), fetchReview: vi.fn() }));

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
  fetchEmployerDocuments: (...args: unknown[]) => documentsApi.fetchDocuments(...args),
  fetchEmployerReviewInstance: (...args: unknown[]) => documentsApi.fetchReview(...args),
}));

import EmployerDocumentsPage from './EmployerDocumentsPage';

function renderPage() {
  return render(<MemoryRouter initialEntries={['/employers/9/documents']}>
    <Routes><Route path="/employers/:employerId/documents" element={<EmployerDocumentsPage />} /></Routes>
  </MemoryRouter>);
}

// ui.tsx relies on the build's auto-imported AppIcon global.
beforeEach(() => {
  // jsdom has no native dialog implementation; the browser check covers native behavior.
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function (this: HTMLDialogElement) { this.open = false; } });
  documentsApi.fetchDocuments.mockReset();
  documentsApi.fetchReview.mockReset();
  documentsApi.fetchDocuments.mockResolvedValue(documents);
  vi.stubGlobal('AppIcon', ({ className }: { className?: string }) => <i className={className} />);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('All documents', () => {
  it('previews a review awaiting signature from its name without signing or downloading', async () => {
    documentsApi.fetchDocuments.mockResolvedValue({ ...documents, items: [
      { ...documents.items[0], reviewInstanceId: 'instance-1' },
    ] });
    documentsApi.fetchReview.mockResolvedValue({ pdf: { available: false, reason: 'Final PDF awaits the required signatures.' } });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Progress Review' }));
    const dialog = screen.getByRole('dialog');
    expect(await within(dialog).findByText('Final PDF awaits the required signatures.')).toBeVisible();
    expect(documentsApi.fetchReview).toHaveBeenCalledWith('9', 'commercial', '101', 'e1');
    expect(within(dialog).queryByRole('button', { name: 'Sign' })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('link', { name: 'Download' })).not.toBeInTheDocument();
  });
  it('shows the animated loading state while documents are being prepared', () => {
    documentsApi.fetchDocuments.mockReturnValueOnce(new Promise(() => undefined));
    renderPage();

    expect(screen.getByRole('status', { name: 'Loading documents' })).toBeVisible();
    expect(screen.getByTestId('documents-loading-spinner')).toHaveClass('animate-spin');
  });

  it('uses the employer workspace menu and the learner look', async () => {
    renderPage();
    const sidebar = screen.getByRole('navigation', { name: 'Sidebar' });
    expect(within(sidebar).getAllByRole('link').map(link => [link.textContent, link.getAttribute('href')])).toEqual([
      ['Home', '/employers/9'],
      ['My learners', '/employers/9/learners'],
      ['Progress reviews', '/employers/9/reviews'],
      ['Documents', '/employers/9/documents'],
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
      .toEqual(['Progress Review', 'ILR Form']);
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

  it('excludes unfinished reviews from the list, summary, filters and search', async () => {
    renderPage();
    await screen.findByText('Progress Review');
    expect(screen.queryByText('Health & Safety Review')).not.toBeInTheDocument();
    expect(screen.queryByText('Awaiting completion')).not.toBeInTheDocument();

    const summary = screen.getByRole('region', { name: 'Document summary' });
    for (const [label, count] of [['Awaiting your signature', '1'], ['Waiting on others', '0'], ['Signed', '1'], ['All documents', '2']]) {
      expect(within(summary).getByText(label).parentElement).toHaveTextContent(`${label}${count}`);
    }
    const filters = screen.getByRole('navigation', { name: 'Filter documents' });
    expect(within(filters).getByRole('button', { name: /^All/ })).toHaveTextContent('All2');
    expect(within(filters).getByRole('button', { name: /^Waiting on others/ })).toHaveTextContent('Waiting on others0');
    expect(screen.getByText(/Showing/)).toHaveTextContent('Showing 2 of 2 documents');

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search documents' }), { target: { value: 'Health & Safety' } });
    expect(screen.getByText('No documents match this filter.')).toBeVisible();
    expect(screen.getByText(/Showing/)).toHaveTextContent('Showing 0 of 2 documents');
    expect(documentsApi.fetchReview).not.toHaveBeenCalled();
  });

  it('shows an empty documents list when all reviews are awaiting completion', async () => {
    documentsApi.fetchDocuments.mockResolvedValue({ ...documents, outstandingTotal: 0, items: [documents.items[1]] });
    renderPage();
    expect(await screen.findByText('No documents yet. They appear here once the provider has prepared them for your learners.')).toBeVisible();
    expect(screen.getByText(/Showing/)).toHaveTextContent('Showing 0 of 0 documents');
    expect(screen.queryByRole('button', { name: 'Preview' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign' })).not.toBeInTheDocument();
  });

  it.each([
    ['2026-10-21', '21/10/2026'],
    ['', 'Date unavailable'],
  ])('shows the migrated review date (%s) without substituting its signature date', async (scheduledDate, expected) => {
    documentsApi.fetchDocuments.mockResolvedValue({
      ...documents,
      outstandingTotal: 0,
      items: [{ ...documents.items[0], label: 'Migrated Progress Review', migratedForm: true,
        scheduledDate, completed: false, signable: false, signed: true, signedAt: '2026-10-30T14:00:00Z' }],
    });
    renderPage();
    expect(await screen.findByText(expected)).toBeVisible();
    expect(screen.queryByText('30/10/2026')).not.toBeInTheDocument();
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
