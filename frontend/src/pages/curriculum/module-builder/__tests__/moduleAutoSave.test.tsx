import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { CurriculumModule, CurriculumProgramme } from '@/lib/curriculumApi';
import { ModuleStructureConflictError } from '../moduleAuthoringData';

/**
 * The authoring workspace saves itself.
 *
 * Every edit in here used to be held in component state until somebody pressed
 * Save. A browser reload, a closed laptop or a stray Back took the lot, and the
 * footer's "Unsaved changes" was the only warning.
 *
 * Saving itself is the easy half. The hard half is that a save on this endpoint
 * REPLACES the module: every week, every component, every KSB mapping. So these
 * cover what that makes dangerous once it happens without being asked --
 * a burst of typing must not become a burst of full-structure writes, a reply
 * must never put back what the reader has typed since, a refusal must never
 * read as saved, and a module somebody else has already written must be
 * refused rather than overwritten.
 */

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
  ComponentEditor: () => null,
  WeekComponentRail: ({ components, onChange }: {
    components: Array<{ id: string }>;
    onChange: (components: Array<{ id: string }>) => void;
  }) => (
    <button type="button" onClick={() => onChange([...components].reverse())}>Reorder components</button>
  ),
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
    id: 'MOD-AUTOSAVE-1',
    moduleCatalogueId: 'MOD-AUTOSAVE-1',
    name: 'Marketing Strategy',
    programme: 'Marketing Manager',
    programmeId: 'PROG-MM',
    sessionsNumber: 1,
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

type SavedModule = { weekStructure: Array<{ title: string; components: Array<{ id: string }> }>; structureRevision?: string };
type SaveCall = [string, SavedModule, { expectedRevision?: string } | undefined];

/**
 * Hold the next save open until the test lets it finish.
 *
 * It answers with the module it was given, the way the endpoint does: the reply
 * to a save is the state that was SENT, which is the whole reason a reply must
 * not be applied over whatever has been typed since.
 */
function holdNextSave() {
  let release: () => void = () => undefined;
  const gate = new Promise<void>(resolve => {
    release = resolve;
  });
  saveModuleStructure.mockImplementationOnce(async (_id: string, module: SavedModule) => {
    await gate;
    return { ...module, structureRevision: 'rev-held' };
  });
  return { release };
}

async function openWorkspace() {
  loadModuleStructure.mockResolvedValue(storedStructure());
  const search = '?module=MOD-AUTOSAVE-1';
  window.history.replaceState({}, '', `/curriculum/module-builder${search}`);
  const { default: ModuleBuilder } = await import('../page');
  render(
    <MemoryRouter initialEntries={[`/curriculum/module-builder${search}`]}>
      <ModuleBuilder />
    </MemoryRouter>,
  );
  return screen.findByLabelText(/Week title/i);
}

/** The footer's one sentence about what has happened to the reader's edits. */
function saveState() {
  return screen.getByTestId('module-builder-save-state').textContent || '';
}

function saveCalls() {
  return saveModuleStructure.mock.calls as SaveCall[];
}

/** The footer's on/off switch for the workspace saving itself. */
function autoSaveToggle() {
  return screen.getByTestId('module-builder-auto-save-toggle');
}

/**
 * Open the workspace with auto save switched on.
 *
 * It is off on every module until somebody asks for it, so the tests about what
 * the workspace does once it is saving itself have to ask first -- the same
 * click a reader makes.
 */
async function openWorkspaceSaving() {
  const title = await openWorkspace();
  await userEvent.click(autoSaveToggle());
  return title;
}

