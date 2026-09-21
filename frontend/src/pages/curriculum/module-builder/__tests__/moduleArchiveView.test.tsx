import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { CurriculumArchivedModule, CurriculumCohort, CurriculumGroup, CurriculumModule, CurriculumProgramme } from '@/lib/curriculumApi';

/**
 * The module archive, from the catalogue.
 *
 * Deleting a module has always been an archive on the server -- the row keeps
 * its weeks, components and KSB mappings and is stamped `deleted_at` -- and the
 * restore endpoint has been there the whole time. What went missing in a merge
 * was the only way to reach it: the "View archive" button, the archived list and
 * its Restore. A module archived by accident was then unrecoverable from the
 * product, which is what this test exists to catch.
 *
 * So the three things asserted here are the three that disappeared: the row
 * action says archive rather than delete, the archive is reachable and lists
 * what is in it, and Restore actually calls the restore endpoint.
 */

const reload = vi.fn(async () => null);
const fetchArchivedCurriculumModules = vi.fn(async (): Promise<CurriculumArchivedModule[]> => archived);
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

async function renderCatalogue() {
  window.history.replaceState({}, '', '/curriculum/module-builder');
  const { default: ModuleBuilder } = await import('../page');
  const result = render(
    <MemoryRouter initialEntries={['/curriculum/module-builder']}>
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

  it('reads nothing until the archive is opened, then lists what is in it', async () => {
    await renderCatalogue();
    expect(fetchArchivedCurriculumModules).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: /view archive/i }));

    expect(await screen.findByText('Project Management Professional')).toBeInTheDocument();
    // What a restore would bring back, said before the click rather than after.
    expect(screen.getByText('34 weeks')).toBeInTheDocument();
    expect(screen.getByText('601 components')).toBeInTheDocument();
    expect(fetchArchivedCurriculumModules).toHaveBeenCalledTimes(1);
  });

  it('restores the archived module and refreshes the catalogue behind it', async () => {
    await renderCatalogue();
    await userEvent.click(screen.getByRole('button', { name: /view archive/i }));
    await screen.findByText('Project Management Professional');
    reload.mockClear();

    await userEvent.click(screen.getByRole('button', { name: /restore module/i }));

    await waitFor(() => expect(restoreCurriculumModule).toHaveBeenCalledWith('MOD-ARCHIVED'));
    // The module is back in the catalogue, so the list behind the archive has
    // to be re-read as well as the archive itself.
    await waitFor(() => expect(reload).toHaveBeenCalled());
    expect(fetchArchivedCurriculumModules).toHaveBeenCalledTimes(2);
  });
});
