import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { CurriculumModule } from '@/lib/curriculumApi';

const fixtures = vi.hoisted(() => ({
  modules: [] as CurriculumModule[], loading: false, error: null as string | null,
  programmesLoading: false, programmesError: null as string | null,
  reload: vi.fn(), scope: vi.fn(), assignments: vi.fn(), structure: vi.fn(), confirm: vi.fn(),
}));
vi.mock('@/components/feature/WorkspaceShell', () => ({ WorkspaceShell: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ auth: null }) }));
vi.mock('@/components/feature/CurriculumSweetAlert', async original => ({ ...(await original<typeof import('@/components/feature/CurriculumSweetAlert')>()), showCurriculumConfirm: fixtures.confirm }));
vi.mock('@/hooks/useCurriculumModules', () => ({ useCurriculumModules: () => ({ ...fixtures }) }));
const programmes = [
  { id: 'P1', sourceId: 'P1', name: 'Programme One', color: '#2563eb' },
  { id: 'P2', sourceId: 'P2', name: 'Programme Two', color: '#0f766e' },
];
vi.mock('@/hooks/useCurriculumProgrammes', () => ({ useCurriculumProgrammes: () => ({ programmes, loading: fixtures.programmesLoading, error: fixtures.programmesError }) }));
vi.mock('@/hooks/useCurriculumKsbSets', () => ({ useCurriculumKsbSets: () => ({ ksbSets: [], loading: false, error: null }) }));
vi.mock('@/pages/curriculum/shared/entities/moduleForm', () => ({ ModuleFormDrawer: ({ open, module }: { open: boolean; module?: { id: string } }) => open ? <output data-testid="form-target">{module?.id || 'new'}</output> : null }));
vi.mock('@/pages/curriculum/shared/entities/LearnerAssignmentDrawer', () => ({ LearnerAssignmentDrawer: ({ target }: { target: { id: string } | null }) => target ? <output data-testid="learner-target">{target.id}</output> : null }));
vi.mock('@/api/curriculumLearnerAssignments', async original => ({ ...(await original<typeof import('@/api/curriculumLearnerAssignments')>()), fetchLearnerAssignments: fixtures.assignments }));
vi.mock('@/lib/curriculumApi', async original => ({
  ...(await original<typeof import('@/lib/curriculumApi')>()),
  fetchCurriculumDeliveryScope: fixtures.scope,
  fetchCurriculumTutors: vi.fn(async () => []),
  fetchCurriculumTeamsMeetingSummaries: vi.fn(async () => []),
  fetchCurriculumStandards: vi.fn(async () => []),
  fetchCurriculumHolidays: vi.fn(async () => []),
}));
vi.mock('@/pages/curriculum/week-builder/weekTemplateData', () => ({ fetchComponentPointsDefaults: vi.fn(async () => ({})), loadCurriculumScope: vi.fn(async () => ({ programmes: [], cohorts: [], groups: [] })) }));
vi.mock('@/pages/curriculum/module-builder/moduleAuthoringData', async original => ({ ...(await original<typeof import('../moduleAuthoringData')>()), loadModuleStructure: fixtures.structure }));

const row = (id: string, overrides: Partial<CurriculumModule> = {}) => ({
  id, moduleCatalogueId: id, name: 'Same title', programmeId: 'P1', programme: 'Programme One',
  cohortId: 'C1', cohort: 'Cohort One', groupId: 'G1', group: 'Group One',
  weeks: 0, sessionsNumber: 8, lessons: 0, totalOtjh: 0, status: 'draft', deliveryStatus: 'active',
  ...overrides,
} as CurriculumModule);
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; };
async function open() {
  const { default: Page } = await import('../page');
  return render(<MemoryRouter initialEntries={['/curriculum/module-builder']}><Page /></MemoryRouter>);
}
const card = (id: string) => within(screen.getByRole('article', { name: `Same title - ${id}` }));

