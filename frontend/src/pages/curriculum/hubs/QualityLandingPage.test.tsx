import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { useCurriculumData } from '@/hooks/useCurriculumData';
import { useCurriculumProgrammes } from '@/hooks/useCurriculumProgrammes';
import { fetchCurriculumVersions, type CurriculumVersionIndex } from '@/lib/curriculumApi';
import { QualityLandingPage } from './QualityLandingPage';

vi.mock('@/components/feature/WorkspaceShell', () => ({ WorkspaceShell: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock('@/hooks/useCurriculumData', () => ({ useCurriculumData: vi.fn() }));
vi.mock('@/hooks/useCurriculumProgrammes', () => ({ useCurriculumProgrammes: vi.fn() }));
vi.mock('@/hooks/useRefreshOnReturn', () => ({ useLiveRefresh: vi.fn() }));
vi.mock('@/lib/curriculumApi', () => ({ fetchCurriculumVersions: vi.fn() }));

const overview = { data: { modules: [
  { id: 'ROW1', moduleCatalogueId: 'CAT/1', name: 'Recorded module', programme: 'Programme A', cohort: 'Autumn', group: 'G1', ksbCount: 0, status: 'draft', tutor: 'TBC' },
  { id: 'ROW2', moduleCatalogueId: 'CAT/1', name: 'Recorded module', programme: 'Programme A', cohort: 'Winter', group: 'G2', ksbCount: 0, status: 'PUBLISHED', tutor: 'Recorded tutor' },
], groups: [{ id: 'G1', coach: 'Unassigned' }] }, loading: false, error: null, reload: vi.fn(async () => null) } as unknown as ReturnType<typeof useCurriculumData>;
const programmes = { programmes: [
  { id: 'internal1', sourceId: 'P/1', name: 'Programme A', ksbTotal: 0, ksbProfileSourceId: '' },
  { id: 'P2', name: 'Programme B', ksbTotal: 0, ksbProfileSourceId: 'profile:KSB1' },
], loading: false, error: null, reload: vi.fn(async () => []) } as unknown as ReturnType<typeof useCurriculumProgrammes>;
const versionIndex: CurriculumVersionIndex = { available: true, count: 0, totalRevisions: 0, totalNamedVersions: 0, entities: [], generatedAt: '2026-01-01T00:00:00Z' };
const show = () => render(<MemoryRouter initialEntries={['/curriculum/quality?programme=previous-selection']}><QualityLandingPage /></MemoryRouter>);
const check = (name: string) => screen.getByText(name, { selector: 'strong' }).closest('details')!;
const stat = (name: string) => screen.getByText(name, { selector: 'dt' }).nextElementSibling;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useCurriculumData).mockReturnValue(overview);
  vi.mocked(useCurriculumProgrammes).mockReturnValue(programmes);
  vi.mocked(fetchCurriculumVersions).mockResolvedValue(versionIndex);
});

