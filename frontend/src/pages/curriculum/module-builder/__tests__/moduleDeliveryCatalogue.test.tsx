import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { CurriculumCohort, CurriculumGroup, CurriculumModule, CurriculumProgramme } from '@/lib/curriculumApi';

/**
 * The delivery side of the catalogue, which arrived here when the separate
 * Curriculum -> Modules page was removed. Module Builder is now the single list
 * of modules, so the three things that list existed for have to hold here:
 *
 *   catalogue -> read which cohort and group run a module, and when
 *   catalogue -> narrow to one group through the Programme/Cohort/Group cascade
 *   catalogue -> get into a delivery, which is where it is edited
 *
 * The card carries only what is read at a glance. Staffing and the rest of the
 * delivery are edited one click away, in the workspace each row opens, so the
 * tutor is deliberately not on the card and cannot be changed from it.
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

vi.mock('@/pages/curriculum/shared/entities/moduleForm', () => ({
  ModuleFormDrawer: ({ open, defaults }: { open: boolean; defaults?: { programmeId?: string; cohortId?: string; groupId?: string } }) => open ? (
    <div data-testid="module-form-defaults">
      {defaults?.programmeId}|{defaults?.cohortId}|{defaults?.groupId}
    </div>
  ) : null,
}));

vi.mock('@/pages/curriculum/shared/components/weekAuthoringLazy', () => ({
  ComponentEditor: ({ component, onBack }: { component: { title: string }; onBack: () => void }) => (
    <div>
      <button type="button" title="Back to week overview" onClick={onBack}>Back</button>
      <span>{component.title}</span>
    </div>
  ),
  WeekComponentRail: ({ weekId, components, onChange, onSelectId }: {
    weekId: string;
    components: Array<{ id: string }>;
    onChange: (components: unknown[]) => void;
    onSelectId: (id: string) => void;
  }) => (
    <div data-testid="week-component-rail">
      <button type="button" onClick={() => {
        const component = {
          id: 'COMP-FROM-RAIL',
          weekId,
          type: 'powerpoint',
          title: 'Rail PowerPoint',
          description: '',
          expectedOtjh: 2,
          points: 5,
          reflectionRequired: false,
          reflectionQuestion: '',
          workplaceEvidenceRequired: false,
          tutorValidationRequired: false,
          ksbMappings: [],
          settings: {},
        };
        onChange([...components, component]);
        onSelectId(component.id);
      }}>Add from rail</button>
    </div>
  ),
  WeekOverviewPanel: () => <p>Select a part on the rail to edit it.</p>,
}));

vi.mock('@/pages/curriculum/week-builder/weekTemplateData', () => ({
  fetchComponentPointsDefaults: vi.fn(async () => ({})),
  loadCurriculumScope: vi.fn(async () => ({ programmes: [], cohorts: [], groups: [] })),
  fetchWeekTemplates: vi.fn(async () => []),
  fetchWeekTemplateDetail: vi.fn(async () => null),
  filterWeekTemplatesForScope: () => [],
}));

const programmes = [
  { id: 'program-data', sourceId: 'PROG-DATA', name: 'Data Analyst', ksbProfileSourceId: 'KSBP-DATA' },
  { id: 'program-net', sourceId: 'PROG-NET', name: 'Network Engineer' },
] as CurriculumProgramme[];

const cohorts = [{ id: 'COHORT-1', name: 'Sept 2026', programmeId: 'PROG-DATA', programme: 'Data Analyst' }] as CurriculumCohort[];
const groups = [{ id: 'GROUP-1', name: 'Group A', cohortId: 'COHORT-1', cohort: 'Sept 2026', programmeId: 'PROG-DATA', programme: 'Data Analyst' }] as CurriculumGroup[];

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
    weeks: 6,
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
    weeks: 4,
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
  useCurriculumKsbSets: () => ({
    ksbSets: [{
      id: 'KSBP-DATA',
      frameworkId: 'KSBP-DATA',
      programmeId: 'PROG-DATA',
      programmeIds: ['PROG-DATA'],
      programmeName: 'Data Analyst',
      standard: 'Data Analyst',
      ksbs: [],
    }],
    loading: false,
    error: null,
    reload: vi.fn(),
  }),
}));

vi.mock('@/lib/curriculumApi', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/curriculumApi')>()),
  fetchCurriculumStandards: vi.fn(async () => []),
  fetchCurriculumTutors: vi.fn(async () => [{ id: 1, name: 'Tutor One' }, { id: 2, name: 'Tutor Two' }]),
  fetchCurriculumTeamsMeetingSummaries: vi.fn(async () => []),
  fetchCurriculumOverview: vi.fn(async () => ({ programmes, cohorts, groups, modules })),
  fetchCurriculumHolidays: vi.fn(async () => []),
  updateCurriculumModule: (...args: unknown[]) => updateCurriculumModule(...(args as [])),
}));

async function renderCatalogue(search = '') {
  window.history.replaceState({}, '', `/curriculum/module-builder${search}`);
  const { default: ModuleBuilder } = await import('../page');
  const result = render(
    <MemoryRouter initialEntries={[`/curriculum/module-builder${search}`]}>
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

/**
 * One delivery line inside a card, identified by its cohort / group label. The
 * row is a link when the delivery has an id to open, so match either element.
 */
