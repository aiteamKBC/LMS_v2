import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { CurriculumProgramme } from '@/lib/curriculumApi';

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
  fetchCurriculumStandards: vi.fn(async () => [linkedStandard]),
  fetchCurriculumModules: vi.fn(async () => []),
  fetchCurriculumProgrammeKsbCoverage: vi.fn(async () => null),
  fetchCurriculumProgrammeLearnerKsbImpact: vi.fn(async () => null),
}));

async function renderProgrammes() {
  const { default: Page } = await import('../page');
  return render(<MemoryRouter><Page /><LocationProbe /></MemoryRouter>);
}

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
}

function cardFor(name: string) {
  return screen.getByText(name).closest('article') as HTMLElement;
}

describe('Programmes page — a programme with no usable KSB source', { timeout: 15000 }, () => {
  beforeEach(() => {
    listedProgrammes = [withSource, withoutSource];
    ksbSets = [realProfile];
    createCurriculumProgramme.mockClear();
    createCurriculumKsbFramework.mockClear();
    updateCurriculumKsbFramework.mockClear();
    updateCurriculumProgramme.mockClear();
  });

  it('says so for the page, and parks the programme on the shared empty profile', async () => {
    await renderProgrammes();
    expect(await screen.findByText('Test-Zyad')).toBeInTheDocument();

    // Named, not counted: one programme is short a source, so the notice says
    // which — a bare "1 programme" leaves the reader to find it in the grid.
    expect(await screen.findByText('Test-Zyad has no KSB codes yet')).toBeInTheDocument();
    expect(screen.getByText(/coverage stays at 0%/))
      .toHaveTextContent('Until a KSB source is applied and filled in');

    await userEvent.click(screen.getByRole('button', { name: /Assign empty profile to Test-Zyad/ }));
    await waitFor(() => expect(createCurriculumKsbFramework).toHaveBeenCalledTimes(1));

    // One profile, shared. It carries no programme of its own, so the KSB
    // Frameworks list does not grow a row per programme.
    const [framework] = createCurriculumKsbFramework.mock.calls[0] as unknown as [{
      name: string; programmeId?: string; ksbItems: unknown[];
    }];
    expect(framework.name).toBe('Empty KSB profile');
    expect(framework.programmeId).toBeUndefined();
    expect(framework.ksbItems).toEqual([]);

    // …and it is applied through the ordinary path, so the programme is linked
    // to it exactly as it would be to a real profile.
    await waitFor(() => expect(updateCurriculumProgramme).toHaveBeenCalled());
    const applied = updateCurriculumProgramme.mock.calls.at(-1) as unknown as [string, { ksbProfileSourceId: string }];
    expect(applied[0]).toBe('PROG-BARE');
    // Stored bare, the way every applied profile is: an id with no prefix reads
    // as a profile, and only a standard carries one.
    expect(applied[1].ksbProfileSourceId).toBe('KSBP-EMPTY');
  });

  // "Once" is the whole point: the second programme parked on it reuses the row.
  it('creates the empty profile once and reuses it', async () => {
    ksbSets = [realProfile, sharedEmptyProfile];
    await renderProgrammes();
    expect(await screen.findByText('Test-Zyad')).toBeInTheDocument();

    await userEvent.click(await screen.findByRole('button', { name: /Assign empty profile to Test-Zyad/ }));
    await waitFor(() => expect(updateCurriculumProgramme).toHaveBeenCalled());
    expect(createCurriculumKsbFramework).not.toHaveBeenCalled();
    const applied = updateCurriculumProgramme.mock.calls.at(-1) as unknown as [string, { ksbProfileSourceId: string }];
    // Stored bare, the way every applied profile is: an id with no prefix reads
    // as a profile, and only a standard carries one.
    expect(applied[1].ksbProfileSourceId).toBe('KSBP-EMPTY');
  });

  it('still offers a real source instead of the placeholder', async () => {
    await renderProgrammes();
    expect(await screen.findByText('Test-Zyad')).toBeInTheDocument();

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
    expect(screen.getByRole('button', { name: 'Author a KSB profile' })).toBeInTheDocument();
  });

  // Creating a programme writes no profile of its own — there is one, shared —
  // so the create leads to the picker, where that profile is one of the options.
  it('asks a newly created programme for its source without writing a profile', async () => {
    await renderProgrammes();
    expect(await screen.findByText('Test-Zyad')).toBeInTheDocument();

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

    await userEvent.click(screen.getByRole('button', { name: /Add Programme/ }));
    await userEvent.type(await screen.findByPlaceholderText('e.g. Data Analyst'), 'Fresh Programme');
    await userEvent.click(screen.getByRole('button', { name: 'Create programme' }));

    const sourceHeading = await screen.findByText('Apply KSB Source');
    const sourceModal = within(sourceHeading.closest('.fixed') as HTMLElement);
    await userEvent.click(sourceModal.getByRole('button', { name: /Project Control Professional/ }));
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
