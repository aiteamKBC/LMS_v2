import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { CurriculumModule, CurriculumProgramme } from '@/lib/curriculumApi';

/**
 * The Module Builder under an archived programme.
 *
 * `PATCH /curriculum/modules/<id>/structure/` refuses the save for a module
 * that is still visible under an archived programme, exactly as the Edit drawer
 * refuses `PATCH /curriculum/modules/<id>/`: saving would re-derive
 * `is_programme_deleted` from the archived programme and withdraw the module
 * from every list while reporting itself saved.
 *
 * The backend is what enforces that. These cover the UX half — the reader must
 * not author a whole module before the Save tells them, and a refusal must
 * never cost them the work they have already done.
 */

const reload = vi.fn(async () => null);
const saveModuleStructure = vi.fn();
const loadModuleStructure = vi.fn();

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

/**
 * `visibility: 'all'`, which is how the Builder reads programmes, so an
 * archived programme is in the list to be recognised rather than simply absent.
 */
const programmes = [
  { id: 'program-live', sourceId: 'PROG-LIVE', name: 'Live Programme', status: 'active', isArchived: false },
  { id: 'program-dead', sourceId: 'PROG-DEAD', name: 'Dead Programme', status: 'archived', isArchived: true },
] as CurriculumProgramme[];

const modules = [
  {
    id: 'MOD-ARCHIVED-PARENT',
    moduleCatalogueId: 'MOD-ARCHIVED-PARENT',
    name: 'Module Under Archive',
    programme: 'Dead Programme',
    programmeId: 'PROG-DEAD',
    status: 'published',
  },
  {
    id: 'MOD-LIVE-PARENT',
    moduleCatalogueId: 'MOD-LIVE-PARENT',
    name: 'Module Under Live',
    programme: 'Live Programme',
    programmeId: 'PROG-LIVE',
    status: 'published',
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
  fetchCurriculumTutors: vi.fn(async () => []),
  fetchCurriculumTeamsMeetingSummaries: vi.fn(async () => []),
  fetchCurriculumOverview: vi.fn(async () => ({ programmes, cohorts: [], groups: [], modules })),
  fetchCurriculumHolidays: vi.fn(async () => []),
}));

/** A module structure with real authored content the Builder must keep showing. */
function structureFor(catalogueId: string, programmeId: string, programmeName: string) {
  return {
    id: catalogueId,
    catalogueId,
    title: catalogueId === 'MOD-ARCHIVED-PARENT' ? 'Module Under Archive' : 'Module Under Live',
    programmeId,
    programmeName,
    programme: programmeName,
    status: 'published',
    weeks: 2,
    weeksNumber: 2,
    sessionsNumber: 2,
    isProgrammeDeleted: false,
    moduleKsbMappings: [],
    weekStructure: [
      {
        id: 'WEEK-ONE',
        moduleId: catalogueId,
        weekNumber: 1,
        title: 'Authored Week One',
        description: '',
        ksbMappings: [],
        components: [
          {
            id: 'COMP-ONE',
            moduleId: catalogueId,
            weekId: 'WEEK-ONE',
            type: 'reading',
            title: 'Authored Reading',
            description: '',
            expectedOtjh: 2.5,
            points: 0,
            ksbMappings: [],
            settings: {},
          },
        ],
      },
      {
        id: 'WEEK-TWO',
        moduleId: catalogueId,
        weekNumber: 2,
        title: 'Authored Week Two',
        description: '',
        ksbMappings: [],
        components: [],
      },
    ],
  };
}

// The deep-link effect reads window.location.search rather than the router.
async function openBuilderOn(moduleId: string) {
  const search = `?module=${moduleId}`;
  window.history.replaceState({}, '', `/curriculum/module-builder${search}`);
  const { default: ModuleBuilder } = await import('../page');
  const view = render(
    <MemoryRouter initialEntries={[`/curriculum/module-builder${search}`]}>
      <ModuleBuilder />
    </MemoryRouter>,
  );
  await waitFor(() => expect(loadModuleStructure).toHaveBeenCalledWith(moduleId, { skipCache: true }));
  await screen.findByText('Authored Week One');
  return view;
}

const ARCHIVED_NOTICE = 'This module belongs to an archived programme. Restore the programme, or move the module to a live programme, before editing its structure.';