function deliveryRowFor(title: string, deliveryLabel: string) {
  const row = cardFor(title).getByText(deliveryLabel).closest('a, div') as HTMLElement | null;
  if (!row) throw new Error(`No delivery row rendered for ${deliveryLabel}`);
  return within(row);
}

describe('Module Builder delivery catalogue', { timeout: 15000 }, () => {
  beforeEach(() => {
    updateCurriculumModule.mockClear();
    reload.mockClear();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      id: 'module-MOD-1',
      catalogueId: 'MOD-1',
      programmeId: '',
      programmeName: '',
      title: 'Data Foundations',
      description: '',
      status: 'published',
      ksbProfileSourceId: '',
      sessionsNumber: 0,
      weeks: 0,
      totalOtjh: 0,
      ksbCount: 0,
      lessonCount: 0,
      quizCount: 0,
      qualityScore: 0,
      moduleKsbMappings: [],
      completionCriteria: {},
      advancedDetails: {},
      background: '',
      epaRequirements: [],
      qualificationOutcomes: [],
      weekStructure: [],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    window.history.replaceState({}, '', '/');
  });

  it('shows each module with the delivery it runs in', async () => {
    await renderCatalogue();

    const delivery = deliveryRowFor('Data Foundations', 'Sept 2026 / Group A');
    expect(delivery.getByText('02 Sept 2026 – 07 Oct 2026')).toBeInTheDocument();
    expect(delivery.getByText('Teams not created')).toBeInTheDocument();
    // The card states the authored weeks; the delivery states its session count
    // only when it disagrees with the module's. Here they agree, so the delivery
    // stays quiet rather than repeating the same fact.
    expect(delivery.queryByText('6 sessions')).not.toBeInTheDocument();
    expect(cardFor('Data Foundations').getByText('6 weeks')).toBeInTheDocument();
  });

  it('puts the delivery workspace in the named action bar', async () => {
    await renderCatalogue();
    const card = cardFor('Data Foundations');

    expect(card.getByRole('link', { name: /Open delivery/ }))
      .toHaveAttribute('href', '/curriculum/modules/MOD-1?moduleName=Data+Foundations');
    expect(card.getByRole('button', { name: /Review module KSBs/ })).toBeInTheDocument();
    expect(card.getByRole('button', { name: /Edit components/ })).toBeInTheDocument();
    expect(card.getByRole('button', { name: /Edit module/ })).toBeInTheDocument();
    expect(card.getByRole('button', { name: /Duplicate module/ })).toBeInTheDocument();
    expect(card.getByRole('button', { name: /Delete module/ })).toBeInTheDocument();
  });

  it('opens a newly added component in its editor immediately', async () => {
    const user = userEvent.setup();
    await renderCatalogue();

    await user.click(cardFor('Data Foundations').getByRole('button', { name: /Edit components/ }));
    await screen.findByText('Course structure');
    await user.click(screen.getByRole('button', { name: 'Add component' }));
    await user.click(screen.getByText('PowerPoint', { selector: 'span' }));
    await user.click(screen.getByRole('button', { name: /Add 1 component/ }));

    expect(await screen.findByTitle('Back to week overview')).toBeInTheDocument();
    expect(screen.queryByText('Select a part on the rail to edit it.')).not.toBeInTheDocument();
  });

  it('waits for a component added by the week rail before opening its settings', async () => {
    const user = userEvent.setup();
    await renderCatalogue();

    await user.click(cardFor('Data Foundations').getByRole('button', { name: /Edit components/ }));
    await screen.findByText('Course structure');
    await user.click(screen.getByRole('button', { name: 'Add from rail' }));

    expect(await screen.findByTitle('Back to week overview')).toBeInTheDocument();
    expect(screen.getAllByText('Rail PowerPoint')).not.toHaveLength(0);
  });

  it('shows the programme name from the route while the programme collection is still resolving', async () => {
    window.history.replaceState({}, '', '/curriculum/module-builder?programme=PROG-PENDING&programmeName=Rewan+2');
    const { default: ModuleBuilder } = await import('../page');
    render(
      <MemoryRouter initialEntries={['/curriculum/module-builder?programme=PROG-PENDING&programmeName=Rewan+2']}>
        <ModuleBuilder />
      </MemoryRouter>,
    );

    const hierarchy = await screen.findByRole('navigation', { name: 'Curriculum hierarchy' });
    expect(within(hierarchy).getByText('Rewan 2')).toBeInTheDocument();
    expect(within(hierarchy).queryByText('PROG-PENDING')).not.toBeInTheDocument();
  });

  it('leaves off what the reader cannot act on from the card', async () => {
    await renderCatalogue();

    const card = cardFor('Data Foundations');
    // A published module is the expected state, so it is not badged; a draft is.
    expect(card.queryByText('published')).not.toBeInTheDocument();
    expect(cardFor('Network Basics').getByText('draft')).toBeInTheDocument();
    // Staffing is edited in the delivery, and the tutor filter still finds it.
    expect(card.queryByText('Tutor One')).not.toBeInTheDocument();
    expect(card.queryByRole('button', { name: /Change tutor/ })).not.toBeInTheDocument();
    // The delivery rows below say which deliveries there are; this restated it.
    expect(card.queryByText(/Scoped module - used in/)).not.toBeInTheDocument();
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

  it('keeps programme, cohort and group context when the group starts its first module', async () => {
    await renderCatalogue('?programme=PROG-DATA&cohort=COHORT-1&group=GROUP-1&create=1');

    expect(await screen.findByTestId('module-form-defaults')).toHaveTextContent('program-data|COHORT-1|GROUP-1');
    const hierarchy = screen.getByRole('navigation', { name: 'Curriculum hierarchy' });
    expect(within(hierarchy).getByText('Data Analyst')).toBeInTheDocument();
    expect(await within(hierarchy).findByText('Sept 2026')).toBeInTheDocument();
    expect(within(hierarchy).getByText('Group A')).toBeInTheDocument();
    expect(within(hierarchy).getByText('Modules')).toBeInTheDocument();
  });

  it('opens components with the programme name, programme KSB source and one week per session', async () => {
    const user = userEvent.setup();
    await renderCatalogue();

    await user.click(cardFor('Data Foundations').getByRole('button', { name: /Edit components/i }));

    expect(await screen.findByRole('button', { name: /Back to modules/i })).toBeInTheDocument();
    const [programmeSelect, ksbSourceSelect] = screen.getAllByRole('combobox');
    expect(programmeSelect).toHaveValue('Data Analyst');
    expect(ksbSourceSelect).toHaveValue('KSBP-DATA');
    expect(screen.getByText('Week 6')).toBeInTheDocument();
  });

});
