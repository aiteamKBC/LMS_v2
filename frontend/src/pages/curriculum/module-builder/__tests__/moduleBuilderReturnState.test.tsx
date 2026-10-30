import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { CurriculumCohort, CurriculumGroup, CurriculumModule, CurriculumProgramme } from '@/lib/curriculumApi';
import { fetchCurriculumDeliveryScope } from '@/lib/curriculumApi';

/**
 * Back from a learner's progress page is one step in history, so everything the
 * reader had set on the catalogue has to live in its address: the programme,
 * cohort, group and tutor filters, the search text and the open learner list.
 */

vi.mock('@/api/assignedLearners', () => ({
  fetchAssignedCounts: vi.fn(async (_scope: string, ids: string[]) => ({ counts: Object.fromEntries(ids.map(id => [id, 1])) })),
  fetchAssignedLearners: vi.fn(async () => ({ scope: 'module', id: 'MOD-1', status: 'active', total: 1, filteredTotal: 1, page: 1, pageSize: 25,
    learners: [{ id: 'learner-1', name: 'A Learner', email: 'learner@example.com', status: 'active' }] })),
}));

const fetchLearnerAssignments = vi.fn();
const fetchCurriculumScopeLearnerKsbImpact = vi.fn();
const reloadModules = vi.fn(async () => null);
// The module list's loading flag, as a store the mocked hook subscribes to, so
// a test can finish the slow read after the delivery scope has landed.
const modulesStore = vi.hoisted(() => {
  let loading = false;
  const listeners = new Set<() => void>();
  return {
    read: () => loading,
    set(value: boolean) { loading = value; listeners.forEach(listener => listener()); },
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
});

vi.mock('@/api/curriculumLearnerAssignments', async importOriginal => ({
  ...(await importOriginal<typeof import('@/api/curriculumLearnerAssignments')>()),
  fetchLearnerAssignments: (...args: unknown[]) => fetchLearnerAssignments(...args),
}));
vi.mock('@/components/feature/WorkspaceShell', () => ({
  WorkspaceShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ auth: null }) }));
vi.mock('@/components/feature/CurriculumSweetAlert', () => ({
  showCurriculumAlert: vi.fn(async () => undefined),
  showCurriculumConfirm: vi.fn(async () => undefined),
  showCurriculumLoading: vi.fn(),
  closeCurriculumLoading: vi.fn(),
}));
vi.mock('@/pages/curriculum/shared/entities/moduleForm', () => ({ ModuleFormDrawer: () => null }));
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
const cohorts = [{ id: 'COHORT-1', name: 'Sept 2026', programmeId: 'PROG-DATA', programme: 'Data Analyst' }] as CurriculumCohort[];
const groups = [{ id: 'GROUP-1', name: 'Group A', cohortId: 'COHORT-1', cohort: 'Sept 2026', programmeId: 'PROG-DATA', programme: 'Data Analyst' }] as CurriculumGroup[];
const modules = [
  {
    id: 'MOD-1', moduleCatalogueId: 'MOD-1', name: 'Data Foundations', programme: 'Data Analyst', programmeId: 'PROG-DATA',
    cohortId: 'COHORT-1', cohort: 'Sept 2026', groupId: 'GROUP-1', group: 'Group A', tutor: 'Tutor One',
    weeks: 6, sessionsNumber: 6, status: 'published',
  },
  {
    id: 'MOD-3', moduleCatalogueId: 'MOD-3', name: 'Data Storytelling', programme: 'Data Analyst', programmeId: 'PROG-DATA',
    cohortId: 'COHORT-1', cohort: 'Sept 2026', groupId: 'GROUP-1', group: 'Group A', tutor: 'Tutor One',
    weeks: 4, sessionsNumber: 4, status: 'published',
  },
  {
    id: 'MOD-2', moduleCatalogueId: 'MOD-2', name: 'Network Basics', programme: 'Network Engineer', programmeId: 'PROG-NET',
    cohortId: 'COHORT-2', cohort: 'Jan 2027', groupId: 'GROUP-2', group: 'Group B', tutor: '', weeks: 4, sessionsNumber: 4, status: 'draft',
  },
] as CurriculumModule[];

