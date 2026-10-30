import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, MemoryRouter, RouterProvider, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { CurriculumCohort, CurriculumGroup, CurriculumModule, CurriculumProgramme } from '@/lib/curriculumApi';
import { fetchCurriculumDeliveryScope, fetchCurriculumOverview } from '@/lib/curriculumApi';
import { fetchAssignedLearners } from '@/api/assignedLearners';
vi.mock('@/api/assignedLearners', () => ({
  fetchAssignedCounts: vi.fn(async (_scope: string, ids: string[]) => ({ counts: Object.fromEntries(ids.map(id => [id, 0])) })),
  fetchAssignedLearners: vi.fn(async () => ({ scope: 'module', id: 'MOD-1', status: 'active', total: 0, filteredTotal: 0, page: 1, pageSize: 25, learners: [] })),
}));

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

const reload = vi.fn(async () => null);
const fetchLearnerAssignments = vi.fn();
const fetchCurriculumScopeLearnerKsbImpact = vi.fn();

vi.mock('@/api/curriculumLearnerAssignments', async importOriginal => ({
  ...(await importOriginal<typeof import('@/api/curriculumLearnerAssignments')>()),
  fetchLearnerAssignments: (...args: unknown[]) => fetchLearnerAssignments(...args),
}));

vi.mock('@/components/feature/WorkspaceShell', () => ({
  WorkspaceShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ auth: null }),
}));

vi.mock('@/components/feature/CurriculumSweetAlert', () => ({
  showCurriculumAlert: vi.fn(async () => undefined),
  showCurriculumConfirm: vi.fn(async () => undefined),
  showCurriculumLoading: vi.fn(),
  closeCurriculumLoading: vi.fn(),
}));

