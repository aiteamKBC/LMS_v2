import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModuleComponent, ModuleCatalogueItem } from '../moduleAuthoringData';
import type { ReactNode } from 'react';
import type { CurriculumModule, CurriculumProgramme } from '@/lib/curriculumApi';

// Exercise the drawer through the actual module state and revision-protected
// save pipeline; the small field/rail stand-ins make record targeting explicit.

const reload = vi.fn(async () => null);
const loadModuleStructure = vi.fn();
const saveModuleStructure = vi.fn();
/** The unsaved-changes guard. Typed with its argument so the test can read it. */
const swalFire = vi.fn(async (_options: Record<string, unknown>) => (
  { isConfirmed: false, isDenied: false, isDismissed: true }
));

vi.mock('@/components/feature/WorkspaceShell', () => ({
  WorkspaceShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('sweetalert2', () => ({
  default: { fire: (options: Record<string, unknown>) => swalFire(options) },
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
  ComponentEditor: ({ component, onChange }: { component: ModuleComponent; onChange: (patch: Partial<ModuleComponent>) => void }) => <><label>Component title<input value={component.title} onChange={event => onChange({ title: event.target.value })} /></label><label>Session outline<textarea value={String(component.settings.sessionPurpose || '')} onChange={event => onChange({ settings: { ...component.settings, sessionPurpose: event.target.value } })} /></label></>,
  WeekComponentRail: ({ components, onSelectId }: {
    components: Array<{ id: string }>;
    onSelectId: (id: string) => void;
    onChange: (components: Array<{ id: string }>) => void;
  }) => (
    <>{components.map(component => <button key={component.id} type="button" onClick={() => onSelectId(component.id)}>Select {component.id}</button>)}</>
  ),
  WeekOverviewPanel: () => null,
}));

vi.mock('../moduleAuthoringData', async importOriginal => ({
  ...(await importOriginal<typeof import('../moduleAuthoringData')>()),
  loadModuleStructure: (...args: unknown[]) => loadModuleStructure(...(args as [])),
  saveModuleStructure: (...args: unknown[]) => saveModuleStructure(...(args as [])),
  loadModuleWeekSessionPlan: vi.fn(async () => null),
  restoreModuleTeamsMeeting: vi.fn(),
}));

const programmes = [
  { id: 'program-mm', sourceId: 'PROG-MM', name: 'Marketing Manager' },
] as CurriculumProgramme[];

const modules = [
  {
    id: 'MOD-AUTOSAVE-1',
    moduleCatalogueId: 'MOD-AUTOSAVE-1',
    name: 'Marketing Strategy',
    programme: 'Marketing Manager',
    programmeId: 'PROG-MM',
    sessionsNumber: 1,
    status: 'draft',
  },
] as CurriculumModule[];

// The workspace reads the signed-in account (it decides which learner preview
// an admin is offered). Without this the page throws on its first line and
// every case below fails before it has asserted anything about saving.
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
  fetchCurriculumDeliveryScope: vi.fn(async () => ({ cohorts: [], groups: [] })),
}));

/** One week with a title to type into — the smallest thing worth saving. */
function storedStructure(revision = 'rev-1') {
  return {
    weekStructure: [
      {
        id: 'WEEK-1',
        moduleId: 'MOD-AUTOSAVE-1',
        weekNumber: 1,
        title: 'Week one',
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
          {
            id: 'COMPONENT-2',
            type: 'reading',
            title: 'Second component',
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


async function openEditor() {
  const structure = storedStructure();
  for (const [index, component] of structure.weekStructure[0].components.entries()) {
    component.type = 'live-session';
    component.settings = { liveSessionUrl: index ? `https://teams.example.test/${index}` : '', sessionPurpose: 'Stored outline' };
  }
  loadModuleStructure.mockResolvedValue(structure);
  window.history.replaceState({}, '', '/curriculum/module-builder?module=MOD-AUTOSAVE-1');
  const { default: ModuleBuilder } = await import('../page');
  render(<MemoryRouter initialEntries={['/curriculum/module-builder?module=MOD-AUTOSAVE-1']}><ModuleBuilder /></MemoryRouter>);
  await screen.findByLabelText('Week title');
  await userEvent.click(await screen.findByRole('button', { name: 'Select COMPONENT-1' }));
  return screen.findByRole('dialog');
}

describe('Module editor drawer save integration', { timeout: 15000 }, () => {
  beforeEach(() => {
    saveModuleStructure.mockReset().mockImplementation(async (_id: string, module: ModuleCatalogueItem) => ({ ...module, structureRevision: 'rev-2' }));
    loadModuleStructure.mockClear(); reload.mockClear(); swalFire.mockClear();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ results: [] })));
  });
  afterEach(() => { vi.restoreAllMocks(); window.history.replaceState({}, '', '/'); });

  it('keeps an outline change on the selected live component and preserves the other session link', async () => {
    const user = userEvent.setup(); await openEditor();
    const data = await import('../moduleAuthoringData');
    expect(data.restoreModuleTeamsMeeting).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText('Session outline'), ' changed');
    expect(saveModuleStructure).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Save component' }));
    await waitFor(() => expect(saveModuleStructure).toHaveBeenCalledOnce());
    const [id, sent, options] = saveModuleStructure.mock.calls[0] as [string, ModuleCatalogueItem, { expectedRevision: string }];
    expect(id).toBe('MOD-AUTOSAVE-1'); expect(options.expectedRevision).toBe('rev-1');
    expect(sent.weekStructure[0].components[0].settings.sessionPurpose).toBe('Stored outline changed');
    expect(sent.weekStructure[0].components[1].settings.liveSessionUrl).toBe('https://teams.example.test/1');
    expect(sent.weekStructure[0].components[1].title).toBe('Second component');
  });

  it('discards the component while keeping another unsaved week edit in the module', async () => {
    const user = userEvent.setup(); await openEditor();
    // Start with a clean close, then edit the week and reopen the same component.
    await user.click(screen.getByRole('button', { name: /^Cancel$/ }));
    await user.type(screen.getByLabelText('Week title'), ' pending week');
    await user.click(screen.getByRole('button', { name: /^Edit component$/ }));
    await user.type(screen.getByLabelText('Component title'), ' draft');
    await user.click(screen.getByRole('button', { name: /^Discard changes$/ }));
    expect(screen.getByLabelText('Component title')).toHaveValue('First component');
    await user.click(screen.getByRole('button', { name: 'Save component' }));
    await waitFor(() => expect(saveModuleStructure).toHaveBeenCalledOnce());
    const sent = saveModuleStructure.mock.calls[0][1] as ModuleCatalogueItem;
    expect(sent.weekStructure[0].title).toBe('Week one pending week');
    expect(sent.weekStructure[0].components.map(component => component.title)).toEqual(['First component', 'Second component']);
  });

  it('retains the dirty component when the real module save pipeline is refused', async () => {
    const user = userEvent.setup(); saveModuleStructure.mockRejectedValueOnce(new Error('Synthetic refusal'));
    await openEditor(); await user.type(screen.getByLabelText('Component title'), ' kept');
    await user.click(screen.getByRole('button', { name: 'Save component' }));
    await waitFor(() => expect(saveModuleStructure).toHaveBeenCalledOnce());
    await screen.findByRole('alert');
    expect(screen.getByLabelText('Component title')).toHaveValue('First component kept');
    expect(screen.getByTestId('module-builder-save-state')).toHaveTextContent('Save failed');
    expect(screen.getByText('Unsaved component changes', { exact: true })).toBeInTheDocument();
  });
});
