import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { CurriculumProgramme, CurriculumKsbSourceDefinitions } from '@/lib/curriculumApi';
import { fetchCurriculumKsbSets, fetchCurriculumKsbSetSummaries, fetchCurriculumKsbSourceDefinitions } from '@/lib/curriculumApi';

/**
 * A programme with no usable KSB source is unfinished work, not a programme with
 * a setting left at its default: nothing under it can map a KSB, its coverage
 * cannot be measured, and the KSB mapping page has nothing to show. So the gap
 * is reported on the page where programmes are made — a notice for the page, a
 * badge on the card, the panel saying what it costs — rather than discovered
 * later on an empty screen.
 *
 * There is exactly one empty KSB profile, shared. A programme with no real
 * standard yet can be parked on it; it is created the first time it is asked for
 * and reused after that — never one empty profile per programme.
 */

vi.mock('@/components/feature/WorkspaceShell', () => ({
  WorkspaceShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

// These tests exercise the browser's existing source tools. The embedded
// workspace has its own data-contract and selection tests.
vi.mock('@/pages/curriculum/programme-detail/page', () => ({ default: () => null }));

vi.mock('@/components/feature/CurriculumSweetAlert', () => ({
  showCurriculumAlert: vi.fn(async () => undefined),
  showCurriculumConfirm: vi.fn(async () => undefined),
  showCurriculumLoading: vi.fn(),
  closeCurriculumLoading: vi.fn(),
}));

const withSource = {
  id: 'PROG-MAPPED', sourceId: 'PROG-MAPPED', name: 'Data Analyst', level: 'LVL-4',
  ksbProfileSourceId: 'profile:KSB-1', ksbTotal: 10, ksbMapped: 3,
  cohorts: 1, groups: 1, modules: 1, weeks: 10, learners: 0,
} as unknown as CurriculumProgramme;

const withoutSource = {
  id: 'PROG-BARE', sourceId: 'PROG-BARE', name: 'Test-Zyad', level: 'LVL-6',
  ksbProfileSourceId: '', ksbTotal: 0, ksbMapped: 0,
  cohorts: 1, groups: 1, modules: 1, weeks: 10, learners: 0,
} as unknown as CurriculumProgramme;

let listedProgrammes: CurriculumProgramme[] = [withSource, withoutSource];

vi.mock('@/hooks/useCurriculumProgrammes', () => ({
  useCurriculumProgrammes: () => ({
    programmes: listedProgrammes,
    loading: false,
    error: null,
    reload: vi.fn(async () => null),
    upsertProgramme: vi.fn(),
    removeProgramme: vi.fn(),
    markProgrammeArchived: vi.fn(),
    markProgrammeRestored: vi.fn(),
  }),
}));

vi.mock('@/hooks/useCurriculumData', () => ({
  useCurriculumData: () => ({ data: null, loading: false, error: null, reload: vi.fn(async () => null) }),
}));

vi.mock('@/hooks/useCurriculumStaffProfiles', () => ({
  useCurriculumStaffProfiles: () => ({ tutors: [], coaches: [], loading: false, error: null, reload: vi.fn() }),
}));

const realProfile = {
  id: 'KSB-1', frameworkId: 'KSB-1', standard: 'Project Control Professional',
  standardSourceId: 'st0845-v1-1',
  programmeName: 'Project Control', knowledge: 31, skills: 29, behaviours: 11,
  ksbs: new Array(71).fill({ code: 'K1' }),
};

const linkedStandard = {
  id: 'st0845-v1-1', code: 'ST0845', standardRef: 'ST0845', version: '1.1',
  name: 'Project controls professional', level: 'Level 6', levelValue: '6',
  minimumHours: '348', maxFunding: '£27,000', duration: '18 months', larsCode: '128',
  knowledge: 31, skills: 29, behaviours: 11, total: 71, ksbs: [],
};

// The one shared placeholder. Not owned by a programme: several can be parked on
// it, and it is the same row in the KSB Frameworks list every time.
const sharedEmptyProfile = {
  id: 'KSBP-EMPTY', frameworkId: 'KSBP-EMPTY', standard: 'Empty KSB profile',
  programmeName: 'Empty KSB profile', knowledge: 0, skills: 0, behaviours: 0,
  ksbs: [] as unknown[],
};

let ksbSets: unknown[] = [realProfile];

const createCurriculumProgramme = vi.fn(async () => ({
  created: true,
  programme: { id: 'PROG-NEW', sourceId: 'PROG-NEW', name: 'Fresh Programme', ksbProfileSourceId: '' },
}));
// Creating the placeholder makes it visible to the next fetch, the way the
// backend does — the page then applies the profile it has just made.
const createCurriculumKsbFramework = vi.fn(async () => {
  ksbSets = [realProfile, sharedEmptyProfile];
  return { created: true, framework: { id: 'KSBP-EMPTY', name: 'Empty KSB profile' } };
});
const updateCurriculumKsbFramework = vi.fn(async () => ({ updated: true, id: 'KSBP-EMPTY' }));
const updateCurriculumProgramme = vi.fn(async () => ({ updated: true }));

vi.mock('@/lib/curriculumApi', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/curriculumApi')>()),
  createCurriculumProgramme: (...args: unknown[]) => createCurriculumProgramme(...(args as [])),
  createCurriculumKsbFramework: (...args: unknown[]) => createCurriculumKsbFramework(...(args as [])),
  updateCurriculumKsbFramework: (...args: unknown[]) => updateCurriculumKsbFramework(...(args as [])),
  updateCurriculumProgramme: (...args: unknown[]) => updateCurriculumProgramme(...(args as [])),
  fetchCurriculumKsbSets: vi.fn(async () => ksbSets),
  fetchCurriculumKsbSetSummaries: vi.fn(async () => ksbSets.map(value => {
    const { ksbs, ...metadata } = value as typeof realProfile;
    return { ...metadata, ksbCount: ksbs.length, knowledgeCount: ksbs.length, skillCount: 0, behaviourCount: 0 };
  })),
  fetchCurriculumKsbSourceDefinitions: vi.fn(async (id: string) => ksbSets.find(value => (value as typeof realProfile).frameworkId === id)),
  fetchCurriculumProgrammeKsbStats: vi.fn(async () => ({})),
  fetchCurriculumStandards: vi.fn(async () => [linkedStandard]),
  fetchCurriculumModules: vi.fn(async () => []),
  fetchCurriculumProgrammeKsbCoverage: vi.fn(async () => null),
  fetchCurriculumProgrammeLearnerKsbImpact: vi.fn(async () => null),
}));

async function renderProgrammes(initialEntry = '/') {
  const { default: Page } = await import('../page');
  return render(<MemoryRouter initialEntries={[initialEntry]}><Page /><LocationProbe /></MemoryRouter>);
}

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
}

