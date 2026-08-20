import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { CurriculumModule, CurriculumProgramme } from '@/lib/curriculumApi';

/**
 * The delivery side of the catalogue, which arrived here when the separate
 * Curriculum -> Modules page was removed. Module Builder is now the single list
 * of modules, so the three things that list existed for have to hold here:
 *
 *   catalogue -> read a module's cohort, group, tutor, dates and sessions
 *   catalogue -> narrow to one group through the Programme/Cohort/Group cascade
 *   catalogue -> change a tutor, straight against the module
 *
 * The last one is also the notification path: the PATCH must address the module
 * itself, because that is what mirrors onto the tutor's profile.
 */

const updateCurriculumModule = vi.fn(async () => ({ updated: true }));
const reload = vi.fn(async () => null);

vi.mock('@/components/feature/WorkspaceShell', () => ({
  WorkspaceShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/feature/CurriculumSweetAlert', () => ({
  showCurriculumAlert: vi.fn(async () => undefined),
  showCurriculumConfirm: vi.fn(async () => undefined),
  showCurriculumLoading: vi.fn(),
  closeCurriculumLoading: vi.fn(),
}));

vi.mock('@/pages/curriculum/week-builder/weekTemplateData', () => ({
  fetchComponentPointsDefaults: vi.fn(async () => ({})),
  loadCurriculumScope: vi.fn(async () => ({ programmes: [], cohorts: [], groups: [] })),
  fetchWeekTemplates: vi.fn(async () => []),
  fetchWeekTemplateDetail: vi.fn(async () => null),
  filterWeekTemplatesForScope: () => [],
}));

const programmes = [
  { id: 'program-data', sourceId: 'PROG-DATA', name: 'Data Analyst' },
  { id: 'program-net', sourceId: 'PROG-NET', name: 'Network Engineer' },
] as CurriculumProgramme[];

const modules = [
  {
    id: 'MOD-1',
    moduleCatalogueId: 'MOD-1',
    name: 'Data Foundations',
    programme: 'Data Analyst',
    programmeId: 'PROG-DATA',
    cohortId: 'COHORT-1',
    cohort: 'Sept 2026',
    groupId: 'GROUP-1',
    group: 'Group A',
    tutor: 'Tutor One',
    sessionsNumber: 6,
    startDate: '2026-09-02',
    endDate: '2026-10-07',
    status: 'published',
  },
  {
    id: 'MOD-2',
    moduleCatalogueId: 'MOD-2',
    name: 'Network Basics',
    programme: 'Network Engineer',
    programmeId: 'PROG-NET',
    cohortId: 'COHORT-2',
    cohort: 'Jan 2027',
    groupId: 'GROUP-2',
    group: 'Group B',
    tutor: '',
    sessionsNumber: 4,
    status: 'draft',
  },
] as CurriculumModule[];

vi.mock('@/hooks/useCurriculumModules', () => ({
  useCurriculumModules: () => ({ modules, loading: false, error: null, reload }),
}));

vi.mock('@/hooks/useCurriculumProgrammes', () => ({
  useCurriculumProgrammes: () => ({ programmes, loading: false, error: null, reload: vi.fn() }),
}));

vi.mock('@/hooks/useCurriculumKsbSets', () => ({
  useCurriculumKsbSets: () => ({ ksbSets: [], loading: false, error: null, reload: vi.fn() }),
}));

vi.mock('@/lib/curriculumApi', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/curriculumApi')>()),
  fetchCurriculumStandards: vi.fn(async () => []),
  fetchCurriculumTutors: vi.fn(async () => [{ id: 1, name: 'Tutor One' }, { id: 2, name: 'Tutor Two' }]),
  fetchCurriculumTeamsMeetingSummaries: vi.fn(async () => []),
  updateCurriculumModule: (...args: unknown[]) => updateCurriculumModule(...(args as [])),
}));