describe('Module catalogue design and record scope', () => {
  beforeEach(() => {
    fixtures.modules = [row('M1'), row('M2', { programmeId: 'P2', programme: 'Programme Two', cohortId: 'C2', cohort: 'Cohort Two', groupId: 'G2', group: 'Group Two', status: 'published', deliveryStatus: 'not_started', weeks: 4, lessons: 2, totalOtjh: 1.5 })];
    fixtures.loading = false; fixtures.error = null;
    fixtures.programmesLoading = false; fixtures.programmesError = null;
    fixtures.confirm.mockReset().mockResolvedValue(undefined);
    fixtures.reload.mockReset().mockResolvedValue(undefined);
    fixtures.scope.mockReset().mockResolvedValue({
      cohorts: [{ id: 'C1', name: 'Cohort One', programmeId: 'P1' }, { id: 'C2', name: 'Cohort Two', programmeId: 'P2' }],
      groups: [{ id: 'G1', name: 'Group One', programmeId: 'P1', cohortId: 'C1' }, { id: 'G2', name: 'Group Two', programmeId: 'P2', cohortId: 'C2' }, { id: 'G2', name: 'Group Two', programmeId: 'P2', cohortId: 'C2' }],
    });
    fixtures.assignments.mockReset().mockResolvedValue({ learners: [] });
    fixtures.structure.mockReset().mockResolvedValue(null);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('keeps duplicate titles separate, preserves zeros, and counts activity independently of publication and filters', async () => {
    await open();
    const totals = screen.getByLabelText('Catalogue totals');
    await waitFor(() => expect(within(totals).getByText('Groups').nextElementSibling).toHaveTextContent('2'));
    expect(within(totals).getByText('Total modules').nextElementSibling).toHaveTextContent('2');
    expect(within(totals).getByText('Active modules').nextElementSibling).toHaveTextContent('1');
    expect(card('M1').getByText('0 weeks')).toBeInTheDocument();
    expect(card('M1').getByText('0 components')).toBeInTheDocument();
    expect(card('M1').getByText('0h OTJH')).toBeInTheDocument();
    expect(card('M1').getByText('active')).toBeInTheDocument();
    expect(card('M2').getByText('not started')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Search'), 'M2');
    expect(screen.queryByRole('article', { name: 'Same title - M1' })).not.toBeInTheDocument();
    expect(screen.getByText('1 of 2 shown')).toBeInTheDocument();
    expect(within(totals).getByText('Active modules').nextElementSibling).toHaveTextContent('1');
    expect(fixtures.structure).not.toHaveBeenCalled();
    expect(fixtures.assignments).not.toHaveBeenCalled();
  });

  it('retains the dependent filter cascade and clears child filters when programme changes', async () => {
    const user = userEvent.setup(); await open();
    expect(screen.getByRole('combobox', { name: 'Cohort' })).toBeDisabled();
    const choose = async (field: string, option: string) => { await user.click(screen.getByRole('combobox', { name: field })); await user.click(await screen.findByRole('option', { name: option })); };
    await choose('Programme', 'Programme One'); await choose('Cohort', 'Cohort One'); await choose('Group', 'Group One');
    expect(screen.getByText('1 of 2 shown')).toBeInTheDocument();
    await choose('Programme', 'Programme Two');
    expect(screen.getByRole('combobox', { name: 'Group' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Cohort' })).toHaveTextContent('All cohorts');
    expect(screen.queryByRole('article', { name: 'Same title - M1' })).not.toBeInTheDocument();
    expect(card('M2').getByText('M2')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^Reset$/ }));
    expect(screen.getByText('2 of 2 shown')).toBeInTheDocument();
  });

  it('retains shared catalogue deliveries and reads their statuses instead of an unplaced base row', async () => {
    fixtures.modules = [
      row('MOD-SHARED', { lessons: 8, groupId: '', group: '', cohortId: '', cohort: '', deliveryStatus: 'unknown' }),
      row('DELIVERY1', { moduleCatalogueId: 'MOD-SHARED', deliveryStatus: 'active' }),
    ];
    await open(); expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(card('MOD-SHARED').getByText('active')).toBeInTheDocument();
    expect(card('MOD-SHARED').getByRole('link', { name: 'Group One' })).toHaveAttribute('href', expect.stringContaining('/groups/G1'));
    expect(within(screen.getByLabelText('Catalogue totals')).getByText('Active modules').nextElementSibling).toHaveTextContent('1');
  });

  it('targets the clicked module for edit and leaves creation on the existing form', async () => {
    await open(); await userEvent.click(card('M2').getByRole('button', { name: 'Edit module' }));
    expect(screen.getByTestId('form-target')).toHaveTextContent('M2');
    expect(fixtures.structure).not.toHaveBeenCalled();
  });

  it('uses the existing creation workflow', async () => {
    await open(); await userEvent.click(screen.getByRole('button', { name: 'New module' }));
    expect(screen.getByTestId('form-target')).toHaveTextContent('new');
  });

  it('inherits programme colours by identity instead of module colours or duplicate titles', async () => {
    fixtures.modules[0].color = '#dc2626'; fixtures.modules[1].color = '#dc2626';
    await open();
    expect(screen.getByRole('article', { name: 'Same title - M1' })).toHaveStyle({ borderLeftColor: '#2563eb' });
    expect(screen.getByRole('article', { name: 'Same title - M2' })).toHaveStyle({ borderLeftColor: '#0f766e' });
  });

  it('uses the selected programme colour for a shared catalogue module', async () => {
    fixtures.modules = [
      row('MOD-SHARED', { groupId: '', group: '', cohortId: '', cohort: '', color: '#dc2626' }),
      row('D1', { moduleCatalogueId: 'MOD-SHARED' }),
      row('D2', { moduleCatalogueId: 'MOD-SHARED', programmeId: 'P2', programme: 'Programme Two', cohortId: 'C2', cohort: 'Cohort Two', groupId: 'G2', group: 'Group Two' }),
    ];
    await open();
    expect(screen.getByRole('article', { name: 'Same title - MOD-SHARED' })).toHaveStyle({ borderLeftColor: '#2563eb' });
    await userEvent.click(screen.getByRole('combobox', { name: 'Programme' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Programme Two' }));
    expect(screen.getByRole('article', { name: 'Same title - MOD-SHARED' })).toHaveStyle({ borderLeftColor: '#0f766e' });
    expect(fixtures.structure).not.toHaveBeenCalled();
  });

  it('opens learners using the selected module identity', async () => {
    await open(); await userEvent.click(card('M2').getByRole('button', { name: /Assign learners|Learners/ }));
    expect(fixtures.assignments).toHaveBeenCalledWith({ scope: 'module', id: 'M2', name: 'Same title' });
    expect(fixtures.structure).not.toHaveBeenCalled();
  });

  it('keeps the latest KSB selection when structure requests finish out of order', async () => {
    const { curriculumModuleToCatalogue } = await import('../moduleAuthoringData');
    const firstModule = { ...curriculumModuleToCatalogue(fixtures.modules[0]), title: 'First KSB selection' };
    const secondModule = { ...curriculumModuleToCatalogue(fixtures.modules[1]), title: 'Second KSB selection' };
    const first = deferred<typeof firstModule>(), second = deferred<typeof secondModule>();
    fixtures.structure.mockImplementation((id: string) => id === 'M1' ? first.promise : second.promise);
    await open(); await userEvent.click(card('M1').getByRole('button', { name: 'Review module KSBs' }));
    await userEvent.click(card('M2').getByRole('button', { name: 'Review module KSBs' }));
    await act(async () => { second.resolve(secondModule); await new Promise(r => setTimeout(r, 210)); });
    expect(fixtures.structure.mock.calls.map(call => call[0])).toEqual(['M1', 'M2']);
    expect(screen.getByRole('heading', { name: 'Second KSB selection' })).toBeInTheDocument();
    await act(async () => { first.resolve(firstModule); });
    expect(screen.getByRole('heading', { name: 'Second KSB selection' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'First KSB selection' })).not.toBeInTheDocument();
  });

  it('keeps archive confirmation and targets only the chosen module with the existing request', async () => {
    await open(); await userEvent.click(card('M2').getByRole('button', { name: 'Archive module' }));
    expect(fixtures.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Archive this module?', confirmButtonText: 'Yes, archive module' }));
    expect(fetch).not.toHaveBeenCalled();
    const confirmation = fixtures.confirm.mock.calls[0][0] as { onConfirm: () => Promise<void> };
    await act(async () => { await confirmation.onConfirm(); });
    expect(fetch).toHaveBeenCalledWith('/curriculum_api/curriculum/modules/M2/', expect.objectContaining({ method: 'DELETE' }));
    expect(screen.queryByRole('article', { name: 'Same title - M2' })).not.toBeInTheDocument();
    expect(screen.getByRole('article', { name: 'Same title - M1' })).toBeInTheDocument();
    expect(fixtures.reload).toHaveBeenCalledWith({ silent: true });
  });

  it('prevents overlapping archive confirmations and releases the lock after cancellation', async () => {
    const pending = deferred<void>(); fixtures.confirm.mockReturnValueOnce(pending.promise);
    await open(); await userEvent.click(card('M1').getByRole('button', { name: 'Archive module' }));
    await userEvent.click(card('M2').getByRole('button', { name: 'Archive module' }));
    expect(fixtures.confirm).toHaveBeenCalledTimes(1);
    await act(async () => { pending.resolve(); });
    await userEvent.click(card('M2').getByRole('button', { name: 'Archive module' }));
    expect(fixtures.confirm).toHaveBeenCalledTimes(2);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('ignores an older learner lookup after a different module was selected', async () => {
    fixtures.modules = [row('M1', { name: 'First module' }), row('M2', { name: 'Second module' })];
    const first = deferred<{ learners: [] }>(); fixtures.assignments.mockImplementation((target: { id: string }) => target.id === 'M1' ? first.promise : Promise.resolve({ learners: [] }));
    await open();
    await userEvent.click(within(screen.getByRole('article', { name: 'First module - M1' })).getByRole('button', { name: /^Learners/ }));
    await userEvent.click(within(screen.getByRole('article', { name: 'Second module - M2' })).getByRole('button', { name: /^Learners/ }));
    expect(await screen.findByRole('dialog', { name: 'Second module learner progress' })).toBeInTheDocument();
    await act(async () => { first.resolve({ learners: [] }); });
    expect(fixtures.assignments.mock.calls.map(call => call[0].id)).toEqual(['M1', 'M2']);
    expect(screen.getByRole('dialog', { name: 'Second module learner progress' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'First module learner progress' })).not.toBeInTheDocument();
  });

  it('opens the learners dialog for an empty module and adds learners from it', async () => {
    await open(); await userEvent.click(card('M1').getByRole('button', { name: 'Learners' }));
    const dialog = await screen.findByRole('dialog', { name: 'Same title learner progress' });
    expect(within(dialog).getByText('No learners are assigned to this module yet.')).toBeInTheDocument();
    expect(screen.queryByTestId('learner-target')).not.toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add learners' }));
    expect(screen.getByTestId('learner-target')).toHaveTextContent('M1');
    expect(screen.queryByRole('dialog', { name: 'Same title learner progress' })).not.toBeInTheDocument();
  });

  it('shows unavailable group totals when the scope request fails', async () => {
    fixtures.scope.mockRejectedValue(new Error('Scope unavailable')); await open();
    expect(await screen.findByRole('alert')).toHaveTextContent('Group totals are unavailable');
    expect(within(screen.getByLabelText('Catalogue totals')).getByText('Groups').nextElementSibling).toHaveTextContent('Unavailable');
  });

  it('does not report final totals before programme visibility resolves or after its request fails', async () => {
    fixtures.programmesLoading = true; const pending = await open();
    expect(within(screen.getByLabelText('Catalogue totals')).getByText('Total modules').nextElementSibling).toHaveTextContent('Loading');
    pending.unmount(); fixtures.programmesLoading = false; fixtures.programmesError = 'Programme visibility unavailable';
    await open(); expect(screen.getByText('Unable to refresh modules: Programme visibility unavailable')).toBeInTheDocument();
    expect(within(screen.getByLabelText('Catalogue totals')).getByText('Total modules').nextElementSibling).toHaveTextContent('Unavailable');
  });

  it('distinguishes loading, failed list reads, and a genuinely empty catalogue', async () => {
    fixtures.modules = []; fixtures.loading = true;
    const view = await open(); expect(within(screen.getByLabelText('Catalogue totals')).getByText('Total modules').nextElementSibling).toHaveTextContent('Loading');
    view.unmount(); fixtures.loading = false; fixtures.error = 'List unavailable';
    const failed = await open(); expect(screen.getByText('Module catalogue unavailable')).toBeInTheDocument(); expect(screen.queryByText('No modules yet')).not.toBeInTheDocument();
    failed.unmount(); fixtures.error = null; await open(); expect(screen.getByText('No modules yet')).toBeInTheDocument();
  });
});