describe('Module Builder auto-save', { timeout: 25000 }, () => {
  beforeEach(() => {
    reload.mockClear();
    loadModuleStructure.mockClear();
    saveModuleStructure.mockClear();
    swalFire.mockClear();
    // Each save echoes the module back with the next revision, the way the
    // endpoint does — that reply is what arms the save after it.
    let revision = 1;
    saveModuleStructure.mockImplementation(async (_id: string, module: SavedModule) => {
      revision += 1;
      return { ...module, structureRevision: `rev-${revision}` };
    });
  });

  it('saves a week title without the Save button being pressed', async () => {
    const title = await openWorkspaceSaving();
    expect(saveModuleStructure).not.toHaveBeenCalled();

    await userEvent.type(title, '!');

    await waitFor(() => expect(saveModuleStructure).toHaveBeenCalled(), { timeout: 8000 });
    expect(saveCalls()[0][1].weekStructure[0].title).toBe('Week one!');
    // And it names the version it was built from, or the write is a
    // last-write-wins replacement of whatever the module has become since.
    expect(saveCalls()[0][2]?.expectedRevision).toBe('rev-1');
  });

  it('spends one save on a burst of typing, not one per character', async () => {
    // The whole structure goes back on every save, so a request per keystroke
    // would be hundreds of full writes for one renamed week.
    const title = await openWorkspaceSaving();

    await userEvent.type(title, 'abcdef');

    await waitFor(() => expect(saveModuleStructure).toHaveBeenCalled(), { timeout: 8000 });
    expect(saveModuleStructure).toHaveBeenCalledTimes(1);
    expect(saveCalls()[0][1].weekStructure[0].title).toBe('Week oneabcdef');
  });

  it('carries the revision the previous save returned into the next one', async () => {
    // Without this every save after the first conflicts with its own predecessor.
    const title = await openWorkspaceSaving();
    await userEvent.type(title, 'A');
    await waitFor(() => expect(saveModuleStructure).toHaveBeenCalledTimes(1), { timeout: 8000 });

    await userEvent.type(title, 'B');

    await waitFor(() => expect(saveModuleStructure).toHaveBeenCalledTimes(2), { timeout: 8000 });
    expect(saveCalls()[1][2]?.expectedRevision).toBe('rev-2');
  });

  it('keeps what the reader types while a save is in flight, and sends it after', async () => {
    // The response to a save is the state that was SENT. Applying it blindly
    // puts the screen back to before the keystrokes made since — the reader
    // watches their own typing disappear.
    const held = holdNextSave();
    const title = await openWorkspaceSaving();

    await userEvent.type(title, ' first');
    await waitFor(() => expect(saveModuleStructure).toHaveBeenCalledTimes(1), { timeout: 8000 });
    // Typed while save A is still open.
    await userEvent.type(title, ' second');
    held.release();

    await waitFor(() => expect(title).toHaveValue('Week one first second'), { timeout: 8000 });
    // And the edit made during the save is not merely kept on screen, it is
    // saved: a pending edit that never reaches the backend is the same loss
    // one round trip later.
    await waitFor(() => expect(saveModuleStructure).toHaveBeenCalledTimes(2), { timeout: 8000 });
    expect(saveCalls()[1][1].weekStructure[0].title).toBe('Week one first second');
  });

  it('never has two saves of the same module in flight at once', async () => {
    // Two open requests can land in either order, and the loser's payload would
    // decide what the module is. There is no ordering to get right if there is
    // only ever one.
    const held = holdNextSave();
    const title = await openWorkspaceSaving();

    await userEvent.type(title, 'x');
    await waitFor(() => expect(saveModuleStructure).toHaveBeenCalledTimes(1), { timeout: 8000 });
    await userEvent.type(title, 'y');
    await userEvent.type(title, 'z');
    // Pressing Save now must not open a second request either.
    await userEvent.click(screen.getByTestId('module-builder-save'));

    expect(saveModuleStructure).toHaveBeenCalledTimes(1);
    held.release();
    await waitFor(() => expect(saveModuleStructure).toHaveBeenCalledTimes(2), { timeout: 8000 });
    expect(saveCalls()[1][1].weekStructure[0].title).toBe('Week onexyz');
  });

  it('reads as saved only once the backend has confirmed the write', async () => {
    const held = holdNextSave();
    const title = await openWorkspaceSaving();
    expect(saveState()).toBe('All changes saved');

    await userEvent.type(title, '!');
    expect(saveState()).toBe('Unsaved changes');
    await waitFor(() => expect(saveState()).toBe('Saving module structure...'), { timeout: 8000 });

    held.release();
    await waitFor(() => expect(saveState()).toBe('All changes saved'), { timeout: 8000 });
  });

  it('says there are later edits still pending while a save is running', async () => {
    const held = holdNextSave();
    const title = await openWorkspaceSaving();

    await userEvent.type(title, '!');
    await waitFor(() => expect(saveState()).toBe('Saving module structure...'), { timeout: 8000 });
    await userEvent.type(title, '?');

    expect(saveState()).toBe('Saving... later edits still pending');
    held.release();
  });

  it('reports a failed save as failed and keeps the edits', async () => {
    saveModuleStructure.mockRejectedValueOnce(new Error('Curriculum API returned 500'));
    const title = await openWorkspaceSaving();

    await userEvent.type(title, '!');

    await waitFor(() => expect(saveState()).toBe('Save failed - your changes are still here'), { timeout: 8000 });
    expect(title).toHaveValue('Week one!');
    // And it does not sit there retrying the payload the backend just refused.
    await new Promise(resolve => window.setTimeout(resolve, 2000));
    expect(saveModuleStructure).toHaveBeenCalledTimes(1);
  });

  it('retries a failed save on the next edit rather than needing a page reload', async () => {
    saveModuleStructure.mockRejectedValueOnce(new Error('Curriculum API returned 500'));
    const title = await openWorkspaceSaving();
    await userEvent.type(title, '!');
    await waitFor(() => expect(saveState()).toBe('Save failed - your changes are still here'), { timeout: 8000 });

    await userEvent.type(title, '?');

    await waitFor(() => expect(saveState()).toBe('All changes saved'), { timeout: 8000 });
    expect(saveCalls()[1][1].weekStructure[0].title).toBe('Week one!?');
  });

  it('keeps every local change when the module was written by somebody else', async () => {
    // A 409. Re-sending this payload is exactly the destruction the refusal
    // prevented, so the workspace stops saving by itself and says so — with
    // everything the reader typed still on screen.
    saveModuleStructure.mockRejectedValueOnce(new ModuleStructureConflictError(
      'This module changed after you opened it. Your changes have not been overwritten. '
      + 'Reload the latest version before saving again.',
      'rev-99',
      null,
    ));
    const title = await openWorkspaceSaving();

    await userEvent.type(title, ' mine');

    await waitFor(() => expect(saveState()).toBe('Conflict - reload before saving again'), { timeout: 8000 });
    expect(title).toHaveValue('Week one mine');
    expect(await screen.findByText(/changed after you opened it/)).toBeInTheDocument();
    // Disarmed: typing again must not fire the refused payload at the backend
    // once per burst for as long as the workspace stays open.
    await userEvent.type(title, '!');
    await new Promise(resolve => window.setTimeout(resolve, 2000));
    expect(saveModuleStructure).toHaveBeenCalledTimes(1);
    expect(title).toHaveValue('Week one mine!');
  });

  it('sends the edits straight away when Save now is pressed', async () => {
    // Same pipeline as the auto-save, without the quiet period.
    const title = await openWorkspaceSaving();
    await userEvent.type(title, '!');

    await userEvent.click(screen.getByTestId('module-builder-save'));

    await waitFor(() => expect(saveModuleStructure).toHaveBeenCalledTimes(1));
    expect(saveCalls()[0][1].weekStructure[0].title).toBe('Week one!');
    expect(saveCalls()[0][2]?.expectedRevision).toBe('rev-1');
    // One save, not one from the button and another from the timer behind it.
    await new Promise(resolve => window.setTimeout(resolve, 2000));
    expect(saveModuleStructure).toHaveBeenCalledTimes(1);
  });

  it('leaves the module to the Save button until somebody turns auto save on', async () => {
    // The default, on every module. A save here replaces every week, component
    // and KSB mapping the module has, so the workspace does not start doing
    // that unasked.
    const title = await openWorkspace();
    expect(autoSaveToggle()).toHaveTextContent('Auto save off');

    await userEvent.type(title, '!');

    await new Promise(resolve => window.setTimeout(resolve, 2500));
    expect(saveModuleStructure).not.toHaveBeenCalled();
    expect(saveState()).toBe('Unsaved changes - press Save');

    await userEvent.click(screen.getByTestId('module-builder-save'));
    await waitFor(() => expect(saveModuleStructure).toHaveBeenCalledTimes(1));
    expect(saveCalls()[0][1].weekStructure[0].title).toBe('Week one!');
    expect(saveCalls()[0][2]?.expectedRevision).toBe('rev-1');
  });

  it('saves the component order chosen in the course structure', async () => {
    await openWorkspace();

    await userEvent.click(screen.getByRole('button', { name: 'Reorder components' }));
    await userEvent.click(screen.getByTestId('module-builder-save'));

    await waitFor(() => expect(saveModuleStructure).toHaveBeenCalledTimes(1));
    expect(saveCalls()[0][1].weekStructure[0].components.map(component => component.id))
      .toEqual(['COMPONENT-2', 'COMPONENT-1']);
  });

  it('holds every edit until Save is pressed once auto save is turned off again', async () => {
    const title = await openWorkspaceSaving();
    expect(autoSaveToggle()).toHaveTextContent('Auto save on');

    await userEvent.click(autoSaveToggle());
    expect(autoSaveToggle()).toHaveTextContent('Auto save off');
    await userEvent.type(title, '!');

    // Well past the quiet period, and nothing has been sent.
    await new Promise(resolve => window.setTimeout(resolve, 2500));
    expect(saveModuleStructure).not.toHaveBeenCalled();
    // The footer says what has to happen rather than implying it is in hand.
    expect(saveState()).toBe('Unsaved changes - press Save');
    expect(title).toHaveValue('Week one!');

    // Same pipeline, same revision check -- only the trigger is different.
    await userEvent.click(screen.getByTestId('module-builder-save'));
    await waitFor(() => expect(saveModuleStructure).toHaveBeenCalledTimes(1));
    expect(saveCalls()[0][1].weekStructure[0].title).toBe('Week one!');
    expect(saveCalls()[0][2]?.expectedRevision).toBe('rev-1');
    await waitFor(() => expect(saveState()).toBe('All changes saved'));
  });

  it('sends the work typed before it was switched on as soon as it is', async () => {
    const title = await openWorkspace();
    await userEvent.type(title, '!');
    await new Promise(resolve => window.setTimeout(resolve, 2000));
    expect(saveModuleStructure).not.toHaveBeenCalled();

    await userEvent.click(autoSaveToggle());

    await waitFor(() => expect(saveModuleStructure).toHaveBeenCalledTimes(1), { timeout: 8000 });
    expect(saveCalls()[0][1].weekStructure[0].title).toBe('Week one!');
  });

  it('keeps the choice to the module it was made on', async () => {
    await openWorkspaceSaving();
    expect(autoSaveToggle()).toHaveTextContent('Auto save on');

    // Nothing is written anywhere, so the next module -- and the next reader on
    // this browser -- opens on the default rather than inheriting this.
    expect(window.localStorage.getItem('curriculumModuleBuilderAutoSave')).toBeNull();
  });

  it('asks before leaving a module whose save was refused', async () => {
    // Auto-save shortens the unsaved window; it does not remove it. A refusal
    // leaves real work in the browser and nowhere else, so the existing guard
    // has to still be the thing standing between it and Back.
    saveModuleStructure.mockRejectedValueOnce(new Error('Curriculum API returned 500'));
    const title = await openWorkspaceSaving();
    await userEvent.type(title, '!');
    await waitFor(() => expect(saveState()).toBe('Save failed - your changes are still here'), { timeout: 8000 });

    await userEvent.click(screen.getByRole('button', { name: 'Back to modules' }));

    await waitFor(() => expect(swalFire).toHaveBeenCalled());
    expect(swalFire.mock.calls[0][0]).toMatchObject({ title: 'Save changes first?' });
    // Cancelled, so the workspace and the edits are still here.
    expect(await screen.findByLabelText(/Week title/i)).toHaveValue('Week one!');
  });
});