async function renderCatalogue() {
  const { default: ModuleBuilder } = await import('../page');
  const result = render(
    <MemoryRouter initialEntries={['/curriculum/module-builder']}>
      <ModuleBuilder />
    </MemoryRouter>,
  );
  await screen.findByText('Data Foundations');
  return result;
}

/** The catalogue card a module's title sits in. */
function cardFor(title: string) {
  const heading = screen.getByText(title);
  const card = heading.closest('article');
  if (!card) throw new Error(`No catalogue card rendered for ${title}`);
  return within(card);
}

/** One delivery line inside a card, identified by its cohort / group label. */
function deliveryRowFor(title: string, deliveryLabel: string) {
  const row = cardFor(title).getByText(deliveryLabel).closest('div');
  if (!row) throw new Error(`No delivery row rendered for ${deliveryLabel}`);
  return within(row);
}

describe('Module Builder delivery catalogue', () => {
  beforeEach(() => {
    updateCurriculumModule.mockClear();
    reload.mockClear();
  });

  it('shows each module with the delivery it runs in', async () => {
    await renderCatalogue();

    const delivery = deliveryRowFor('Data Foundations', 'Sept 2026 / Group A');
    expect(delivery.getByText('Tutor One')).toBeInTheDocument();
    expect(delivery.getByText('6 sessions')).toBeInTheDocument();
    expect(delivery.getByText('02 Sept 2026 – 07 Oct 2026')).toBeInTheDocument();
    expect(delivery.getByText('Teams not created')).toBeInTheDocument();

    // A delivery with nobody on it says so rather than showing an empty cell.
    expect(deliveryRowFor('Network Basics', 'Jan 2027 / Group B').getByText('Unassigned')).toBeInTheDocument();
  });

  it('links each delivery to its own workspace', async () => {
    await renderCatalogue();
    expect(cardFor('Data Foundations').getByRole('link', { name: /Delivery workspace/ }))
      .toHaveAttribute('href', '/curriculum/modules/MOD-1');
  });

  it('narrows the catalogue to one group through the delivery filters', async () => {
    const user = userEvent.setup();
    await renderCatalogue();
    expect(screen.getByText('Network Basics')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Group'), 'GROUP-1');

    expect(screen.getByText('Data Foundations')).toBeInTheDocument();
    expect(screen.queryByText('Network Basics')).not.toBeInTheDocument();
  });

  it('offers only the cohorts and groups the selected programme actually delivers', async () => {
    const user = userEvent.setup();
    await renderCatalogue();

    await user.selectOptions(screen.getByLabelText('Programme'), 'Data Analyst');

    const groupOptions = within(screen.getByLabelText('Group')).getAllByRole('option');
    expect(groupOptions.map(option => option.textContent)).toEqual(['All groups', 'Group A']);
  });

  it('changes a tutor straight against the module', async () => {
    const user = userEvent.setup();
    await renderCatalogue();

    await user.click(cardFor('Data Foundations').getByRole('button', { name: /Change tutor/ }));
    // Scoped to the drawer: the catalogue's own tutor filter is a combobox too.
    const drawer = (await screen.findByRole('button', { name: 'Save tutor' })).closest('form');
    if (!drawer) throw new Error('The change-tutor drawer did not open');
    await user.click(within(drawer).getByRole('combobox'));
    const options = await screen.findByRole('listbox');
    await user.click(within(options).getByRole('option', { name: 'Tutor Two' }));
    await user.click(screen.getByRole('button', { name: 'Save tutor' }));

    await waitFor(() => expect(updateCurriculumModule).toHaveBeenCalledTimes(1));
    // Addressed to the module, not to its group or cohort: that is the call the
    // backend mirrors onto the tutor's profile and notifies on.
    expect(updateCurriculumModule).toHaveBeenCalledWith('MOD-1', { tutor: 'Tutor Two' });
    expect(reload).toHaveBeenCalled();
  });
});