describe('Module Builder under an archived programme', { timeout: 20000 }, () => {
  beforeEach(() => {
    reload.mockClear();
    saveModuleStructure.mockReset();
    loadModuleStructure.mockReset();
    loadModuleStructure.mockImplementation(async (id: string) => (
      id === 'MOD-ARCHIVED-PARENT'
        ? structureFor('MOD-ARCHIVED-PARENT', 'PROG-DEAD', 'Dead Programme')
        : structureFor('MOD-LIVE-PARENT', 'PROG-LIVE', 'Live Programme')
    ));
  });

  afterEach(() => {
    window.history.replaceState({}, '', '/');
  });

  it('opens a module under an archived programme read-only, with everything still shown', async () => {
    // Case E. The structure has to stay fully inspectable -- weeks, components
    // and OTJH are exactly what the reader opened the module to look at -- while
    // nothing about it can be changed and Save is off.
    await openBuilderOn('MOD-ARCHIVED-PARENT');

    expect(await screen.findByText(ARCHIVED_NOTICE)).toBeInTheDocument();
    // Nothing was cleared or replaced.
    expect(screen.getByText('Authored Week One')).toBeInTheDocument();
    expect(screen.getByText('Authored Week Two')).toBeInTheDocument();

    const structure = screen.getByTestId('module-builder-structure');
    expect(structure).toBeDisabled();
    // One fieldset is what makes it read-only, so every control inside it is
    // disabled rather than each panel having to opt in.
    expect(within(structure).getByRole('button', { name: 'Week' })).toBeDisabled();

    const save = screen.getByTestId('module-builder-save');
    expect(save).toBeDisabled();
    expect(screen.getByText('Read-only — archived programme')).toBeInTheDocument();

    fireEvent.click(save);
    expect(saveModuleStructure).not.toHaveBeenCalled();
  });

  it('leaves a module under a live programme fully editable', async () => {
    // Case F. The guard must only catch the archived case.
    await openBuilderOn('MOD-LIVE-PARENT');

    expect(screen.queryByText(ARCHIVED_NOTICE)).not.toBeInTheDocument();

    const structure = screen.getByTestId('module-builder-structure');
    expect(structure).not.toBeDisabled();
    expect(screen.getByTestId('module-builder-save')).toBeEnabled();

    // And an edit really does land.
    fireEvent.click(within(structure).getByRole('button', { name: 'Week' }));
    await waitFor(() => expect(screen.getByText('Unsaved changes')).toBeInTheDocument());
  });

  it('keeps unsaved work when the backend rejects the save because the programme became archived', async () => {
    // Case G. The programme can be archived by someone else while the Builder is
    // already open, so the frontend guard cannot be the only one -- the 400 is
    // what stops it. What must not happen is the reader losing the weeks and
    // components they authored in the meantime.
    const { CurriculumApiError } = await import('@/lib/curriculumApi');
    saveModuleStructure.mockRejectedValue(
      new CurriculumApiError(
        'Curriculum API returned 400 for /curriculum/modules/MOD-LIVE-PARENT/structure/: Bad Request',
        400,
        '/curriculum/modules/MOD-LIVE-PARENT/structure/',
        { error: '"Module Under Live" belongs to an archived programme, so saving it would withdraw it from every list. Restore the programme, or move the module to a live one, before editing it.' },
      ),
    );

    await openBuilderOn('MOD-LIVE-PARENT');

    const structure = screen.getByTestId('module-builder-structure');
    fireEvent.click(within(structure).getByRole('button', { name: 'Week' }));
    await waitFor(() => expect(screen.getByText('Unsaved changes')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('module-builder-save'));
    await waitFor(() => expect(saveModuleStructure).toHaveBeenCalled());

    // The backend's own sentence, not the "Curriculum API returned 400" wrapper.
    expect(await screen.findByText(/belongs to an archived programme/)).toBeInTheDocument();
    // Local work survived: the authored weeks are all still there, including the
    // one added after the Builder was opened, and the module is still dirty.
    expect(screen.getByText('Authored Week One')).toBeInTheDocument();
    expect(screen.getByText('Authored Week Two')).toBeInTheDocument();
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    // Nothing refetched over the top of it either.
    expect(reload).not.toHaveBeenCalled();
    expect(loadModuleStructure).toHaveBeenCalledTimes(1);
  });
});
