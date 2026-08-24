import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { CurriculumProgramme } from '@/lib/curriculumApi';

/**
 * A programme with no KSB source is unfinished work, not a programme with a
 * setting left at its default: nothing under it can map a KSB, its coverage
 * cannot be measured, and the KSB mapping page has nothing to show. So the gap
 * has to be visible on the page where programmes are made — a notice for the
 * page, a badge on the card, and the panel saying what it costs — rather than
 * discovered later on an empty screen.
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

const ksbSets = [
  {
    id: 'KSB-1', frameworkId: 'KSB-1', standard: 'Project Control Professional',
    programmeName: 'Project Control', knowledge: 31, skills: 29, behaviours: 11,
    ksbs: new Array(71).fill({ code: 'K1' }),
  },
  // The profile a newly created programme starts with: applied, and empty.
  {
    id: 'KSB-EMPTY', frameworkId: 'KSB-EMPTY', standard: 'Blank Standard',
    programmeName: 'Empty Profile Programme', knowledge: 0, skills: 0, behaviours: 0,
    ksbs: [],
  },
];

const createCurriculumProgramme = vi.fn(async () => ({
  created: true,
  programme: { id: 'PROG-NEW', sourceId: 'PROG-NEW', name: 'Fresh Programme', ksbProfileSourceId: '' },
}));
const createCurriculumKsbFramework = vi.fn(async () => ({
  created: true,
  framework: { id: 'KSBP-FRESH', name: 'Fresh Programme' },
}));
const updateCurriculumProgramme = vi.fn(async () => ({ updated: true }));

vi.mock('@/lib/curriculumApi', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/curriculumApi')>()),
  createCurriculumProgramme: (...args: unknown[]) => createCurriculumProgramme(...(args as [])),
  createCurriculumKsbFramework: (...args: unknown[]) => createCurriculumKsbFramework(...(args as [])),
  updateCurriculumProgramme: (...args: unknown[]) => updateCurriculumProgramme(...(args as [])),
  fetchCurriculumKsbSets: vi.fn(async () => ksbSets),
  fetchCurriculumStandards: vi.fn(async () => []),
  fetchCurriculumModules: vi.fn(async () => []),
  fetchCurriculumProgrammeKsbCoverage: vi.fn(async () => null),
  fetchCurriculumProgrammeLearnerKsbImpact: vi.fn(async () => null),
}));

async function renderProgrammes() {
  const { default: Page } = await import('../page');
  return render(<MemoryRouter><Page /></MemoryRouter>);
}

function cardFor(name: string) {
  return screen.getByText(name).closest('article') as HTMLElement;
}

describe('Programmes page — a missing KSB source', () => {
  beforeEach(() => {
    listedProgrammes = [withSource, withoutSource];
    createCurriculumProgramme.mockClear();
    createCurriculumKsbFramework.mockClear();
    updateCurriculumProgramme.mockClear();
  });

  it('says so for the page, and offers the step that clears it', async () => {
    await renderProgrammes();
    expect(await screen.findByText('Test-Zyad')).toBeInTheDocument();

    // Named, not counted: one programme is missing a source, so the notice says
    // which — a bare "1 programme" leaves the reader to find it in the grid.
    expect(await screen.findByText('Test-Zyad has no KSB codes yet')).toBeInTheDocument();
    expect(screen.getByText(/coverage stays at 0%/))
      .toHaveTextContent('Until a KSB source is applied and filled in');

    // …and the fix is in the notice rather than only on the card: the same empty
    // profile a new programme gets, for one made before that was the rule.
    await userEvent.click(screen.getByRole('button', { name: /Create profile for Test-Zyad/ }));
    await waitFor(() => expect(createCurriculumKsbFramework).toHaveBeenCalledTimes(1));
    const [framework] = createCurriculumKsbFramework.mock.calls[0] as unknown as [{ name: string; programmeId: string }];
    expect(framework.name).toBe('Test-Zyad');
    expect(framework.programmeId).toBe('PROG-BARE');
    const applied = updateCurriculumProgramme.mock.calls.at(-1) as unknown as [string, { ksbProfileSourceId: string }];
    expect(applied[1].ksbProfileSourceId).toBe('profile:KSBP-FRESH');
  });

  it('still offers to borrow an existing source instead', async () => {
    await renderProgrammes();
    expect(await screen.findByText('Test-Zyad')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Use an existing source' }));
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

    // A programme that has one stays quiet: the warning is a state to clear, so
    // it must not appear on the cards that have nothing to clear.
    const mapped = within(cardFor('Data Analyst'));
    expect(mapped.queryByText('Needs KSB source')).not.toBeInTheDocument();
    expect(mapped.getByText('Applied KSB Source')).toBeInTheDocument();
    expect(mapped.getByText('Project Control Professional')).toBeInTheDocument();
  });

  // The complaint this answers: a programme was created with no KSB source at
  // all, so nothing under it could be mapped. Creating one now builds an empty
  // profile of its own and applies it, in the same step.
  it('gives a newly created programme its own empty KSB profile', async () => {
    await renderProgrammes();
    expect(await screen.findByText('Test-Zyad')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Add Programme/ }));
    await userEvent.type(await screen.findByPlaceholderText('e.g. Data Analyst'), 'Fresh Programme');
    await userEvent.click(screen.getByRole('button', { name: 'Create programme' }));

    await waitFor(() => expect(createCurriculumKsbFramework).toHaveBeenCalledTimes(1));
    // Named after the programme, linked to it, and empty: the codes themselves
    // are authored on the KSB Frameworks page.
    const [framework] = createCurriculumKsbFramework.mock.calls[0] as unknown as [{
      name: string; programmeId: string; programmeIds: string[]; ksbItems: unknown[];
    }];
    expect(framework.name).toBe('Fresh Programme');
    expect(framework.programmeId).toBe('PROG-NEW');
    expect(framework.programmeIds).toContain('PROG-NEW');
    expect(framework.ksbItems).toEqual([]);

    // …and applied to the programme, so it is never left without a source.
    await waitFor(() => expect(updateCurriculumProgramme).toHaveBeenCalled());
    const applied = updateCurriculumProgramme.mock.calls.at(-1) as unknown as [string, { ksbProfileSourceId: string }];
    expect(applied[0]).toBe('PROG-NEW');
    expect(applied[1].ksbProfileSourceId).toBe('profile:KSBP-FRESH');

    // The source is settled, so nothing asks the reader to choose one.
    expect(screen.queryByText('Apply KSB Source')).not.toBeInTheDocument();
  });

  // Failing to build the profile must not leave the programme stranded: the
  // programme is saved either way, and then the reader is asked for a source.
  it('asks for a source when the automatic profile could not be created', async () => {
    createCurriculumKsbFramework.mockRejectedValueOnce(new Error('offline'));
    createCurriculumKsbFramework.mockRejectedValueOnce(new Error('offline'));
    await renderProgrammes();
    expect(await screen.findByText('Test-Zyad')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Add Programme/ }));
    await userEvent.type(await screen.findByPlaceholderText('e.g. Data Analyst'), 'Fresh Programme');
    await userEvent.click(screen.getByRole('button', { name: 'Create programme' }));

    await waitFor(() => expect(createCurriculumProgramme).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Apply KSB Source')).toBeInTheDocument();
  });

  it('marks a programme whose applied profile is still empty', async () => {
    listedProgrammes = [{ ...withSource, name: 'Empty Profile Programme', ksbProfileSourceId: 'profile:KSB-EMPTY' } as CurriculumProgramme];
    await renderProgrammes();
    expect(await screen.findByText('Empty Profile Programme')).toBeInTheDocument();

    // Applied is not ready: an empty profile maps exactly as much as no profile.
    await waitFor(() => expect(screen.getByText('Needs KSB codes')).toBeInTheDocument());
    const card = within(screen.getByText('Needs KSB codes').closest('article') as HTMLElement);
    expect(card.getByText('Applied KSB Source · empty')).toBeInTheDocument();
    expect(card.getByText(/No KSB codes in it yet/)).toBeInTheDocument();
    // The work is authoring codes, not choosing a different source.
    expect(card.getByRole('button', { name: 'Add KSB codes for Empty Profile Programme' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add KSB codes' })).toBeInTheDocument();
  });

  it('drops the notice once every programme has a source', async () => {
    listedProgrammes = [withSource];
    await renderProgrammes();
    expect(await screen.findByText('Data Analyst')).toBeInTheDocument();

    await waitFor(() => expect(screen.getByText('Applied KSB Source')).toBeInTheDocument());
    expect(screen.queryByText(/has no KSB codes yet/)).not.toBeInTheDocument();
    expect(screen.queryByText(/programmes have no KSB codes yet/)).not.toBeInTheDocument();
  });
});