vi.mock('@/pages/curriculum/shared/entities/moduleForm', () => ({
  ModuleFormDrawer: ({ open, defaults }: {
    open: boolean;
    defaults?: { programmeId?: string; cohortId?: string; groupId?: string };
  }) => open ? (
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
    lessons: 3,
    totalOtjh: 7.5,
    ksbCount: 5,
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
  fetchCurriculumDeliveryScope: vi.fn(async () => ({ cohorts, groups })),
  fetchCurriculumHolidays: vi.fn(async () => []),
  fetchCurriculumScopeLearnerKsbImpact: (...args: unknown[]) => fetchCurriculumScopeLearnerKsbImpact(...args),
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

/** Opens the app's SelectMenu combobox and picks the option with this label. */
async function chooseOption(user: ReturnType<typeof userEvent.setup>, comboboxLabel: string, optionLabel: string) {
  await user.click(screen.getByLabelText(comboboxLabel));
  await user.click(await screen.findByRole('option', { name: optionLabel }));
}

/** The catalogue card a module's title sits in. */
function cardFor(title: string) {
  const heading = screen.getByRole('heading', { name: title, level: 3 });
  const card = heading.closest('article');
  if (!card) throw new Error(`No catalogue card rendered for ${title}`);
  return within(card);
}

/**
 * One delivery line inside a card, identified by its cohort / group label. The
 * row is a link when the delivery has an id to open, so match either element.
 *
 * The label is read from the chip's title rather than its own text: the cohort
 * and group names inside it are each a link to that record's workspace now, so
 * the visible label is split across elements.
 */
function deliveryRowFor(title: string, deliveryLabel: string) {
  const row = cardFor(title).getByTitle(`Cohort / group: ${deliveryLabel}`).closest('a, div') as HTMLElement | null;
  if (!row) throw new Error(`No delivery row rendered for ${deliveryLabel}`);
  return within(row);
}

function HistoryProbe() {
  const location = useLocation();
  return <output data-testid="history-location">{location.pathname}{location.search}</output>;
}

describe('Module Builder delivery catalogue', { timeout: 15000 }, () => {
  beforeEach(() => {
    reload.mockClear();
    vi.mocked(fetchCurriculumDeliveryScope).mockClear();
    vi.mocked(fetchCurriculumOverview).mockClear();
    fetchLearnerAssignments.mockReset().mockResolvedValue({
      target: { scope: 'module', id: 'MOD-1', name: 'Data Foundations', moduleCount: 1, programmeName: 'Data Analyst' },
      learners: [],
      totals: { learnerCount: 0, assignedCount: 0 },
    });
    fetchCurriculumScopeLearnerKsbImpact.mockReset().mockResolvedValue({
      assignedLearnerCount: 1,
      assignedLearners: [{ id: 'learner-1', name: 'A Learner', email: 'learner@example.com', programme: 'Data Analyst', programmeStatus: 'active', cohort: 'Sept 2026', group: 'Group A', lifecycleStatus: 'active' }],
      otjhAchievement: { achievedTotal: 2, plannedTotal: 4, progressPercentage: 50, learners: [{ learnerId: 'learner-1', learnerName: 'A Learner', email: 'learner@example.com', cohort: 'Sept 2026', group: 'Group A', plannedOtjh: 4, achievedOtjh: 2, declaredOtjh: 0, completedActivityCount: 1, reflectionCount: 0, progressPercentage: 50 }] },
      ksbAchievement: { achievedWeightTotal: 1.5, expectedWeightTotal: 3, progressPercentage: 50 },
      learnerKsbConsumption: [{ learnerId: 'learner-1', learnerName: 'A Learner', email: 'learner@example.com', cohort: 'Sept 2026', group: 'Group A', consumedWeightTotal: 1.5, expectedWeightTotal: 3, progressPercentage: 50 }],
    });
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

  it('loads filter scope without the complete overview on catalogue mount', async () => {
    await renderCatalogue();
    await waitFor(() => expect(fetchCurriculumDeliveryScope).toHaveBeenCalledTimes(1));
    expect(fetchCurriculumOverview).not.toHaveBeenCalled();
    expect(screen.getByText('Data Foundations')).toBeInTheDocument();
  });

  it('opens the assignment drawer when the module has no assigned learners', async () => {
    await renderCatalogue();
    await userEvent.click(cardFor('Data Foundations').getByRole('button', { name: /active assigned learners$/ }));
    expect(await screen.findByText('No assigned learners in this view.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Assignments & progress' }));

    expect(await screen.findByRole('note')).toHaveTextContent('this module only');
    expect(screen.getByRole('note')).toHaveTextContent('Their programme, cohort and other module assignments stay as they are.');
    expect(fetchLearnerAssignments).toHaveBeenCalledWith(expect.objectContaining({ scope: 'module', id: 'MOD-1' }), expect.any(AbortSignal));
    expect(fetchCurriculumScopeLearnerKsbImpact).not.toHaveBeenCalled();
  });

  it('opens assigned learner progress when the module already has learners', async () => {
    vi.mocked(fetchAssignedLearners).mockResolvedValueOnce({ scope: 'module', id: 'MOD-1', status: 'active', total: 1, filteredTotal: 1, page: 1, pageSize: 25,
      learners: [{ id: 'learner-1', name: 'A Learner', email: 'learner@example.com', status: 'active' }] });
    fetchLearnerAssignments.mockResolvedValueOnce({
      target: { scope: 'module', id: 'MOD-1', name: 'Data Foundations', moduleCount: 1, programmeName: 'Data Analyst' },
      learners: [{ id: 'learner-1', name: 'A Learner', email: 'learner@example.com', programme: 'Data Analyst', company: '', cohort: 'Sept 2026', group: 'Group A', programmeStatus: 'active', learnerType: 'apprentice', assigned: true, moduleCount: 1 }],
      totals: { learnerCount: 1, assignedCount: 1 },
    });
    await renderCatalogue();
    await userEvent.click(cardFor('Data Foundations').getByRole('button', { name: /active assigned learners$/ }));
    await screen.findByText('1 assigned learners');
    await userEvent.click(screen.getByRole('button', { name: 'Assignments & progress' }));

    expect(await screen.findByRole('dialog', { name: 'Data Foundations learner progress' })).toBeInTheDocument();
    expect(cardFor('Data Foundations').getByRole('button', { name: 'Data Foundations: 1 active assigned learners' })).toBeInTheDocument();
    expect(screen.getByText('A Learner')).toBeInTheDocument();
    expect(screen.getByText('KSB weights achieved')).toBeInTheDocument();
    expect(fetchCurriculumScopeLearnerKsbImpact).toHaveBeenCalledWith('module', 'MOD-1', { learnerStatus: 'all', moduleProgress: true });

    await userEvent.click(screen.getByRole('button', { name: 'Assign more learners' }));
    expect(await screen.findByRole('note')).toHaveTextContent('this module only');
  });

  it('shows each module with the delivery it runs in', async () => {
    await renderCatalogue();

    const delivery = deliveryRowFor('Data Foundations', 'Sept 2026 / Group A');
    expect(delivery.getByText('02 Sept 2026 – 07 Oct 2026')).toBeInTheDocument();
    expect(delivery.getByText('Teams')).toBeInTheDocument();
    expect(delivery.getByText('Not created')).toBeInTheDocument();
    // The card states the authored weeks; the delivery states its session count
    // only when it disagrees with the module's. Here they agree, so the delivery
    // stays quiet rather than repeating the same fact.
    expect(delivery.queryByText('6 sessions')).not.toBeInTheDocument();
    expect(cardFor('Data Foundations').getByText('6 weeks')).toBeInTheDocument();
    expect(cardFor('Data Foundations').getByText('3 components')).toBeInTheDocument();
    expect(cardFor('Data Foundations').getByText('7h 30m OTJH')).toBeInTheDocument();
    expect(cardFor('Data Foundations').getByRole('button', { name: 'Review module KSBs' })).toBeInTheDocument();
  });

  // A reader who spots the wrong cohort or group here wants to correct it, and
  // both are edited on their own page. The name is the way there, with the
  // drawer that page already owns opened on arrival.
  it('links the delivery cohort and group to their own workspaces, ready to edit', async () => {
    await renderCatalogue();
    const delivery = deliveryRowFor('Data Foundations', 'Sept 2026 / Group A');

    expect(delivery.getByRole('link', { name: 'Sept 2026' }))
      .toHaveAttribute('href', '/curriculum/cohorts/COHORT-1?edit=1');
    expect(delivery.getByRole('link', { name: 'Group A' }))
      .toHaveAttribute('href', '/curriculum/groups/GROUP-1?groupName=Group+A&edit=1');
  });

  it('puts the delivery workspace in the named action bar', async () => {
    await renderCatalogue();
    const card = cardFor('Data Foundations');

    expect(card.getByRole('link', { name: /Open delivery/ }))
      .toHaveAttribute('href', '/curriculum/modules/MOD-1');
    expect(card.getByRole('button', { name: /Review module KSBs/ })).toBeInTheDocument();
    expect(card.getByRole('button', { name: /Edit components/ })).toBeInTheDocument();
    expect(card.getByRole('button', { name: /Edit module/ })).toBeInTheDocument();
    expect(card.getByRole('button', { name: /Duplicate module/ })).toBeInTheDocument();
    expect(card.getByRole('button', { name: /Archive module/ })).toBeInTheDocument();
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

  it('returns to the module catalogue when the browser goes back from the builder', async () => {
    const user = userEvent.setup();
    window.history.replaceState({}, '', '/curriculum/module-builder');
    const { default: ModuleBuilder } = await import('../page');
    const router = createMemoryRouter([{
      path: '*',
      element: <><ModuleBuilder /><HistoryProbe /></>,
    }], {
      initialEntries: ['/curriculum/delivery', '/curriculum/module-builder'],
      initialIndex: 1,
    });
    render(<RouterProvider router={router} />);

    await screen.findByText('Data Foundations');
    await user.click(cardFor('Data Foundations').getByRole('button', { name: /Edit components/ }));
    await screen.findByText('Course structure');
    expect(screen.getByTestId('history-location')).toHaveTextContent('/curriculum/module-builder');

    await act(async () => { await router.navigate(-1); });
    await waitFor(() => expect(screen.getByTestId('history-location')).toHaveTextContent('/curriculum/module-builder'));
    expect(screen.getByTestId('history-location')).not.toHaveTextContent('/curriculum/delivery');
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

    const programme = await screen.findByRole('combobox', { name: 'Programme' });
    expect(programme).toHaveTextContent('Rewan 2');
    expect(programme).not.toHaveTextContent('PROG-PENDING');
  });

  it('leaves off what the reader cannot act on from the card', async () => {
    await renderCatalogue();

    const card = cardFor('Data Foundations');
    // Status lives in filters and archive flows, not as a repeated catalogue badge.
    expect(card.queryByText('published')).not.toBeInTheDocument();
    expect(cardFor('Network Basics').queryByText('draft')).not.toBeInTheDocument();
    // Staffing is edited in the delivery, and the tutor filter still finds it.
    expect(card.queryByText('Tutor One')).not.toBeInTheDocument();
    expect(card.queryByRole('button', { name: /Change tutor/ })).not.toBeInTheDocument();
    // The delivery rows below say which deliveries there are; this restated it.
    expect(card.queryByText(/Scoped module - used in/)).not.toBeInTheDocument();
  });

  it('requires programme then cohort before a group can narrow the catalogue', async () => {
    const user = userEvent.setup();
    await renderCatalogue();
    expect(screen.getByText('Network Basics')).toBeInTheDocument();

    expect(screen.getByLabelText('Cohort')).toBeDisabled();
    expect(screen.getByLabelText('Group')).toBeDisabled();
    expect(within(screen.getByLabelText('Cohort')).getByText('Choose programme first')).toBeInTheDocument();
    expect(within(screen.getByLabelText('Group')).getByText('Choose cohort first')).toBeInTheDocument();

    await chooseOption(user, 'Programme', 'Data Analyst');
    expect(screen.getByLabelText('Cohort')).toBeEnabled();
    expect(screen.getByLabelText('Group')).toBeDisabled();

    await chooseOption(user, 'Cohort', 'Sept 2026');
    expect(screen.getByLabelText('Group')).toBeEnabled();
    await chooseOption(user, 'Group', 'Group A');

    expect(screen.getByText('Data Foundations')).toBeInTheDocument();
    expect(screen.queryByText('Network Basics')).not.toBeInTheDocument();
  });

  it('offers only the cohorts and groups the selected programme actually delivers', async () => {
    const user = userEvent.setup();
    await renderCatalogue();

    await chooseOption(user, 'Programme', 'Data Analyst');
    await chooseOption(user, 'Cohort', 'Sept 2026');

    await user.click(screen.getByLabelText('Group'));
    const groupOptions = await screen.findAllByRole('option');
    expect(groupOptions.map(option => option.textContent)).toEqual(['All groups', 'Group A']);
  });

  it('keeps programme, cohort and group context when the group starts its first module', async () => {
    await renderCatalogue('?programme=PROG-DATA&cohort=COHORT-1&group=GROUP-1&create=1');

    expect(await screen.findByTestId('module-form-defaults')).toHaveTextContent('program-data|COHORT-1|GROUP-1');
    expect(screen.getByRole('combobox', { name: 'Programme' })).toHaveTextContent('Data Analyst');
    expect(screen.getByRole('combobox', { name: 'Cohort' })).toHaveTextContent('Sept 2026');
    expect(screen.getByRole('combobox', { name: 'Group' })).toHaveTextContent('Group A');
  });

  it('opens components with the programme name, programme KSB source and one week per session', async () => {
    const user = userEvent.setup();
    await renderCatalogue();

    await user.click(cardFor('Data Foundations').getByRole('button', { name: /Edit components/i }));

    expect(await screen.findByRole('button', { name: /Back to modules/i })).toBeInTheDocument();
    const [programmeSelect, ksbSourceSelect] = screen.getAllByRole('combobox');
    expect(within(programmeSelect).getByText('Data Analyst')).toBeInTheDocument();
    expect(within(ksbSourceSelect).getByText('Data Analyst')).toBeInTheDocument();
    expect(screen.getByText('Week 6')).toBeInTheDocument();
  });

});
