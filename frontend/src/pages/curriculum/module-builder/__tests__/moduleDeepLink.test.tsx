import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { CurriculumModule, CurriculumProgramme } from '@/lib/curriculumApi';

/**
 * The `?module=` deep link, which is how the Group and Module workspaces hand a
 * module over to the Module Builder for authoring.
 *
 * `?module=` carries the id, and the id is the only thing that opens a module.
 * `?moduleTitle=` is a label for the not-found message, not a lookup key:
 * titles are not unique (the same title is authored in more than one
 * programme), so resolving by name can only guess, and a wrong guess opens
 * another module's weeks and OTJH under the name the reader clicked.
 *
 * The link also used to double as the structure wizard's hand-off — an unknown
 * title fell through to "create it from the other query parameters" — so a link
 * meant to open a record could silently write one instead. The wizard is gone
 * and so is that branch: an unknown module now says so and creates nothing.
 */

const reload = vi.fn(async () => null);
const loadModuleStructure = vi.fn(async () => null);
const createNewModule = vi.fn(async () => {
  throw new Error('createNewModule must not be called by a deep link');
});

// The workspace reads the signed-in account. Without this the page throws on
// its first line and every case below fails before it asserts anything.
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ auth: { account: { role: 'curriculum' } } }),
}));

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
  { id: 'program-mm', sourceId: 'PROG-MM', name: 'Marketing Manager' },
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
  // Two distinct modules in two programmes that happen to share a title. Real
  // data has exactly this pair, and the draft is the one that sorts first:
  // sortCatalogueOptionsForPicker ranks drafts ahead of published modules, so
  // the namesake is reached before the module a ?module= id actually names.
  {
    id: 'MOD-202608229DBEB6F2ACA5',
    moduleCatalogueId: 'MOD-202608229DBEB6F2ACA5',
    name: 'Social Media Marketing',
    programme: 'Marketing Manager',
    programmeId: 'PROG-MM',
    status: 'draft',
  },
  {
    id: 'MOD-20260911122630872014',
    moduleCatalogueId: 'MOD-20260911122630872014',
    name: 'Social Media Marketing',
    programme: 'Data Analyst',
    programmeId: 'PROG-DATA',
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
      <AddressProbe />
    </MemoryRouter>,
  );
}

/** Reports the router's own query string, which is what a reload would replay. */
function AddressProbe() {
  const location = useLocation();
  const navigate = useNavigate();
  return <>
    <output data-testid="address" data-history-key={location.key}>{location.search}</output>
    <button type="button" onClick={() => navigate(-1)}>Test browser Back</button>
  </>;
}

function address() {
  return new URLSearchParams(screen.getByTestId('address').textContent || '');
}

function historyKey() {
  return screen.getByTestId('address').dataset.historyKey || '';
}

describe('Module Builder deep links', { timeout: 15000 }, () => {
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
    // openModule ran against the canonical id. Read uncached: the workspace
    // replaces the whole structure on save, so it may only open the current one.
    await waitFor(() => expect(loadModuleStructure).toHaveBeenCalledWith('MOD-20260818112738930447', { skipCache: true }));
    expect(createNewModule).not.toHaveBeenCalled();
  });

  it('opens the id a ?module= link names, not a namesake the ?moduleTitle= also matches', async () => {
    // Both params are always sent together by the programme modules table. The
    // id is the only thing that tells two same-titled modules apart, so it has
    // to win outright -- otherwise the row reading 240h30m opens a namesake
    // whose own components add up to 24h32m.
    await renderAt('?module=MOD-20260911122630872014&moduleTitle=Social%20Media%20Marketing');
    await waitFor(() => expect(loadModuleStructure).toHaveBeenCalledWith('MOD-20260911122630872014', { skipCache: true }));
    // Asserted on the ids alone: the call now carries a second argument, so a
    // `not.toHaveBeenCalledWith(id)` would pass for any id at all.
    const requestedIds = (loadModuleStructure.mock.calls as unknown as unknown[][]).map(call => call[0]);
    expect(requestedIds).not.toContain('MOD-202608229DBEB6F2ACA5');
    expect(createNewModule).not.toHaveBeenCalled();
  });

  it('puts the module it opens in the address and adds one Back step to the filtered catalogue', async () => {
    // The workspace used to live in component state alone. Reload, Back, or a
    // restored tab all landed on the catalogue, and someone who had been
    // authoring for an hour was shown a module list instead of their module.
    // openModule refuses to open a module whose stored structure could not be
    // read -- see the guard it protects -- so the read has to answer here.
    loadModuleStructure.mockResolvedValueOnce({ weekStructure: [] } as never);
    // Scoped to the programme with exactly one module, so the card clicked is
    // not decided by how the catalogue happens to sort two of them.
    await renderAt('?programme=Marketing+Manager');
    expect(address().get('module')).toBeNull();
    const catalogueHistoryKey = historyKey();

    await userEvent.click(await screen.findByRole('button', { name: 'Edit components' }));

    await waitFor(() => expect(address().get('module')).toBe('MOD-202608229DBEB6F2ACA5'));
    expect(historyKey()).not.toBe(catalogueHistoryKey);

    await userEvent.click(screen.getByRole('button', { name: 'Test browser Back' }));
    await waitFor(() => expect(address().get('module')).toBeNull());
    await waitFor(() => expect(screen.getByText('Module catalogue')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Back to modules' })).not.toBeInTheDocument();
  });

  it('takes the module back out of the address when the reader leaves it', async () => {
    // Or a reload from the catalogue would re-open the module just left.
    loadModuleStructure.mockResolvedValueOnce({ weekStructure: [] } as never);
    await renderAt('?module=MOD-20260818112738930447');
    await waitFor(() => expect(loadModuleStructure).toHaveBeenCalled());

    await userEvent.click(await screen.findByRole('button', { name: 'Back to modules' }));

    await waitFor(() => expect(address().get('module')).toBeNull());
  });

  it('reports a dead id instead of resolving it by title', async () => {
    // The title would match a real module here. Opening it anyway is a guess,
    // and a wrong guess shows another module's weeks and OTJH under the name
    // the reader clicked -- so an unmatched id is reported, never substituted.
    await renderAt('?module=MOD-NOT-IN-CATALOGUE&moduleTitle=Data%20Foundations');
    expect(await screen.findByText('Unable to find module "Data Foundations" (MOD-NOT-IN-CATALOGUE) in Module Builder.'))
      .toBeInTheDocument();
    expect(loadModuleStructure).not.toHaveBeenCalled();
    expect(createNewModule).not.toHaveBeenCalled();
  });

  it('does not open a module by title alone', async () => {
    await renderAt('?moduleTitle=Data%20Foundations');
    expect(await screen.findByText('Unable to find module "Data Foundations" in Module Builder.')).toBeInTheDocument();
    expect(loadModuleStructure).not.toHaveBeenCalled();
  });

  it('reports an unknown ?moduleTitle= instead of creating a module for it', async () => {
    await renderAt('?moduleTitle=Ghost%20Module&sessionsNumber=4&programme=Data%20Analyst');
    expect(await screen.findByText('Unable to find module "Ghost Module" in Module Builder.')).toBeInTheDocument();
    expect(createNewModule).not.toHaveBeenCalled();
  });
});
