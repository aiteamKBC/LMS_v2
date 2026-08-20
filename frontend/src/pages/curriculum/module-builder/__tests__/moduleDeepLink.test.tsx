import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { CurriculumModule, CurriculumProgramme } from '@/lib/curriculumApi';

/**
 * The `?module=` deep link, which is how the Group and Module workspaces hand a
 * module over to the Module Builder for authoring.
 *
 * `?moduleTitle=` is a *lookup* alias of the same link: find the module with
 * that title. It used to double as the structure wizard's hand-off — an unknown
 * title fell through to "create it from the other query parameters" — so a link
 * meant to open a record could silently write one instead. The wizard is gone
 * and so is that branch: an unknown module now says so and creates nothing.
 */

const reload = vi.fn(async () => null);
const loadModuleStructure = vi.fn(async () => null);
const createNewModule = vi.fn(async () => {
  throw new Error('createNewModule must not be called by a deep link');
});

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
  createNewModule: (...args: unknown[]) => createNewModule(...(args as [])),
}));

const programmes = [
  { id: 'program-data', sourceId: 'PROG-DATA', name: 'Data Analyst' },
] as CurriculumProgramme[];

const modules = [
  {
    id: 'MOD-20260818112738930447',
    moduleCatalogueId: 'MOD-20260818112738930447',
    name: 'Data Foundations',
    programme: 'Data Analyst',
    programmeId: 'PROG-DATA',
    cohortId: 'COHORT-1',
    cohort: 'Sept 2026',
    groupId: 'GROUP-1',
    group: 'Group A',
    tutor: 'Tutor One',
    sessionsNumber: 6,
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

// The deep-link effect reads window.location.search rather than the router, so
// the query string has to be on the jsdom URL, not just on MemoryRouter.
async function renderAt(search: string) {
  window.history.replaceState({}, '', `/curriculum/module-builder${search}`);
  const { default: ModuleBuilder } = await import('../page');
  return render(
    <MemoryRouter initialEntries={[`/curriculum/module-builder${search}`]}>
      <ModuleBuilder />
    </MemoryRouter>,
  );
}

describe('Module Builder deep links', () => {
  beforeEach(() => {
    createNewModule.mockClear();
    loadModuleStructure.mockClear();
  });

  afterEach(() => {
    window.history.replaceState({}, '', '/');
  });

  it('opens the module a ?module= link names', async () => {
    await renderAt('?module=MOD-20260818112738930447');
    // Reaching the authoring workspace means the catalogue row was resolved and
    // openModule ran against the canonical id.
    await waitFor(() => expect(loadModuleStructure).toHaveBeenCalledWith('MOD-20260818112738930447'));
    expect(createNewModule).not.toHaveBeenCalled();
  });

  it('reports an unknown ?moduleTitle= instead of creating a module for it', async () => {
    await renderAt('?moduleTitle=Ghost%20Module&sessionsNumber=4&programme=Data%20Analyst');
    expect(await screen.findByText('Unable to find module "Ghost Module" in Module Builder.')).toBeInTheDocument();
    expect(createNewModule).not.toHaveBeenCalled();
  });
});
