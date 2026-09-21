import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { CurriculumModule, CurriculumProgramme } from '@/lib/curriculumApi';

/**
 * The workspace hearing about somebody else's save without being refreshed.
 *
 * Two tabs on one module used to disagree until one of them was reloaded by
 * hand, and the only thing that ever told the second tab it was behind was the
 * save it then had refused. What decides the behaviour here is whether this
 * workspace has anything unsaved:
 *
 * - nothing unsaved: take the stored version, because a screen that quietly
 *   disagrees with the database is the whole complaint;
 * - unsaved edits: say so and touch nothing, because adopting over them is the
 *   overwrite the save guard exists to prevent, and doing it silently would be
 *   worse than the stale screen was.
 */

const reload = vi.fn(async () => null);
const loadModuleStructure = vi.fn();
const saveModuleStructure = vi.fn();
/** The live-refresh callback the page registers, so a test can be the write. */
let liveRefresh: (() => void) | null = null;

vi.mock('@/hooks/useRefreshOnReturn', () => ({
  useLiveRefresh: (refresh: () => void) => { liveRefresh = refresh; },
  useRefreshOnReturn: () => {},
  useRefreshOnRemoteWrite: () => {},
}));

vi.mock('../../shared/entities/moduleForm', async importOriginal => ({
  ...(await importOriginal<typeof import('../../shared/entities/moduleForm')>()),
  ModuleFormDrawer: ({ onSaved }: { onSaved?: () => void }) => (
    <button type="button" data-testid="drawer-saved" onClick={() => onSaved?.()}>drawer saved</button>
  ),
}));

vi.mock('@/components/feature/WorkspaceShell', () => ({
  WorkspaceShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('sweetalert2', () => ({
  default: { fire: vi.fn(async () => ({ isConfirmed: false, isDenied: false, isDismissed: true })) },
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

vi.mock('@/pages/curriculum/shared/components/weekAuthoringLazy', () => ({
  ComponentEditor: () => null,
  WeekComponentRail: () => null,
  WeekOverviewPanel: () => null,
}));

vi.mock('../moduleAuthoringData', async importOriginal => ({
  ...(await importOriginal<typeof import('../moduleAuthoringData')>()),
  loadModuleStructure: (...args: unknown[]) => loadModuleStructure(...(args as [])),
  saveModuleStructure: (...args: unknown[]) => saveModuleStructure(...(args as [])),
}));

const programmes = [
  { id: 'program-mm', sourceId: 'PROG-MM', name: 'Marketing Manager' },
] as CurriculumProgramme[];

const modules = [
  {
    id: 'MOD-LIVE-1',
    moduleCatalogueId: 'MOD-LIVE-1',
    name: 'Marketing Strategy',
    programme: 'Marketing Manager',
    programmeId: 'PROG-MM',
    sessionsNumber: 1,
    status: 'draft',
  },
] as CurriculumModule[];

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ auth: { account: { role: 'curriculum' } } }),
}));

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
  fetchCurriculumTutors: vi.fn(async () => []),
  fetchCurriculumTeamsMeetingSummaries: vi.fn(async () => []),
  fetchCurriculumOverview: vi.fn(async () => ({ programmes, cohorts: [], groups: [], modules })),
  fetchCurriculumHolidays: vi.fn(async () => []),
}));

/** The stored module, as the structure endpoint serves it. */
function storedStructure(weekTitle = 'Week one', revision = 'rev-1') {
  return {
    weekStructure: [
      {
        id: 'WEEK-1',
        moduleId: 'MOD-LIVE-1',
        weekNumber: 1,
        title: weekTitle,
        summary: '',
        learningOutcomes: [],
        components: [
          {
            id: 'COMPONENT-1',
            type: 'reading',
            title: 'First component',
            description: '',
            expectedOtjh: 1,
            points: 5,
            reflectionRequired: false,
            reflectionQuestion: '',
            workplaceEvidenceRequired: false,
            tutorValidationRequired: false,
            ksbMappings: [],
            settings: {},
          },
        ],
        ksbMappings: [],
      },
    ],
    structureRevision: revision,
  };
}

async function openWorkspace() {
  loadModuleStructure.mockResolvedValue(storedStructure());
  const search = '?module=MOD-LIVE-1';
  window.history.replaceState({}, '', `/curriculum/module-builder${search}`);
  const { default: ModuleBuilder } = await import('../page');
  render(
    <MemoryRouter initialEntries={[`/curriculum/module-builder${search}`]}>
      <ModuleBuilder />
    </MemoryRouter>,
  );
  return screen.findByLabelText(/Week title/i);
}

/** Somebody else's save, followed by the write reaching this workspace. */
async function saveArrivesFromElsewhere(weekTitle: string, revision: string) {
  loadModuleStructure.mockResolvedValue(storedStructure(weekTitle, revision));
  liveRefresh?.();
}

