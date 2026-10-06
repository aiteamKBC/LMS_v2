import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import KnowledgeBasePage from '../page';
import * as api from '@/features/knowledge-base/api';
import type { KbBook } from '@/features/knowledge-base/api';

vi.mock('@/components/feature/WorkspaceShell', () => ({ WorkspaceShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main> }));
vi.mock('@/hooks/useToast', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock('@/features/knowledge-base/api', async importOriginal => ({
  ...await importOriginal<typeof import('@/features/knowledge-base/api')>(),
  fetchScopes: vi.fn(),
  fetchBooks: vi.fn(),
  fetchWorkerStatus: vi.fn(),
  fetchBook: vi.fn(),
  retryBuild: vi.fn(),
  acceptBuild: vi.fn(),
  uploadBook: vi.fn(),
}));

function book(overrides: Partial<KbBook> & { status?: string } = {}): KbBook {
  const { status = 'ready', ...rest } = overrides;
  return {
    id: 'b1', title: 'Marketing Strategy & Planning', scopes: ['ME', 'MM'], archived: false, createdAt: '2026-09-26', live: status === 'ready',
    version: { id: 'v1', fileName: 'msp.pdf', sizeBytes: 5 * 1024 * 1024, pageCount: 293, edition: '' },
    build: { id: 'build-1', status: status === 'ready' ? 'active' : status, completeness: {} },
    processing: { status, stage: '', progress: {}, attempts: 1, lastError: '' },
    ...rest,
  };
}

describe('Knowledge Base page', () => {
  beforeEach(() => {
    vi.mocked(api.fetchScopes).mockResolvedValue([
      { code: 'ME', name: 'Marketing Executive' }, { code: 'MM', name: 'Marketing Manager' },
      { code: 'PCP', name: 'Project Controls Professional' }, { code: 'APM', name: 'Associate Project Manager' },
    ]);
    vi.mocked(api.fetchWorkerStatus).mockResolvedValue({ online: true, lastSeenAt: null });
  });

  it('lists books with their programmes, pages and status', async () => {
    vi.mocked(api.fetchBooks).mockResolvedValue([book()]);
    render(<KnowledgeBasePage />);
    expect(await screen.findByText('Marketing Strategy & Planning')).toBeInTheDocument();
    expect(screen.getByText('293')).toBeInTheDocument();
    expect(screen.getAllByText('Ready').length).toBeGreaterThan(0);
    expect(screen.getAllByText('MM').length).toBeGreaterThan(0);
  });

  it('offers Retry and Accept with gaps only for a book that needs review', async () => {
    vi.mocked(api.fetchBooks).mockResolvedValue([book({ status: 'needs_review' })]);
    vi.mocked(api.acceptBuild).mockResolvedValue({ active: true });
    render(<KnowledgeBasePage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Accept with gaps' }));
    await waitFor(() => expect(api.acceptBuild).toHaveBeenCalledWith('build-1'));
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('shows no actions other than Details for a ready book', async () => {
    vi.mocked(api.fetchBooks).mockResolvedValue([book()]);
    render(<KnowledgeBasePage />);
    await screen.findByText('Marketing Strategy & Planning');
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Accept with gaps' })).not.toBeInTheDocument();
  });

  it('warns when books are queued but the worker is not running', async () => {
    vi.mocked(api.fetchBooks).mockResolvedValue([book({ status: 'queued' })]);
    vi.mocked(api.fetchWorkerStatus).mockResolvedValue({ online: false, lastSeenAt: null });
    render(<KnowledgeBasePage />);
    expect(await screen.findByText(/background worker is not running/)).toBeInTheDocument();
  });

  it('refuses to upload without a programme', async () => {
    vi.mocked(api.fetchBooks).mockResolvedValue([]);
    render(<KnowledgeBasePage />);
    fireEvent.click(await screen.findByRole('button', { name: /Upload book/ }));
    const input = document.getElementById('kb-file') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['%PDF-1.7'], 'book.pdf', { type: 'application/pdf' })] } });
    fireEvent.click(screen.getByRole('button', { name: 'Upload' }));
    expect(await screen.findByText('Choose at least one programme.')).toBeInTheDocument();
    expect(api.uploadBook).not.toHaveBeenCalled();
  });

  it('uploads with the selected programmes', async () => {
    vi.mocked(api.fetchBooks).mockResolvedValue([]);
    vi.mocked(api.uploadBook).mockResolvedValue({ duplicate: false, book_id: 'b9' });
    render(<KnowledgeBasePage />);
    fireEvent.click(await screen.findByRole('button', { name: /Upload book/ }));
    const input = document.getElementById('kb-file') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['%PDF-1.7'], 'msp.pdf', { type: 'application/pdf' })] } });
    fireEvent.click(await screen.findByRole('button', { name: /ME · Marketing Executive/ }));
    fireEvent.click(screen.getByRole('button', { name: /MM · Marketing Manager/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Upload' }));
    await waitFor(() => expect(api.uploadBook).toHaveBeenCalled());
    expect(vi.mocked(api.uploadBook).mock.calls[0][0]).toMatchObject({ title: 'msp', scopes: ['ME', 'MM'] });
  });
});
