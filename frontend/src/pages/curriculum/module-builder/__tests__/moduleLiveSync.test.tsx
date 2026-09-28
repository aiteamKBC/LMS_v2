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
 * - unsaved edits: merge the two copies. Their weeks and components arrive,
 *   the reader's stay, and a field they both changed keeps the reader's and is
 *   said out loud. Announcing the write and touching nothing -- which is what
 *   this did before -- kept both editors' work but left them unable to save
 *   without one of them reloading over the other.
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
function storedStructure(weekTitle = 'Week one', revision = 'rev-1', extraWeeks: { id: string; title: string }[] = []) {
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
      ...extraWeeks.map((week, index) => ({
        id: week.id,
        moduleId: 'MOD-LIVE-1',
        weekNumber: index + 2,
        title: week.title,
        summary: '',
        learningOutcomes: [],
        components: [],
        ksbMappings: [],
      })),
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
async function saveArrivesFromElsewhere(weekTitle: string, revision: string, extraWeeks: { id: string; title: string }[] = []) {
  loadModuleStructure.mockResolvedValue(storedStructure(weekTitle, revision, extraWeeks));
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

  it('saves the merged module against the revision it merged with', async () => {
    // The state this used to guard against is {revision: theirs, weeks: mine}:
    // their revision on this reader's weeks alone would make the save legal at
    // the endpoint and replace their work without a word. It is not that state
    // any more. The weeks being saved are theirs merged with this reader's, so
    // the revision they were merged with is the one the save is genuinely
    // built on -- and holding the old revision instead would now refuse a
    // payload that contains everybody's work.
    const title = await openWorkspace();
    await userEvent.clear(title);
    await userEvent.type(title, 'My unsaved week');

    await saveArrivesFromElsewhere('Week one, renamed by Sara', 'rev-2', [{ id: 'WEEK-2', title: 'A week Sara added' }]);
    expect(await screen.findByRole('button', { name: 'Load their version' })).toBeInTheDocument();

    await userEvent.click(screen.getByTestId('module-builder-save'));

    await waitFor(() => expect(saveModuleStructure).toHaveBeenCalled());
    expect(lastExpectedRevision()).toBe('rev-2');
    const sent = (saveModuleStructure.mock.calls[0] as [string, { weekStructure: { title: string }[] }])[1];
    // Both editors are in the payload: the week title this reader typed, and
    // the week Sara added while they were typing it.
    expect(sent.weekStructure[0].title).toBe('My unsaved week');
    expect(sent.weekStructure.map(week => week.title)).toContain('A week Sara added');
  });

  it('names the field both editors changed and keeps this one', async () => {
    const title = await openWorkspace();
    await userEvent.clear(title);
    await userEvent.type(title, 'My unsaved week');

    await saveArrivesFromElsewhere('Week one, renamed by Sara', 'rev-2');

    const notice = await screen.findByTestId('module-builder-remote-update');
    expect(notice).toHaveTextContent(/both changed the title/i);
    expect(notice).toHaveTextContent(/Yours is kept/i);
    expect(title).toHaveValue('My unsaved week');
  });

  it('merges and re-sends a save the server refused, instead of stopping at a red banner', async () => {
    // The screen this was reported from: "Save failed - this module changed
    // after you opened it. Reload the latest version before saving again."
    // Reloading was the only way forward and it meant re-typing. Now the
    // refusal is answered by reading what is stored, merging it in, and sending
    // the merged module -- the reader sees a save, not a wall.
    const title = await openWorkspace();
    await userEvent.clear(title);
    await userEvent.type(title, 'My unsaved week');

    // The stored module the merge will read: someone else added a week.
    loadModuleStructure.mockResolvedValue(storedStructure('Week one', 'rev-2', [{ id: 'WEEK-2', title: 'A week Sara added' }]));
    const { ModuleStructureConflictError } = await import('../moduleAuthoringData');
    saveModuleStructure.mockImplementationOnce(async () => {
      throw new ModuleStructureConflictError('This module changed after you opened it.', 'rev-2', null);
    });

    await userEvent.click(screen.getByTestId('module-builder-save'));

    await waitFor(() => expect(saveModuleStructure).toHaveBeenCalledTimes(2));
    expect(lastExpectedRevision()).toBe('rev-2');
    const sent = (saveModuleStructure.mock.calls[1] as [string, { weekStructure: { title: string }[] }])[1];
    expect(sent.weekStructure[0].title).toBe('My unsaved week');
    expect(sent.weekStructure.map(week => week.title)).toContain('A week Sara added');
    // Nothing is left on screen telling the reader to reload.
    expect(screen.queryByText(/Reload the latest version/i)).not.toBeInTheDocument();
  });

  it('rebases onto the newest stored version each time, and stops', async () => {
    // Three saves land elsewhere while this reader is mid-edit. Each refusal
    // must be answered by reading what is stored NOW and merging onto that --
    // never by firing the same payload at the endpoint again -- and the chain
    // has to end rather than chase a module that is moving faster than this tab
    // can answer.
    const title = await openWorkspace();
    await userEvent.clear(title);
    await userEvent.type(title, 'My unsaved week');

    const { ModuleStructureConflictError } = await import('../moduleAuthoringData');
    // Somebody else is saving continuously: every read of the stored module
    // answers with a version newer than the one before it, so every attempt is
    // refused however fresh it was.
    const readRevisions: string[] = [];
    let moved = 1;
    loadModuleStructure.mockImplementation(async () => {
      moved += 1;
      readRevisions.push(`rev-${moved}`);
      return storedStructure('Week one', `rev-${moved}`);
    });
    saveModuleStructure.mockImplementation(async () => {
      throw new ModuleStructureConflictError('This module changed after you opened it.', `rev-${moved + 1}`, null);
    });

    await userEvent.click(screen.getByTestId('module-builder-save'));

    // Bounded: the first attempt plus three rebases, and then it stops.
    await waitFor(() => expect(screen.getByText(/being saved by someone else faster/i)).toBeInTheDocument(), { timeout: 8000 });
    expect(saveModuleStructure).toHaveBeenCalledTimes(4);
    const sent = (saveModuleStructure.mock.calls as [string, unknown, { expectedRevision?: string }?][])
      .map(call => call[2]?.expectedRevision);
    // The first attempt names the version the workspace opened on. Every one
    // after it names the version read immediately before it -- the whole point:
    // each retry is rebased onto what is stored NOW, never re-sent against the
    // version that has already been refused.
    expect(sent[0]).toBe('rev-1');
    expect(sent.slice(1)).toEqual(readRevisions.slice(0, 3));
    expect(new Set(sent).size).toBe(4);
    // And nothing the reader typed was touched by any of it.
    expect(title).toHaveValue('My unsaved week');
  });

  it('ignores a live read that is overtaken by a newer one', async () => {
    // Two reads in the air at once -- a colleague saving twice while a forced
    // structure rebuild is slow. The older reply must not land last and put the
    // workspace back onto the version the newer one had already corrected.
    const title = await openWorkspace();
    let releaseFirst: (value: unknown) => void = () => undefined;
    const firstRead = new Promise(resolve => { releaseFirst = resolve; });
    // The first read hangs: a forced structure rebuild outlasting the cooldown
    // between reads is the only way two of them are ever in the air together.
    loadModuleStructure.mockImplementationOnce(async () => {
      await firstRead;
      return storedStructure('The older version', 'rev-2');
    });
    liveRefresh?.();

    // A second write arrives while the first read is still waiting. The
    // workspace holds it back for the cooldown and then reads again.
    loadModuleStructure.mockResolvedValue(storedStructure('The newer version', 'rev-3'));
    liveRefresh?.();
    await waitFor(() => expect(title).toHaveValue('The newer version'), { timeout: 12000 });

    // Now the stale reply lands, last. It must change nothing.
    releaseFirst(null);
    await new Promise(resolve => window.setTimeout(resolve, 100));
    expect(title).toHaveValue('The newer version');

    // And the workspace still saves against the newer version it is holding.
    await userEvent.type(title, '!');
    await userEvent.click(screen.getByTestId('module-builder-save'));
    await waitFor(() => expect(saveModuleStructure).toHaveBeenCalled());
    expect(lastExpectedRevision()).toBe('rev-3');
  });

  it('tells the reader plainly when a refused save cannot be merged', async () => {
    const title = await openWorkspace();
    await userEvent.clear(title);
    await userEvent.type(title, 'My unsaved week');

    // The stored copy will not read, so there is nothing to merge with.
    loadModuleStructure.mockRejectedValue(new Error('network'));
    const { ModuleStructureConflictError } = await import('../moduleAuthoringData');
    saveModuleStructure.mockImplementationOnce(async () => {
      throw new ModuleStructureConflictError('This module changed after you opened it.', 'rev-2', null);
    });

    await userEvent.click(screen.getByTestId('module-builder-save'));

    // One attempt only, the edit intact, and a sentence that says what to do.
    await waitFor(() => expect(screen.getByText(/could not be read just now/i)).toBeInTheDocument());
    expect(saveModuleStructure).toHaveBeenCalledTimes(1);
    expect(title).toHaveValue('My unsaved week');
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

  it('merges the drawer write into unsaved weeks rather than holding it back', async () => {
    // The bad state this closes is still {revision: the drawer's, weeks: the
    // reader's alone}: that made the next save legal at the endpoint and let it
    // replace whatever the drawer had just written, silently. What makes the
    // drawer's revision safe to take now is that the drawer's content comes
    // with it -- the reader's week title is kept over it, and said out loud,
    // because they changed the same field.
    const title = await openWorkspace();
    await userEvent.clear(title);
    await userEvent.type(title, 'My unsaved week');

    await drawerSaves('Week one, as the drawer stored it', 'rev-2');

    expect(await screen.findByRole('button', { name: 'Load their version' })).toBeInTheDocument();
    expect(title).toHaveValue('My unsaved week');

    await userEvent.click(screen.getByTestId('module-builder-save'));

    await waitFor(() => expect(saveModuleStructure).toHaveBeenCalled());
    expect(lastExpectedRevision()).toBe('rev-2');
  });
});