describe('Module Builder live sync', { timeout: 25000 }, () => {
  beforeEach(() => {
    reload.mockClear();
    loadModuleStructure.mockReset();
    saveModuleStructure.mockReset();
    // The endpoint echoes the module back with the revision the write produced.
    saveModuleStructure.mockImplementation(async (_id: string, module: unknown) => ({
      ...(module as Record<string, unknown>),
      structureRevision: 'rev-after-save',
    }));
    liveRefresh = null;
  });

  /** What the last save actually claimed to be built from. */
  function lastExpectedRevision() {
    const calls = saveModuleStructure.mock.calls as [string, unknown, { expectedRevision?: string }?][];
    return calls[calls.length - 1]?.[2]?.expectedRevision;
  }

  it('shows a write made somewhere else without anyone pressing refresh', async () => {
    const title = await openWorkspace();
    expect(title).toHaveValue('Week one');

    await saveArrivesFromElsewhere('Week one, renamed by Sara', 'rev-2');

    await waitFor(() => expect(title).toHaveValue('Week one, renamed by Sara'));
    // No banner: there was nothing of this reader's to weigh it against, so
    // there is no decision to put to them.
    expect(screen.queryByRole('button', { name: 'Load their version' })).not.toBeInTheDocument();
  });

  it('keeps unsaved edits and offers the choice rather than taking the write', async () => {
    const title = await openWorkspace();
    await userEvent.clear(title);
    await userEvent.type(title, 'My unsaved week');

    await saveArrivesFromElsewhere('Week one, renamed by Sara', 'rev-2');

    expect(await screen.findByRole('button', { name: 'Load their version' })).toBeInTheDocument();
    // The edit is untouched, and nothing was written on the reader's behalf.
    expect(title).toHaveValue('My unsaved week');
    expect(saveModuleStructure).not.toHaveBeenCalled();
  });

  it('says nothing when the write was somewhere else in the curriculum', async () => {
    const title = await openWorkspace();
    await userEvent.clear(title);
    await userEvent.type(title, 'My unsaved week');

    // The counter moved, but this module is still the one this workspace read.
    await saveArrivesFromElsewhere('Week one', 'rev-1');

    await waitFor(() => expect(loadModuleStructure).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('button', { name: 'Load their version' })).not.toBeInTheDocument();
    expect(title).toHaveValue('My unsaved week');
  });

  it('saves against the revision it adopted when it took a remote write', async () => {
    // Clean: payload and revision moved together, so the next save names the
    // version it is actually built on and the guard lets it through.
    const title = await openWorkspace();
    await saveArrivesFromElsewhere('Week one, renamed by Sara', 'rev-2');
    await waitFor(() => expect(title).toHaveValue('Week one, renamed by Sara'));

    await userEvent.type(title, '!');
    await userEvent.click(screen.getByTestId('module-builder-save'));

    await waitFor(() => expect(saveModuleStructure).toHaveBeenCalled());
    expect(lastExpectedRevision()).toBe('rev-2');
  });

  it('keeps saving against its own revision while it is holding unsaved edits', async () => {
    // The state this guards against is {revision: theirs, weeks: mine}. Taking
    // their revision without their weeks would make this save legal at the
    // endpoint, and it would replace their work without a word. Holding the
    // local revision is what turns it into the 409 the banner already offers a
    // way out of.
    const title = await openWorkspace();
    await userEvent.clear(title);
    await userEvent.type(title, 'My unsaved week');

    await saveArrivesFromElsewhere('Week one, renamed by Sara', 'rev-2');
    expect(await screen.findByRole('button', { name: 'Load their version' })).toBeInTheDocument();

    await userEvent.click(screen.getByTestId('module-builder-save'));

    await waitFor(() => expect(saveModuleStructure).toHaveBeenCalled());
    expect(lastExpectedRevision()).toBe('rev-1');
    const sent = (saveModuleStructure.mock.calls[0] as [string, { weekStructure: { title: string }[] }])[1];
    expect(sent.weekStructure[0].title).toBe('My unsaved week');
  });

  /** The placement drawer reporting that it has written the module. */
  async function drawerSaves(weekTitle: string, revision: string) {
    loadModuleStructure.mockResolvedValue(storedStructure(weekTitle, revision));
    await userEvent.click(screen.getAllByTestId('drawer-saved')[0]);
  }

  it('takes the drawer write whole when there is nothing unsaved to weigh', async () => {
    const title = await openWorkspace();

    await drawerSaves('Week one, as the drawer stored it', 'rev-2');

    await waitFor(() => expect(title).toHaveValue('Week one, as the drawer stored it'));
    await userEvent.type(title, '!');
    await userEvent.click(screen.getByTestId('module-builder-save'));
    // Content and revision arrived from one read, so the save names the version
    // it is genuinely built on.
    await waitFor(() => expect(saveModuleStructure).toHaveBeenCalled());
    expect(lastExpectedRevision()).toBe('rev-2');
  });

  it('never puts the drawer revision on unsaved weeks', async () => {
    // The bad state this closes: {revision: the drawer's, weeks: the reader's}.
    // The workspace used to merge exactly that -- remote revision, local weeks
    // -- which made the next save legal at the endpoint and let it replace
    // whatever the drawer had just written, silently.
    const title = await openWorkspace();
    await userEvent.clear(title);
    await userEvent.type(title, 'My unsaved week');

    await drawerSaves('Week one, as the drawer stored it', 'rev-2');

    expect(await screen.findByRole('button', { name: 'Load their version' })).toBeInTheDocument();
    expect(title).toHaveValue('My unsaved week');

    await userEvent.click(screen.getByTestId('module-builder-save'));

    await waitFor(() => expect(saveModuleStructure).toHaveBeenCalled());
    expect(lastExpectedRevision()).toBe('rev-1');
  });
});