vi.mock('@/hooks/useCurriculumModules', async () => {
  const { useSyncExternalStore } = await import('react');
  return {
    useCurriculumModules: () => {
      const loading = useSyncExternalStore(modulesStore.subscribe, modulesStore.read);
      return { modules: loading ? [] : modules, loading, error: null, reload: reloadModules };
    },
  };
});
vi.mock('@/hooks/useCurriculumProgrammes', () => ({
  useCurriculumProgrammes: () => ({ programmes, loading: false, error: null, reload: vi.fn() }),
}));
vi.mock('@/hooks/useCurriculumKsbSets', () => ({
  useCurriculumKsbSets: () => ({ ksbSets: [], loading: false, error: null, reload: vi.fn() }),
}));
vi.mock('@/lib/curriculumApi', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/curriculumApi')>()),
  fetchCurriculumStandards: vi.fn(async () => []),
  fetchCurriculumTutors: vi.fn(async () => [{ id: 1, name: 'Tutor One' }]),
  fetchCurriculumTeamsMeetingSummaries: vi.fn(async () => []),
  fetchCurriculumOverview: vi.fn(async () => ({ programmes, cohorts, groups, modules })),
  fetchCurriculumDeliveryScope: vi.fn(async () => ({ cohorts, groups })),
  fetchCurriculumHolidays: vi.fn(async () => []),
  fetchCurriculumScopeLearnerKsbImpact: (...args: unknown[]) => fetchCurriculumScopeLearnerKsbImpact(...args),
}));

function AddressProbe() {
  const location = useLocation();
  return <output data-testid="address">{location.search}</output>;
}

async function renderCatalogue(search = '') {
  window.history.replaceState({}, '', `/curriculum/module-builder${search}`);
  const { default: ModuleBuilder } = await import('../page');
  const router = createMemoryRouter([{ path: '*', element: <><ModuleBuilder /><AddressProbe /></> }], {
    initialEntries: [`/curriculum/module-builder${search}`],
  });
  const result = render(<RouterProvider router={router} />);
  return { ...result, router };
}

function address() {
  return new URLSearchParams(screen.getByTestId('address').textContent || '');
}