function cardFor(name: string) {
  const card = Array.from(document.querySelectorAll('article')).find(element => element.getAttribute('aria-label') === `Open ${name}`)!;
  card.closest('details')!.open = true;
  return card;
}

describe('Programmes page — a programme with no usable KSB source', { timeout: 15000 }, () => {
  beforeEach(() => {
    listedProgrammes = [withSource, withoutSource];
    ksbSets = [realProfile];
    createCurriculumProgramme.mockClear();
    createCurriculumKsbFramework.mockClear();
    updateCurriculumKsbFramework.mockClear();
    updateCurriculumProgramme.mockClear();
    vi.mocked(fetchCurriculumKsbSets).mockClear();
    vi.mocked(fetchCurriculumKsbSetSummaries).mockClear();
    vi.mocked(fetchCurriculumKsbSourceDefinitions).mockClear();
  });

  it('exposes programmes beyond the former page limit and preserves selection while searching', async () => {
    listedProgrammes = Array.from({ length: 12 }, (_, index) => ({
      ...withSource, id: `PROG-${index}`, sourceId: `PROG-${index}`,
      name: `Catalogue ${String(index).padStart(2, '0')}`, status: 'active',
    }));
    listedProgrammes.push({ ...withoutSource, status: 'draft' });
    await renderProgrammes('/curriculum/programmes?q=Catalogue&page=2&keep=example');
    const browser = within(screen.getByRole('complementary', { name: 'Programme browser' }));
    const list = within(browser.getByRole('region', { name: 'Programme list' }));
    expect(list.getAllByRole('button', { name: /Catalogue.*learners/ })).toHaveLength(12);
    expect(browser.queryByRole('navigation', { name: 'Programme pages' })).not.toBeInTheDocument();
    expect(browser.queryByRole('button', { name: 'Next page' })).not.toBeInTheDocument();
    expect(browser.getByText('12 of 13 programmes')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/curriculum/programmes?q=Catalogue&keep=example'));
    await userEvent.click(list.getByRole('button', { name: /Catalogue 11.*learners/ }));
    expect(list.getByRole('button', { name: /Catalogue 11.*learners/ })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.clear(browser.getByPlaceholderText('Search by programme...'));
    await userEvent.type(browser.getByPlaceholderText('Search by programme...'), 'Catalogue 01');
    expect(list.getAllByRole('button', { name: /Catalogue.*learners/ })).toHaveLength(1);
    expect(list.getByRole('button', { name: /Catalogue 01.*learners/ })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(browser.getByRole('button', { name: 'Clear search' }));
    expect(list.getAllByRole('button', { name: /Catalogue.*learners/ })).toHaveLength(12);
    expect(list.getByRole('button', { name: /Catalogue 11.*learners/ })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(browser.getByRole('button', { name: 'Draft 1' }));
    expect(list.getByRole('button', { name: /Test-Zyad.*learners/ })).toBeInTheDocument();
  });

  it('opens Active by default and selects the first active programme even when a draft comes first', async () => {
    listedProgrammes = [{ ...withoutSource, status: 'draft' }, { ...withSource, status: 'active' }];
    await renderProgrammes();
    const browser = within(screen.getByRole('complementary', { name: 'Programme browser' }));
    expect(browser.getByRole('button', { name: 'Active 1' })).toHaveAttribute('aria-pressed', 'true');
    expect(browser.getByRole('button', { name: /active\s*Data Analyst\s*0 learners/ })).toHaveAttribute('aria-pressed', 'true');
    expect(browser.queryByRole('button', { name: /draft\s*Test-Zyad\s*0 learners/ })).not.toBeInTheDocument();
    await userEvent.click(browser.getByRole('button', { name: 'Draft 1' }));
    expect(browser.getByRole('button', { name: /draft\s*Test-Zyad\s*0 learners/ })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(browser.getByRole('button', { name: 'All 2' }));
    expect(browser.getByRole('button', { name: /active\s*Data Analyst\s*0 learners/ })).toBeInTheDocument();
    expect(browser.getByRole('button', { name: /draft\s*Test-Zyad\s*0 learners/ })).toBeInTheDocument();
  });

  it('keeps drafts accessible when no active programmes exist', async () => {
    listedProgrammes = [{ ...withoutSource, status: 'draft' }];
    await renderProgrammes();
    const browser = within(screen.getByRole('complementary', { name: 'Programme browser' }));
    expect(browser.getByRole('button', { name: 'Active 0' })).toHaveAttribute('aria-pressed', 'true');
    expect(browser.getByRole('heading', { name: 'No programmes match your filters' })).toBeInTheDocument();
    await userEvent.click(browser.getByRole('button', { name: 'Draft 1' }));
    expect(browser.getByRole('button', { name: /draft\s*Test-Zyad\s*0 learners/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('keeps the create-programme empty state when the default Active filter has no records', async () => {
    listedProgrammes = [];
    await renderProgrammes();
    expect(await screen.findByRole('heading', { name: 'No programmes created yet' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'No programmes match your filters' })).not.toBeInTheDocument();
  });

  it('loads source summaries on mount and definitions only when that source is opened', async () => {
    await renderProgrammes();
    const button = await screen.findByRole('button', { name: 'View KSBs for Project Control Professional' });
    expect(fetchCurriculumKsbSetSummaries).toHaveBeenCalledTimes(1);
    expect(fetchCurriculumKsbSets).not.toHaveBeenCalled();
    expect(fetchCurriculumKsbSourceDefinitions).not.toHaveBeenCalled();
    await userEvent.click(button);
    await waitFor(() => expect(fetchCurriculumKsbSourceDefinitions).toHaveBeenCalledWith('KSB-1'));
    expect(await screen.findByRole('button', { name: 'Close KSB profile' })).toBeInTheDocument();
  });

  it('shows definition failures and retries without displaying an empty profile', async () => {
    vi.mocked(fetchCurriculumKsbSourceDefinitions).mockRejectedValueOnce(new Error('Definitions unavailable'));
    await renderProgrammes();
    await userEvent.click(await screen.findByRole('button', { name: 'View KSBs for Project Control Professional' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Definitions unavailable');
    expect(screen.queryByText('No KSBs in this profile')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(fetchCurriculumKsbSourceDefinitions).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });

  it('does not reopen a source review when its delayed response arrives after closing', async () => {
    let resolve: (value: CurriculumKsbSourceDefinitions) => void = () => {};
    vi.mocked(fetchCurriculumKsbSourceDefinitions).mockReturnValueOnce(new Promise(done => { resolve = done; }));
    await renderProgrammes();
    await userEvent.click(await screen.findByRole('button', { name: 'View KSBs for Project Control Professional' }));
    expect(await screen.findByText('Loading KSB definitions...')).toHaveAttribute('role', 'status');
    await userEvent.click(screen.getByRole('button', { name: 'Close KSB profile' }));
    await act(async () => { resolve(realProfile as unknown as CurriculumKsbSourceDefinitions); });
    expect(screen.queryByRole('button', { name: 'Close KSB profile' })).not.toBeInTheDocument();
  });

  it('says so for the page, and offers only a real source', async () => {
    await renderProgrammes();
    expect(await screen.findByText('Test-Zyad')).toBeInTheDocument();

    // Named, not counted: one programme is short a source, so the notice says
    // which — a bare "1 programme" leaves the reader to find it in the grid.
    expect(await screen.findByText('Test-Zyad has no KSB codes yet')).toBeInTheDocument();
    expect(screen.getByText(/coverage stays at 0%/))
      .toHaveTextContent('Until a KSB source is applied and filled in');

    // KSBs come from the GOV.UK standards: no manual profile is authored or
    // parked from here.
    expect(screen.queryByRole('button', { name: /Assign empty profile/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Author a KSB profile' })).not.toBeInTheDocument();
    expect(createCurriculumKsbFramework).not.toHaveBeenCalled();
  });

  it('still offers a real source instead of the placeholder', async () => {
    await renderProgrammes();
    expect(await screen.findByText('Test-Zyad')).toBeInTheDocument();

    await userEvent.click(screen.getByText('KSB source checks and shortcuts'));
    await userEvent.click(screen.getByRole('button', { name: 'Choose a source' }));
    expect(await screen.findByText('Apply KSB Source')).toBeInTheDocument();
  });

  it('marks the card, and says what the gap costs rather than that a value is unset', async () => {
    await renderProgrammes();
    expect(await screen.findByText('Test-Zyad')).toBeInTheDocument();

    const bare = within(cardFor('Test-Zyad'));
    expect(bare.getByText('Needs KSB source')).toBeInTheDocument();
    expect(bare.getByText('KSB Source required')).toBeInTheDocument();
    expect(bare.getByText(/Modules cannot map KSBs/)).toBeInTheDocument();
    // The panel is the control, so it says what pressing it does.
    expect(bare.getByRole('button', { name: 'Set the KSB source for Test-Zyad' })).toBeInTheDocument();

    // A programme that has a filled-in source stays quiet: the warning is a
    // state to clear, so it must not appear where there is nothing to clear.
    const mapped = within(cardFor('Data Analyst'));
    expect(mapped.queryByText('Needs KSB source')).not.toBeInTheDocument();
    expect(mapped.getByText('Applied KSB Source')).toBeInTheDocument();
    expect(mapped.getByText('Project Control Professional')).toBeInTheDocument();
    expect(mapped.getByText('348 hrs min')).toBeInTheDocument();
    expect(mapped.getByText('£27,000 max funding')).toBeInTheDocument();
  });

  it('marks a programme parked on the empty profile', async () => {
    ksbSets = [realProfile, sharedEmptyProfile];
    listedProgrammes = [{ ...withSource, name: 'Parked Programme', ksbProfileSourceId: 'profile:KSBP-EMPTY' } as CurriculumProgramme];
    await renderProgrammes();
    expect(await screen.findByText('Parked Programme')).toBeInTheDocument();

    // Applied is not ready: an empty source maps exactly as much as no source.
    await waitFor(() => expect(screen.getByText('Needs KSB codes')).toBeInTheDocument());
    const card = within(screen.getByText('Needs KSB codes').closest('article') as HTMLElement);
    expect(card.getByText('Applied KSB Source · empty')).toBeInTheDocument();
    expect(card.getByText(/A placeholder with no KSB codes in it/)).toBeInTheDocument();
    // The placeholder is moved off, not filled in.
    expect(card.getByRole('button', { name: 'Choose a real KSB source for Parked Programme' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Author a KSB profile' })).not.toBeInTheDocument();
  });

  // Creating a programme writes no profile of its own — there is one, shared —
  // so the create leads to the picker, where that profile is one of the options.
  it('asks a newly created programme for its source without writing a profile', async () => {
    await renderProgrammes();
    expect(await screen.findByText('Test-Zyad')).toBeInTheDocument();

    await userEvent.click(screen.getByText('+ Add new'));
    await userEvent.click(screen.getByRole('button', { name: /Add Programme/ }));
    await userEvent.type(await screen.findByPlaceholderText('e.g. Data Analyst'), 'Fresh Programme');
    await userEvent.click(screen.getByRole('button', { name: 'Create programme' }));

    await waitFor(() => expect(createCurriculumProgramme).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Apply KSB Source')).toBeInTheDocument();
    expect(createCurriculumKsbFramework).not.toHaveBeenCalled();
  });

  it('opens Delivery directly after the new programme has a KSB source', async () => {
    await renderProgrammes();
    expect(await screen.findByText('Test-Zyad')).toBeInTheDocument();

    await userEvent.click(screen.getByText('+ Add new'));
    await userEvent.click(screen.getByRole('button', { name: /Add Programme/ }));
    await userEvent.type(await screen.findByPlaceholderText('e.g. Data Analyst'), 'Fresh Programme');
    await userEvent.click(screen.getByRole('button', { name: 'Create programme' }));

    const sourceHeading = await screen.findByText('Apply KSB Source');
    const sourceModal = within(sourceHeading.closest('.fixed') as HTMLElement);
    // Only the GOV.UK standards are offered; the manual profile is not.
    expect(sourceModal.queryByRole('button', { name: 'KSB profile' })).not.toBeInTheDocument();
    expect(sourceModal.queryByRole('button', { name: /Project Control Professional/ })).not.toBeInTheDocument();
    await userEvent.click(sourceModal.getByRole('button', { name: /Project controls professional/ }));
    await userEvent.click(sourceModal.getByRole('button', { name: 'Apply source' }));

    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/curriculum/programmes/PROG-NEW?tab=cohorts'));
    expect(screen.queryByText('What do you want to do next?')).not.toBeInTheDocument();
  });

  it('drops the notice once every programme has a filled-in source', async () => {
    listedProgrammes = [withSource];
    await renderProgrammes();
    expect(await screen.findByText('Data Analyst')).toBeInTheDocument();

    await waitFor(() => expect(screen.getByText('Applied KSB Source')).toBeInTheDocument());
    expect(screen.queryByText(/has no KSB codes yet/)).not.toBeInTheDocument();
    expect(screen.queryByText(/programmes have no KSB codes yet/)).not.toBeInTheDocument();
  });
});
