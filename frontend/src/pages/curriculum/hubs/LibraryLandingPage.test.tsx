import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchWeekTemplates, type WeekTemplate } from '../week-builder/weekTemplateData';
import { listMigratedTemplates, type TemplateLibrary } from '@/api/migratedReviewTemplates';
import { fetchBooks, type KbBook } from '@/features/knowledge-base/api';
import { useCurriculumData } from '@/hooks/useCurriculumData';
import { useCurriculumProgrammes } from '@/hooks/useCurriculumProgrammes';
import { LibraryLandingPage } from './LibraryLandingPage';

vi.mock('@/components/feature/WorkspaceShell', () => ({ WorkspaceShell: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@/hooks/useCurriculumData', () => ({ useCurriculumData: vi.fn() }));
vi.mock('@/hooks/useCurriculumProgrammes', () => ({ useCurriculumProgrammes: vi.fn() }));
vi.mock('@/hooks/useRefreshOnReturn', () => ({ useLiveRefresh: vi.fn() }));
vi.mock('../week-builder/weekTemplateData', () => ({ fetchWeekTemplates: vi.fn() }));
vi.mock('@/api/migratedReviewTemplates', () => ({ listMigratedTemplates: vi.fn(), FAMILY_LABELS: { MCM: 'MCM', PR: 'PR', PR_SKILLS_RADAR: 'PR + Skills Radar' } }));
vi.mock('@/features/knowledge-base/api', () => ({ fetchBooks: vi.fn() }));

const weeks = Array.from({ length: 8 }, (_, index) => ({
  id: `W/${index}`, title: `Week ${index}`, componentCount: index + 1, courseType: 'paid',
  programmeName: 'Actual programme', status: index === 0 ? 'review' : 'published',
  author: 'Recorded author', updatedAt: '2026-10-12T10:00:00Z',
})) as WeekTemplate[];
const reviews: TemplateLibrary = { can_manage: true, resolutions: [], templates: [{
  id: 17, scope: 'GLOBAL', programme_key: '', review_family: 'PR', name: 'Recorded review',
  is_active: false, updated_at: '2026-10-11T10:00:00Z', source_metadata: {}, fingerprint: 'f',
  statistics: { questions: 18, sections: 3 },
}] };
const books = [{ id: 'B1', title: 'Recorded book', scopes: ['ME'], createdAt: '2026-10-10T10:00:00Z',
  version: { pageCount: 42, edition: 'Second edition' }, processing: { status: 'ready' },
}] as KbBook[];
const overviewResult = { data: { modules: [{ ksbCount: 0, tutor: 'TBC' }, { ksbCount: 1, tutor: 'A tutor' }], groups: [{ coach: 'Unassigned' }] },
  loading: false, error: null, reload: vi.fn() } as unknown as ReturnType<typeof useCurriculumData>;
const programmesResult = { programmes: [{ id: 'P1', ksbTotal: 0 }, { id: 'P2', ksbTotal: 0, ksbProfileSourceId: 'source' }],
  loading: false, error: null, reload: vi.fn() } as unknown as ReturnType<typeof useCurriculumProgrammes>;
const show = () => render(<MemoryRouter initialEntries={['/curriculum/library?programme=previous-selection']}><LibraryLandingPage /></MemoryRouter>);
const card = (name: string) => within(screen.getByRole('region', { name }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useCurriculumData).mockReturnValue(overviewResult);
  vi.mocked(useCurriculumProgrammes).mockReturnValue(programmesResult);
  vi.mocked(fetchWeekTemplates).mockResolvedValue(weeks);
  vi.mocked(listMigratedTemplates).mockResolvedValue(reviews);
  vi.mocked(fetchBooks).mockResolvedValue(books);
});

describe('Curriculum Library landing', () => {
  it('binds independent metadata lists without leaking programme selection, retaining full totals for six previews', async () => {
    show();
    await screen.findByText('Recorded review');
    expect(fetchWeekTemplates).toHaveBeenCalledWith({}, expect.any(AbortSignal));
    expect(listMigratedTemplates).toHaveBeenCalledWith('', expect.any(AbortSignal));
    expect(fetchBooks).toHaveBeenCalledWith();
    expect(card('Week Templates').getByLabelText('Week Templates total: 8')).toHaveTextContent('8');
    expect(card('Week Templates').getAllByRole('listitem')).toHaveLength(6);
    expect(card('Week Templates').getByRole('link', { name: 'Week 0' })).toHaveAttribute('href', '/curriculum/week-builder?template=W%2F0');
    expect(card('Week Templates').getByText('In review')).toBeInTheDocument();
    expect(card('Week Templates').getByText(/1 components.*Actual programme/)).toBeInTheDocument();
    expect(card('Week Templates').getAllByText(/Recorded author/)).toHaveLength(6);
    expect(card('Review Templates').getByText(/PR · Standard template · 18 questions/)).toBeInTheDocument();
    expect(card('Review Templates').getByText('Inactive')).toBeInTheDocument();
    expect(card('Review Templates').queryByRole('link', { name: 'Recorded review' })).not.toBeInTheDocument();
    expect(card('Knowledge Base').getByText('42 pages · Second edition · Scopes: ME')).toBeInTheDocument();
    expect(card('Knowledge Base').getByText('Ready')).toBeInTheDocument();
    expect(card('Knowledge Base').queryByText('Published')).not.toBeInTheDocument();
    expect(card('KSB Standards').getByLabelText('KSB Standards total: Unavailable')).toHaveTextContent('—');
    expect(card('KSB Standards').getByText(/Preview and total unavailable/)).toBeInTheDocument();
  });

  it('preserves existing summary definitions rather than inventing sharing or reusable item counts', async () => {
    show();
    await screen.findByText('Recorded review');
    const summary = screen.getByRole('region', { name: 'Library summary' });
    const counts = Array.from(summary.querySelectorAll('dl > div')).map(item => [item.querySelector('dt')?.textContent, item.querySelector('dd')?.textContent]);
    expect(counts).toEqual([['Programmes', '2'], ['Reusable modules', '2'], ['Authoring issues', '4']]);
    expect(screen.getByText('2 programmes in this workspace')).toBeInTheDocument();
    expect(screen.queryByText(/Shared across/)).not.toBeInTheDocument();
  });

  it('keeps verified destinations and creation workflows, with review management gated by the API permission', async () => {
    show();
    await screen.findByText('Recorded review');
    for (const [name, href] of [['Week Templates', '/curriculum/week-builder'], ['Review Templates', '/curriculum/library/review-templates'], ['KSB Standards', '/curriculum/standards'], ['Knowledge Base', '/curriculum/knowledge-base']]) {
      expect(screen.getByRole('link', { name: `Open ${name} workspace` })).toHaveAttribute('href', href);
    }
    for (const [name, href] of [['Free Courses', '/curriculum/free-courses'], ['Quiz Workspace', '/curriculum/quiz-xml'], ['Question Bank', '/curriculum/question-bank']]) {
      expect(screen.getByRole('link', { name })).toHaveAttribute('href', href);
    }
    await userEvent.click(screen.getByText('New reusable content'));
    expect(screen.getByRole('link', { name: 'Review template' })).toHaveAttribute('href', '/curriculum/library/review-templates');
    expect(screen.getByRole('link', { name: 'Quiz' })).toHaveAttribute('href', '/curriculum/quiz-xml/manual');
    screen.getByText('New reusable content').focus();
    await userEvent.keyboard('{Escape}');
    expect(screen.getByText('New reusable content').closest('details')).not.toHaveAttribute('open');
  });

  it('does not offer review management without can_manage', async () => {
    vi.mocked(listMigratedTemplates).mockResolvedValue({ ...reviews, can_manage: false });
    show();
    await screen.findByText('Recorded review');
    await userEvent.click(screen.getByText('New reusable content'));
    expect(screen.queryByRole('link', { name: 'Review template' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Review Templates workspace' })).toBeInTheDocument();
  });

  it('distinguishes actual zero and empty metadata lists from unavailable standards', async () => {
    vi.mocked(fetchWeekTemplates).mockResolvedValue([]);
    vi.mocked(listMigratedTemplates).mockResolvedValue({ ...reviews, templates: [] });
    vi.mocked(fetchBooks).mockResolvedValue([]);
    show();
    await screen.findByText('No week templates available yet.');
    for (const title of ['Week Templates', 'Review Templates', 'Knowledge Base']) {
      expect(card(title).getByLabelText(`${title} total: 0`)).toHaveTextContent('0');
    }
    expect(card('KSB Standards').queryByText(/No ksb standards/)).not.toBeInTheDocument();
  });

  it('isolates a failed request, displays unavailable instead of zero, and retries only that collection', async () => {
    vi.mocked(fetchWeekTemplates).mockRejectedValueOnce(new Error('Unavailable')).mockResolvedValueOnce(weeks);
    show();
    await screen.findByText(/Unable to load week templates/);
    expect(card('Week Templates').getByLabelText('Week Templates total: Unavailable')).toHaveTextContent('—');
    expect(screen.getByText('Recorded review')).toBeInTheDocument();
    await userEvent.click(card('Week Templates').getByRole('button', { name: 'Try again' }));
    await screen.findByText('Week 0');
    expect(fetchWeekTemplates).toHaveBeenCalledTimes(2);
    expect(listMigratedTemplates).toHaveBeenCalledTimes(1);
    expect(fetchBooks).toHaveBeenCalledTimes(1);
  });

  it('shows loading without displaying zero, and ignores a late response after unmount', async () => {
    let resolve!: (value: WeekTemplate[]) => void;
    vi.mocked(fetchWeekTemplates).mockReturnValue(new Promise(done => { resolve = done; }));
    const view = show();
    expect(card('Week Templates').getByRole('status')).toHaveTextContent('Loading week templates');
    expect(card('Week Templates').getByLabelText('Week Templates total: Loading')).toHaveTextContent('—');
    await waitFor(() => expect(listMigratedTemplates).toHaveBeenCalled());
    const signal = vi.mocked(fetchWeekTemplates).mock.calls[0][1];
    view.unmount();
    expect(signal?.aborted).toBe(true);
    await act(async () => resolve(weeks));
  });

  it('marks dependent summary counts unavailable on an overview failure while retaining a valid programme count', async () => {
    vi.mocked(useCurriculumData).mockReturnValue({ ...overviewResult, error: 'Offline' });
    show();
    await screen.findByText('Recorded review');
    const summary = within(screen.getByRole('region', { name: 'Library summary' }));
    expect(summary.getAllByText('Unavailable')).toHaveLength(2);
    expect(summary.getByText('2')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry summary' }));
    expect(overviewResult.reload).toHaveBeenCalledTimes(1);
    expect(programmesResult.reload).toHaveBeenCalledTimes(1);
  });
});