describe('Curriculum Quality landing', () => {
  it('preserves the original four-part open-check sum separately from the three attention categories and unpublished module rows', async () => {
    show();
    await screen.findByRole('link', { name: 'Open Version Control workspace' });
    expect(useCurriculumData).toHaveBeenCalledWith({ compact: true });
    expect(stat('Programmes checked')).toHaveTextContent('2');
    expect(stat('Modules checked')).toHaveTextContent('2');
    expect(stat('Open checks')).toHaveTextContent('5'); // source + 2 mappings + tutor + coach; draft is separate.
    expect(screen.getByText('3 of 3 categories need work')).toBeInTheDocument();
    expect(screen.getByText('1 unpublished module rows')).toBeInTheDocument();
    expect(check('Modules without KSB mappings').querySelector('summary')).toHaveTextContent('2');
    expect(check('Modules not yet published').querySelector('summary')).toHaveTextContent('1');
    expect(screen.getByText('Open issues: unavailable')).toBeInTheDocument();
    expect(screen.getByText('Last check time unavailable')).toBeInTheDocument();
    expect(screen.queryByText(/2026-01-01/)).not.toBeInTheDocument(); // History generation is not a quality check timestamp.
  });

  it('opens the exact affected programme and canonical module and retains delivery context for duplicate module placements', async () => {
    show();
    await screen.findByRole('link', { name: 'Open Version Control workspace' });
    await userEvent.click(within(check('Programmes without a KSB source')).getByText('Programmes without a KSB source'));
    expect(within(check('Programmes without a KSB source')).getByRole('link', { name: 'Programme A' })).toHaveAttribute('href', '/curriculum/programmes/P%2F1?tab=quality');
    await userEvent.click(within(check('Modules without KSB mappings')).getByText('Modules without KSB mappings'));
    const mapping = within(check('Modules without KSB mappings'));
    expect(mapping.getAllByRole('link', { name: 'Recorded module' })).toHaveLength(2);
    for (const link of mapping.getAllByRole('link', { name: 'Recorded module' })) expect(link).toHaveAttribute('href', '/curriculum/module-builder?module=CAT%2F1');
    expect(mapping.getByText('Programme A · Autumn · G1')).toBeInTheDocument();
    expect(mapping.getByText('Programme A · Winter · G2')).toBeInTheDocument();
  });

  it('uses only the explicitly selected programme for coverage and programme quality links', async () => {
    show();
    await screen.findByRole('link', { name: 'Open Version Control workspace' });
    const picker = screen.getByRole('combobox', { name: 'Quality programme' });
    expect(picker).toHaveValue('');
    expect(screen.getByRole('link', { name: 'Open KSB Coverage workspace' })).toHaveAttribute('href', '/curriculum/ksb-mapping');
    await userEvent.selectOptions(picker, 'P/1');
    expect(screen.getByRole('link', { name: 'Open KSB Coverage workspace' })).toHaveAttribute('href', '/curriculum/ksb-mapping?programme=P%2F1');
    expect(screen.getByRole('link', { name: 'Programme quality' })).toHaveAttribute('href', '/curriculum/programmes/P%2F1?tab=quality');
    await userEvent.selectOptions(picker, 'P2');
    expect(screen.getByRole('link', { name: 'Open KSB Coverage workspace' })).toHaveAttribute('href', '/curriculum/ksb-mapping?programme=P2');
  });

  it('keeps implemented workspaces enabled and probes version availability with a bounded read', async () => {
    show();
    await screen.findByRole('link', { name: 'Open Version Control workspace' });
    expect(fetchCurriculumVersions).toHaveBeenCalledWith({ limit: 1, signal: expect.any(AbortSignal), skipCache: false });
    for (const [name, href] of [['Published Content', '/curriculum/published'], ['Curriculum Reports', '/curriculum/reports'], ['Version Control', '/curriculum/version-control']]) {
      expect(screen.getByRole('link', { name: `Open ${name} workspace` })).toHaveAttribute('href', href);
    }
    expect(screen.getByRole('link', { name: 'Audit Trail' })).toHaveAttribute('href', '/curriculum/audit-trail');
    expect(screen.queryByText('Coming soon')).not.toBeInTheDocument();
  });

  it('disables unavailable history and retries failed availability without presenting a dead link', async () => {
    vi.mocked(fetchCurriculumVersions).mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce({ ...versionIndex, available: false });
    show();
    await screen.findByText(/Could not check version history/);
    expect(screen.queryByRole('link', { name: 'Open Version Control workspace' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry availability' }));
    await screen.findByText('Version history is not available in this workspace.');
    expect(within(screen.getByRole('region', { name: 'Version Control' })).getByRole('button', { name: 'Unavailable' })).toBeDisabled();
    expect(fetchCurriculumVersions).toHaveBeenLastCalledWith({ limit: 1, signal: expect.any(AbortSignal), skipCache: true });
  });

  it('runs existing read refreshes, prevents overlapping manual checks and never invents a successful-check time', async () => {
    let finish!: () => void;
    vi.mocked(useCurriculumData).mockReturnValue({ ...overview, reload: vi.fn(() => new Promise<null>(resolve => { finish = () => resolve(null); })) });
    show();
    await screen.findByRole('link', { name: 'Open Version Control workspace' });
    await userEvent.click(screen.getByRole('button', { name: 'Run quality check' }));
    expect(screen.getByRole('button', { name: 'Checking…' })).toBeDisabled();
    expect(screen.getByText(/Refreshing quality results/)).toHaveAttribute('role', 'status');
    expect(programmes.reload).toHaveBeenCalledWith({ revalidate: true });
    expect(fetchCurriculumVersions).toHaveBeenLastCalledWith({ limit: 1, signal: expect.any(AbortSignal), skipCache: true });
    await act(async () => finish());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Run quality check' })).toBeEnabled());
    expect(screen.getByText('Last check time unavailable')).toBeInTheDocument();
  });

  it('shows verified zero and clear only after successful reads, including a genuinely empty workspace', async () => {
    vi.mocked(useCurriculumData).mockReturnValue({ ...overview, data: { ...overview.data!, modules: [], groups: [] } });
    vi.mocked(useCurriculumProgrammes).mockReturnValue({ ...programmes, programmes: [] });
    show();
    await screen.findByRole('link', { name: 'Open Version Control workspace' });
    expect(stat('Programmes checked')).toHaveTextContent('0');
    expect(stat('Modules checked')).toHaveTextContent('0');
    expect(stat('Open checks')).toHaveTextContent('0');
    expect(screen.getAllByText('Clear', { exact: true })).toHaveLength(3);
    expect(screen.getByText('0 of 3 categories need work')).toBeInTheDocument();
  });

  it('does not turn stale overview data after a failed request into successful checks', async () => {
    vi.mocked(useCurriculumData).mockReturnValue({ ...overview, error: 'Offline' });
    show();
    await screen.findByRole('link', { name: 'Open Version Control workspace' });
    expect(stat('Programmes checked')).toHaveTextContent('2');
    expect(stat('Modules checked')).toHaveTextContent('Unavailable');
    expect(stat('Open checks')).toHaveTextContent('Unavailable');
    expect(check('Modules without KSB mappings').querySelector('summary')).toHaveTextContent('Unavailable');
    expect(screen.queryByText('Clear', { exact: true })).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Some quality results are unavailable');
  });

  it('treats missing result arrays as unavailable and keeps loading separate from zero', async () => {
    vi.mocked(useCurriculumData).mockReturnValue({ ...overview, data: null, loading: true });
    const view = show();
    expect(stat('Modules checked')).toHaveTextContent('Checking');
    expect(screen.getByRole('button', { name: 'Run quality check' })).toBeDisabled();
    expect(screen.queryByText('Clear', { exact: true })).not.toBeInTheDocument();
    vi.mocked(useCurriculumData).mockReturnValue({ ...overview, data: null, loading: false });
    view.rerender(<MemoryRouter><QualityLandingPage /></MemoryRouter>);
    await screen.findByRole('link', { name: 'Open Version Control workspace' });
    expect(stat('Modules checked')).toHaveTextContent('Unavailable');
    expect(stat('Open checks')).toHaveTextContent('Unavailable');
  });
});
