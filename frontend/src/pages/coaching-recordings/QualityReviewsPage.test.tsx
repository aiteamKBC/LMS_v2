import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import QualityReviewsPage from './QualityReviewsPage';
import { qualityReviews, qualityForms, type QualitySummary } from '@/api/coachingQualityReviews';
vi.mock('@/components/feature/WorkspaceShell', () => ({ WorkspaceShell: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@/api/coachingQualityReviews', async () => ({ ...await vi.importActual<typeof import('@/api/coachingQualityReviews')>('@/api/coachingQualityReviews'), qualityReviews: vi.fn(), qualityForms: vi.fn() }));
vi.mock('./QualityReviewDialog', () => ({ default: ({ reviewId, onDirtyChange, onClose }: { reviewId: string; onDirtyChange: (dirty: boolean) => void; onClose: () => void }) => <div role="dialog">Saved form {reviewId}<button onClick={() => onDirtyChange(true)}>Edit saved form</button><button onClick={onClose}>Close saved form</button></div> }));
const uuid = (id: string) => `00000000-0000-4000-8000-${id.padStart(12, '0')}`;
const row = (id: string): QualitySummary => ({ id: uuid(id), coachEmail: 'coach@example.invalid', coachName: 'Synthetic Coach', learnerId: id, learnerName: `Learner ${id}`, startsAt: '2026-10-20T09:00:00Z',
  status: 'completed', version: 2, updatedAt: '2026-10-20T12:00:00Z', title: 'Synthetic MCM', actionCount: 1 });
const data = { reviews: [row('1')], coaches: [{ email: 'coach@example.invalid', name: 'Synthetic Coach' }], nextOffset: null };
describe('Saved quality reviews dashboard', () => {
  beforeEach(() => { vi.mocked(qualityForms).mockReset().mockResolvedValue({ forms: [] }); vi.mocked(qualityReviews).mockReset().mockResolvedValue(data); });
  function History() { const location = useLocation(), navigate = useNavigate(); return <><output aria-label="Current review URL">{location.search}</output><button onClick={() => navigate(-1)}>History back</button><button onClick={() => navigate(1)}>History forward</button></>; }
  const open = (url = '/') => render(<MemoryRouter initialEntries={[url]}><History /><QualityReviewsPage /></MemoryRouter>);
  it('loads summaries once and only applies filters on submit', async () => {
    open(); await screen.findByText('Learner 1');
    expect(qualityReviews).toHaveBeenCalledOnce();
    expect(vi.mocked(qualityReviews).mock.calls[0][0]).toMatchObject({ status: 'completed' });
    fireEvent.change(screen.getByRole('searchbox', { name: 'Learner or meeting' }), { target: { value: 'Learner' } });
    fireEvent.click(screen.getByRole('button', { name: 'More filters' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Review status' }), { target: { value: 'draft' } });
    expect(qualityReviews).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
    await waitFor(() => expect(qualityReviews).toHaveBeenCalledTimes(2));
    expect(vi.mocked(qualityReviews).mock.calls[1][0]).toMatchObject({ search: 'Learner', status: 'draft' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  it('loads another bounded page only on request and opens one saved form', async () => {
    vi.mocked(qualityReviews).mockResolvedValueOnce({ ...data, nextOffset: 30 }).mockResolvedValueOnce({ ...data, reviews: [row('2')] });
    open(); await screen.findByText('Learner 1');
    fireEvent.click(screen.getByRole('button', { name: 'Load more reviews' }));
    await screen.findByText('Learner 2');
    expect(vi.mocked(qualityReviews).mock.calls[1][1]).toBe(30);
    expect(screen.getByText('Learner 1')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: 'Open review for Learner 1' }));
    expect(await screen.findByRole('dialog')).toHaveTextContent('Saved form '+uuid('1'));
  });
  it('applies one-click type, completion and PDF filters and restores them in the URL', async () => {
    open(); await screen.findByText('Learner 1');
    fireEvent.change(screen.getByRole('combobox', { name: 'Quality form filter' }), { target: { value: 'PR' } });
    await waitFor(() => expect(qualityReviews).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole('button', { name: 'With PDF' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'With PDF' }));
    await waitFor(() => expect(qualityReviews).toHaveBeenCalledTimes(3));
    expect(vi.mocked(qualityReviews).mock.lastCall?.[0]).toMatchObject({ reviewType: 'PR', pdf: 'available', status: '' });
    expect(screen.getByLabelText('Current review URL')).toHaveTextContent('type=PR');
    expect(screen.getByLabelText('Current review URL')).toHaveTextContent('pdf=available');
    expect(screen.getByRole('link', { name: 'Edit quality forms' })).toHaveAttribute('href', '/curriculum/quality/forms?type=PR');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Drafts' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Drafts' }));
    await waitFor(() => expect(qualityReviews).toHaveBeenCalledTimes(4));
    expect(vi.mocked(qualityReviews).mock.lastCall?.[0]).toMatchObject({ reviewType: 'PR', pdf: '', status: 'draft' });
  });
  it('restores type and PDF filters on refresh and resets the search without loading PDF bytes', async () => {
    open('/?type=MCM&pdf=available&status=all&q=Somebody'); await screen.findByText('Learner 1');
    expect(vi.mocked(qualityReviews).mock.calls[0][0]).toMatchObject({ reviewType: 'MCM', pdf: 'available', status: '', search: 'Somebody' });
    expect(screen.getByRole('combobox', { name: 'Quality form filter' })).toHaveValue('MCM');
    fireEvent.click(screen.getByRole('button', { name: 'Reset filters' }));
    await waitFor(() => expect(qualityReviews).toHaveBeenCalledTimes(2));
    expect(vi.mocked(qualityReviews).mock.lastCall?.[0]).toMatchObject({ reviewType: '', pdf: '', coachEmail: '', search: '', status: '' });
  });
  it('keeps the entered search when a quick type choice applies it', async () => {
    open(); await screen.findByText('Learner 1');
    fireEvent.change(screen.getByRole('searchbox', { name: 'Learner or meeting' }), { target: { value: 'Typed learner' } });
    expect(qualityReviews).toHaveBeenCalledOnce();
    fireEvent.change(screen.getByRole('combobox', { name: 'Quality form filter' }), { target: { value: 'MCM' } });
    await waitFor(() => expect(qualityReviews).toHaveBeenCalledTimes(2));
    expect(vi.mocked(qualityReviews).mock.lastCall?.[0]).toMatchObject({ search: 'Typed learner', reviewType: 'MCM' });
  });
  it('opens hidden date filters with a useful error before sending an invalid range', async () => {
    open(); await screen.findByText('Learner 1');
    fireEvent.click(screen.getByRole('button', { name: 'More filters' }));
    fireEvent.change(screen.getByLabelText('From', { exact: true }), { target: { value: '2030-01-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Fewer filters' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
    expect(screen.getByRole('alert')).toHaveTextContent('To on or after From');
    expect(screen.getByLabelText('From', { exact: true })).toBeVisible();
    expect(qualityReviews).toHaveBeenCalledOnce();
  });
  it('shows a load error without claiming an empty successful review list', async () => {
    vi.mocked(qualityReviews).mockRejectedValue(new Error('Access denied'));
    open(); expect(await screen.findByRole('alert')).toHaveTextContent('Access denied');
    expect(screen.queryByText('No saved reviews match these filters')).not.toBeInTheDocument();
  });
  it('restores a direct review UUID and filters on refresh without extra list reads for history', async () => {
    open('/?from=2026-10-01&to=2026-10-24&status=draft&zone=America%2FNew_York&review='+uuid('2'));
    expect(await screen.findByRole('dialog')).toHaveTextContent(uuid('2'));
    await screen.findByText('Learner 1');
    expect(qualityReviews).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'More filters' }));
    expect(screen.getByRole('combobox', { name: 'Time zone' })).toHaveValue('America/New_York');
    expect(vi.mocked(qualityReviews).mock.calls[0][0]).toMatchObject({ start: '2026-10-01', end: '2026-10-24', status: 'draft' });
    fireEvent.click(screen.getByRole('button', { name: 'Close saved form' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'History back' }));
    expect(await screen.findByRole('dialog')).toHaveTextContent(uuid('2'));
    expect(qualityReviews).toHaveBeenCalledOnce();
  });
  it('protects an unsaved form when browser Back would close it', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    try {
      open(); await screen.findByText('Learner 1');
      fireEvent.click(screen.getByRole('link', { name: 'Open review for Learner 1' }));
      await screen.findByRole('dialog'); fireEvent.click(screen.getByRole('button', { name: 'Edit saved form' }));
      fireEvent.click(screen.getByRole('button', { name: 'History back' }));
      await waitFor(() => expect(confirm).toHaveBeenCalledOnce());
      expect(screen.getByRole('dialog')).toHaveTextContent(uuid('1'));
      expect(screen.getByLabelText('Current review URL')).toHaveTextContent('review='+uuid('1'));
      confirm.mockReturnValue(true);
      fireEvent.click(screen.getByRole('button', { name: 'History back' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(confirm).toHaveBeenCalledTimes(2);
    } finally { confirm.mockRestore(); }
  });
  it('rejects an invalid review locator without opening another review', async () => {
    open('/?review=wrong-identity');
    expect(await screen.findByRole('alert')).toHaveTextContent('review link is invalid');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close invalid review link' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });
  it('restarts pagination when history restores another filter without mixing its rows', async () => {
    vi.mocked(qualityReviews).mockImplementation(async (filters, offset) => ({ ...data,
      reviews: [row(filters.status === 'draft' ? '3' : offset ? '2' : '1')],
      nextOffset: filters.status === 'draft' || offset ? null : 30 }));
    open(); await screen.findByText('Learner 1');
    fireEvent.click(screen.getByRole('button', { name: 'Load more reviews' })); await screen.findByText('Learner 2');
    fireEvent.click(screen.getByRole('button', { name: 'More filters' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Review status' }), { target: { value: 'draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply filters' })); await screen.findByText('Learner 3');
    fireEvent.click(screen.getByRole('button', { name: 'History back' })); await screen.findByText('Learner 1');
    expect(screen.queryByText('Learner 3')).not.toBeInTheDocument();
    expect(screen.queryByText('Learner 2')).not.toBeInTheDocument();
    expect(vi.mocked(qualityReviews).mock.calls.at(-1)?.[1]).toBe(0);
    expect(qualityReviews).toHaveBeenCalledTimes(4);
  });
});