describe('Module Builder keeps the reader\'s place in its address', { timeout: 15000 }, () => {
  beforeEach(() => {
    modulesStore.set(false);
    vi.mocked(fetchCurriculumDeliveryScope).mockClear();
    fetchLearnerAssignments.mockReset().mockResolvedValue({
      target: { scope: 'module', id: 'MOD-1', name: 'Data Foundations', moduleCount: 1, programmeName: 'Data Analyst' },
      learners: [{ id: 'learner-1', name: 'A Learner', email: 'learner@example.com', programme: 'Data Analyst', company: '', cohort: 'Sept 2026', group: 'Group A', programmeStatus: 'active', learnerType: 'apprentice', assigned: true, moduleCount: 1 }],
      totals: { learnerCount: 1, assignedCount: 1 },
    });
    fetchCurriculumScopeLearnerKsbImpact.mockReset().mockResolvedValue({
      assignedLearnerCount: 1,
      assignedLearners: [{ id: 'learner-1', name: 'A Learner', email: 'learner@example.com', programme: 'Data Analyst', programmeStatus: 'active', cohort: 'Sept 2026', group: 'Group A', lifecycleStatus: 'active' }],
      otjhAchievement: { achievedTotal: 2, plannedTotal: 4, learners: [] },
      ksbAchievement: { achievedWeightTotal: 1, expectedWeightTotal: 2 },
      learnerKsbConsumption: [],
    });
  });

  afterEach(() => {
    window.history.replaceState({}, '', '/');
  });

  it('can return to all programmes after selecting a programme repeatedly', async () => {
    const user = userEvent.setup();
    await renderCatalogue();
    await screen.findByText('Network Basics');

    for (const programme of ['Data Analyst', 'Network Engineer']) {
      await user.click(screen.getByLabelText('Programme'));
      await user.click(screen.getByRole('option', { name: programme }));
      await waitFor(() => expect(address().get('programme')).toBe(programme));
      expect(screen.getAllByRole('article')).toHaveLength(programme === 'Data Analyst' ? 2 : 1);

      await user.click(screen.getByLabelText('Programme'));
      await user.click(screen.getByRole('option', { name: 'All programmes' }));
      await waitFor(() => expect(screen.getByLabelText('Programme')).toHaveTextContent('All programmes'));
      expect(address().has('programme')).toBe(false);
      expect(screen.getAllByRole('article')).toHaveLength(3);
    }
  });

  it.each(['programme', 'programmeId'])('clears a restored %s filter and its dependent filters with Reset', async key => {
    const user = userEvent.setup();
    const { unmount } = await renderCatalogue(`?${key}=PROG-DATA&programmeName=Data+Analyst&cohort=COHORT-1&group=GROUP-1&tutor=Tutor+One&q=Foundations`);
    await waitFor(() => expect(screen.getByLabelText('Group')).toHaveTextContent('Group A'));
    expect(screen.getByLabelText('Programme')).toHaveTextContent('Data Analyst');

    await user.click(screen.getByRole('button', { name: 'Reset' }));
    await waitFor(() => expect(screen.getByLabelText('Programme')).toHaveTextContent('All programmes'));
    for (const param of ['programme', 'programmeId', 'programmeName', 'cohort', 'group', 'tutor', 'q']) {
      expect(address().has(param)).toBe(false);
    }
    expect(screen.getByLabelText('Cohort')).toBeDisabled();
    expect(screen.getByLabelText('Group')).toBeDisabled();
    expect(screen.getAllByRole('article')).toHaveLength(3);

    const clearedSearch = address().toString();
    unmount();
    await renderCatalogue(clearedSearch ? `?${clearedSearch}` : '');
    await screen.findByText('Network Basics');
    expect(screen.getByLabelText('Programme')).toHaveTextContent('All programmes');
    expect(screen.getAllByRole('article')).toHaveLength(3);
  });

  it('returns with the same search, filters and learner list open', async () => {
    await renderCatalogue('?programme=Data+Analyst&cohort=COHORT-1&group=GROUP-1&tutor=Tutor+One&q=Foundations&learners=MOD-1');

    expect(await screen.findByRole('dialog', { name: 'Data Foundations learner progress' })).toBeInTheDocument();
    expect(fetchLearnerAssignments).toHaveBeenCalledWith(expect.objectContaining({ scope: 'module', id: 'MOD-1' }));
    expect(screen.getByPlaceholderText('Search modules, tutors, cohorts...')).toHaveValue('Foundations');
    expect(within(screen.getByLabelText('Programme')).getByText('Data Analyst')).toBeInTheDocument();
    expect(within(screen.getByLabelText('Cohort')).getByText('Sept 2026')).toBeInTheDocument();
    expect(within(screen.getByLabelText('Group')).getByText('Group A')).toBeInTheDocument();
    expect(screen.queryByText('Data Storytelling')).not.toBeInTheDocument();
    expect(screen.queryByText('Network Basics')).not.toBeInTheDocument();
  });

  it('keeps the cohort and group while the programme they belong to is still being restored', async () => {
    modulesStore.set(true);
    await renderCatalogue('?programme=Data+Analyst&cohort=COHORT-1&group=GROUP-1');
    await waitFor(() => expect(fetchCurriculumDeliveryScope).toHaveBeenCalled());
    // The delivery scope lands before the module list, as it can on a slow read.
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });

    act(() => modulesStore.set(false));
    await screen.findByText('Data Foundations');
    await waitFor(() => expect(within(screen.getByLabelText('Group')).getByText('Group A')).toBeInTheDocument());
    expect(within(screen.getByLabelText('Cohort')).getByText('Sept 2026')).toBeInTheDocument();
  });

  it('writes the search and the open learner list to the address, and clears them again', async () => {
    const user = userEvent.setup();
    await renderCatalogue();
    await screen.findByText('Data Foundations');

    await user.type(screen.getByPlaceholderText('Search modules, tutors, cohorts...'), 'Foundations');
    await waitFor(() => expect(address().get('q')).toBe('Foundations'));

    const card = screen.getByText('Data Foundations').closest('article')!;
    await user.click(within(card).getByRole('button', { name: /Data Foundations: .* active assigned learners/ }));
    await screen.findByRole('dialog', { name: /Data Foundations.*Assigned learners/ });
    expect(fetchCurriculumScopeLearnerKsbImpact).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Assignments & progress' }));
    await screen.findByRole('dialog', { name: 'Data Foundations learner progress' });
    await waitFor(() => expect(address().get('learners')).toBe('MOD-1'));
    // Each change replaces the current entry: Back still leaves in one step.
    expect(address().get('q')).toBe('Foundations');

    await user.click(screen.getByRole('button', { name: 'Close learner progress' }));
    await waitFor(() => expect(address().has('learners')).toBe(false));
    expect(address().get('q')).toBe('Foundations');
  });

  it('drops a learner list the catalogue no longer lists', async () => {
    await renderCatalogue('?learners=MOD-GONE');
    await screen.findByText('Data Foundations');
    await waitFor(() => expect(address().has('learners')).toBe(false));
    expect(fetchLearnerAssignments).not.toHaveBeenCalled();
  });
});
