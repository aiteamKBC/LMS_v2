import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { CurriculumArchivedModule, CurriculumCohort, CurriculumGroup, CurriculumModule, CurriculumProgramme } from '@/lib/curriculumApi';

/**
 * Archiving a module, from the catalogue.
 *
 * Deleting a module has always been an archive on the server -- the row keeps
 * its weeks, components and KSB mappings and is stamped `deleted_at` -- so the
 * row action has to say so, which is the first case below.
 *
 * Reading that archive back is no longer this page's job. The catalogue used to
 * carry its own "View archive" toggle over the same records the Curriculum
 * archive shows, and two views of one archive is how the two drift; the toggle
 * was removed and the archive page is the only one. The second case holds that
 * line: the catalogue offers no archive view and reads no archive payload. That
 * the archive is still reachable, and that Restore still works, is asserted
 * where it now lives -- `pages/curriculum/archive/__tests__/archivePage.test.tsx`.
 */

const reload = vi.fn(async () => null);
const fetchArchivedCurriculumModules = vi.fn(async (): Promise<CurriculumArchivedModule[]> => archived);
// Still wired into the module mock so an accidental restore from this page
// would be a visible call rather than a network error swallowed by the test.
const restoreCurriculumModule = vi.fn(async () => ({ restored: true, id: 'MOD-ARCHIVED' }));

// The workspace reads the signed-in account. Without this the page throws on
// its first line and every case below fails before it asserts anything.
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ auth: { account: { role: 'curriculum' } } }),
}));

vi.mock('@/components/feature/WorkspaceShell', () => ({
  WorkspaceShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

// Every confirm in this page runs its work from `onConfirm`, so the dialog is
// answered "yes" here rather than stubbed out -- otherwise Restore would be
// clicked and nothing behind it would ever run.
vi.mock('@/components/feature/CurriculumSweetAlert', () => ({
  showCurriculumAlert: vi.fn(async () => undefined),
  showCurriculumConfirm: vi.fn(async (options: { onConfirm?: () => Promise<void> | void }) => {
    await options.onConfirm?.();
    return true;
  }),
  showCurriculumLoading: vi.fn(),
  closeCurriculumLoading: vi.fn(),
}));

vi.mock('@/pages/curriculum/shared/entities/moduleForm', () => ({
  ModuleFormDrawer: () => null,
}));

vi.mock('@/pages/curriculum/shared/components/weekAuthoringLazy', () => ({
  ComponentEditor: () => null,
  WeekComponentRail: () => null,
  WeekOverviewPanel: () => null,
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
    weeks: 6,
    sessionsNumber: 6,
    status: 'published',
  },
] as CurriculumModule[];

/** One module archived on its own, under a programme that is still live. */
const archived: CurriculumArchivedModule[] = [{
  id: 'MOD-ARCHIVED',
  catalogueId: 'MOD-ARCHIVED',
  title: 'Project Management Professional',
  programmeId: 'PROG-DATA',
  programme: 'Data Analyst',
  cohortId: 'COHORT-1',
  cohort: 'Sept 2026',
  groupId: 'GROUP-1',
  group: 'Group A',
  tutor: '',
  weeks: 34,
  sessions: 34,
  components: 601,
  status: 'archived',
  programmeArchived: false,
  archivedAt: '2026-09-16T10:17:28Z',
  archivedBy: 'module-delete',
  archivedViaParent: '',
}];

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
  fetchCurriculumOverview: vi.fn(async () => ({ programmes, cohorts, groups, modules })),
  fetchCurriculumHolidays: vi.fn(async () => []),
  fetchArchivedCurriculumModules: (...args: unknown[]) => fetchArchivedCurriculumModules(...(args as [])),
  restoreCurriculumModule: (...args: unknown[]) => restoreCurriculumModule(...(args as [])),
}));

async function renderCatalogue(route = '/curriculum/module-builder') {
  window.history.replaceState({}, '', route);
  const { default: ModuleBuilder } = await import('../page');
  const result = render(
    <MemoryRouter initialEntries={[route]}>
      <ModuleBuilder />
    </MemoryRouter>,
  );
  await screen.findByText('Data Foundations');
  return result;
}

describe('Module Builder archive', { timeout: 15000 }, () => {
  beforeEach(() => {
    reload.mockClear();
    fetchArchivedCurriculumModules.mockClear();
    restoreCurriculumModule.mockClear();
  });

  it('names the catalogue row action for what it does - archive, not delete', async () => {
    await renderCatalogue();
    const card = within(screen.getByText('Data Foundations').closest('article') as HTMLElement);
    expect(card.getByRole('button', { name: /archive module/i })).toBeInTheDocument();
    expect(card.queryByRole('button', { name: /delete module/i })).not.toBeInTheDocument();
  });

  it('shows no archive of its own, and never reads one', async () => {
    await renderCatalogue();

    expect(screen.queryByRole('button', { name: /view archive/i })).not.toBeInTheDocument();
    // The archived module in the fixture is real and still archived. Nothing on
    // this page may list it, and nothing here may fetch it: the Curriculum
    // archive is where it is read, and a second reader is a second view to drift.
    expect(screen.queryByText('Project Management Professional')).not.toBeInTheDocument();
    expect(fetchArchivedCurriculumModules).not.toHaveBeenCalled();
  });

  // `?view=archive` was the catalogue's own archive deep link. The audit trail
  // built it for an archived module and now points at the Curriculum archive
  // instead; an old bookmark must land on the plain catalogue, not a blank page.
  it('ignores the archive query the catalogue used to answer', async () => {
    await renderCatalogue('/curriculum/module-builder?view=archive&archiveModule=MOD-ARCHIVED');

    expect(await screen.findByText('Data Foundations')).toBeInTheDocument();
    expect(screen.queryByText('Project Management Professional')).not.toBeInTheDocument();
    expect(fetchArchivedCurriculumModules).not.toHaveBeenCalled();
  });
});
