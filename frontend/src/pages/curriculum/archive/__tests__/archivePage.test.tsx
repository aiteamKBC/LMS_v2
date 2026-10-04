import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type {
  CurriculumArchivedCohort,
  CurriculumArchivedGroup,
  CurriculumArchivedModule,
  CurriculumProgramme,
} from '@/lib/curriculumApi';

/**
 * The Curriculum archive, now that it is the only one.
 *
 * Programmes and the Module Builder used to carry a "View archive" toggle over
 * their own records; both were removed, and this page is where every archived
 * record is read and acted on. That makes it the single point of failure for
 * the thing those toggles existed to prevent: a record archived by accident
 * with no way back to it from the product.
 *
 * So what is asserted here is what has to survive a merge — an archived module
 * is listed, Restore actually calls the restore endpoint, and the deep link the
 * audit trail builds (`?type=module&q=<id>`) lands on the one record it names
 * rather than on the whole list.
 */

const archivedModule: CurriculumArchivedModule = {
  id: 'MOD-ARCHIVED',
  catalogueId: 'MOD-ARCHIVED',
  title: 'Project Management Professional',
  programme: 'Team Leader',
  programmeId: 'PROG-TL',
  cohort: 'September Intake',
  group: 'Group A',
  tutor: 'Dana Wills',
  weeks: 34,
  sessions: 34,
  components: 601,
  archivedAt: '2026-08-01T09:00:00Z',
  archivedBy: '',
  programmeArchived: false,
} as CurriculumArchivedModule;

// A second archived module, so "the link filtered the list" is a real claim and
// the counts below belong to one row rather than to whatever rendered first.
const otherArchivedModule: CurriculumArchivedModule = {
  ...archivedModule,
  id: 'MOD-OTHER',
  catalogueId: 'MOD-OTHER',
  title: 'Data Foundations',
  weeks: 12,
  sessions: 12,
  components: 40,
} as CurriculumArchivedModule;

const fetchCurriculumProgrammes = vi.fn(async (): Promise<CurriculumProgramme[]> => []);
const fetchArchivedCurriculumCohorts = vi.fn(async (): Promise<CurriculumArchivedCohort[]> => []);
const fetchArchivedCurriculumGroups = vi.fn(async (): Promise<CurriculumArchivedGroup[]> => []);
const fetchArchivedCurriculumModules = vi.fn(async (): Promise<CurriculumArchivedModule[]> => [
  archivedModule,
  otherArchivedModule,
]);
const fetchArchivedModuleStructure = vi.fn(async (): Promise<unknown> => null);
const restoreCurriculumModule = vi.fn(async () => ({ restored: true, id: 'MOD-ARCHIVED' }));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ auth: { account: { role: 'curriculum' } } }),
}));

vi.mock('@/components/feature/WorkspaceShell', () => ({
  WorkspaceShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

// The confirm is answered "yes" rather than stubbed out, or Restore would be
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

vi.mock('@/lib/curriculumApi', async () => {
  const actual = await vi.importActual<typeof import('@/lib/curriculumApi')>('@/lib/curriculumApi');
  return {
    ...actual,
    fetchCurriculumProgrammes: (...args: unknown[]) => fetchCurriculumProgrammes(...(args as [])),
    fetchArchivedCurriculumCohorts: (...args: unknown[]) => fetchArchivedCurriculumCohorts(...(args as [])),
    fetchArchivedCurriculumGroups: (...args: unknown[]) => fetchArchivedCurriculumGroups(...(args as [])),
    fetchArchivedCurriculumModules: (...args: unknown[]) => fetchArchivedCurriculumModules(...(args as [])),
    fetchArchivedModuleStructure: (...args: unknown[]) => fetchArchivedModuleStructure(...(args as [])),
    restoreCurriculumModule: (...args: unknown[]) => restoreCurriculumModule(...(args as [])),
  };
});

const { default: CurriculumArchivePage } = await import('../page');

function renderArchive(route = '/curriculum/archive') {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <CurriculumArchivePage />
    </MemoryRouter>,
  );
}

describe('Curriculum archive', { timeout: 15000 }, () => {
  beforeEach(() => {
    fetchArchivedCurriculumModules.mockClear();
    restoreCurriculumModule.mockClear();
  });

  it('lists what is in the archive, with what a restore would bring back', async () => {
    renderArchive();

    expect(await screen.findByText('Project Management Professional')).toBeInTheDocument();
    // The counts are the whole decision, so they are on the row rather than
    // behind the details panel.
    expect(screen.getByText(/34 weeks/)).toBeInTheDocument();
    expect(screen.getByText(/601 components/)).toBeInTheDocument();
  });

  it('restores an archived module and re-reads the archive behind it', async () => {
    // Filtered to the one module, so the Restore clicked below is unambiguously
    // its own: the rows sort by name, and this is not the first of the two.
    renderArchive('/curriculum/archive?type=module&q=MOD-ARCHIVED');
    await screen.findByText('Project Management Professional');

    await userEvent.click(await screen.findByRole('button', { name: /restore/i }));

    await waitFor(() => expect(restoreCurriculumModule).toHaveBeenCalledWith('MOD-ARCHIVED'));
    // The row it dealt with has to leave the list, which means re-reading it.
    await waitFor(() => expect(fetchArchivedCurriculumModules).toHaveBeenCalledTimes(2));
  });

  it('opens on the one record a ?type= and ?q= link names', async () => {
    renderArchive('/curriculum/archive?type=module&q=MOD-ARCHIVED');

    expect(await screen.findByText('Project Management Professional')).toBeInTheDocument();
    // The other archived module is real and still archived; the link asked for
    // one record, so the list has to be filtered rather than merely scrolled.
    expect(screen.queryByText('Data Foundations')).not.toBeInTheDocument();
  });

  it('opens the archived module an audit link names, at its week, with the component marked', async () => {
    fetchArchivedModuleStructure.mockResolvedValueOnce({
      weekStructure: [
        { id: 'WEEK-1', weekNumber: 1, title: 'Kick-off', components: [{ id: 'COMP-0', title: 'Welcome', type: 'reading' }] },
        { id: 'WEEK-2', weekNumber: 2, title: 'Planning', components: [
          { id: 'COMP-1', title: 'Gantt charts', type: 'reading' },
          { id: 'COMP-2', title: 'Risk logs', type: 'reading' },
        ] },
      ],
    });
    renderArchive('/curriculum/archive?type=module&q=MOD-ARCHIVED&open=module%3AMOD-ARCHIVED&week=WEEK-2&component=COMP-1');

    // The panel, not just the filtered list: the week is open and the named
    // component is the marked one, while week 1 stays shut.
    expect(await screen.findByText('Gantt charts')).toBeInTheDocument();
    expect(fetchArchivedModuleStructure).toHaveBeenCalledWith('MOD-ARCHIVED', expect.anything());
    expect(screen.getByText('Gantt charts').closest('[data-focused]')).toHaveAttribute('data-focused', 'true');
    expect(screen.getByText('Risk logs').closest('[data-focused]')).toBeNull();
    expect(screen.queryByText('Welcome')).not.toBeInTheDocument();
  });

  it('sends an item archived out of a still-live module on to the Module Builder at its week', async () => {
    function BuilderStub() {
      const location = useLocation();
      return <p data-testid="builder-location">{location.pathname}{location.search}</p>;
    }
    render(
      <MemoryRouter initialEntries={['/curriculum/archive?type=module&q=MOD-LIVE&open=module%3AMOD-LIVE&week=WEEK-9&component=COMP-9&archived=component&archivedName=Quiz&archivedAt=2026-10-04T10%3A56%3A00Z']}>
        <Routes>
          <Route path="/curriculum/archive" element={<CurriculumArchivePage />} />
          <Route path="/curriculum/module-builder" element={<BuilderStub />} />
        </Routes>
      </MemoryRouter>,
    );

    const target = await screen.findByTestId('builder-location');
    const [path, query] = (target.textContent || '').split('?');
    expect(path).toBe('/curriculum/module-builder');
    expect(Object.fromEntries(new URLSearchParams(query))).toEqual({
      module: 'MOD-LIVE',
      week: 'WEEK-9',
      component: 'COMP-9',
      focus: 'component',
      archived: 'component',
      archivedName: 'Quiz',
      archivedAt: '2026-10-04T10:56:00Z',
    });
  });

  it('hands a live module on to the Builder even when the programme list fails', async () => {
    // The programme list is the archive's slowest read and it has nothing to
    // say about whether a module is archived; its failure must not strand the
    // reader on the archive.
    fetchCurriculumProgrammes.mockRejectedValueOnce(new Error('Curriculum API returned 502'));
    function BuilderStub() {
      const location = useLocation();
      return <p data-testid="builder-location">{location.pathname}{location.search}</p>;
    }
    render(
      <MemoryRouter initialEntries={['/curriculum/archive?type=module&q=MOD-LIVE&open=module%3AMOD-LIVE&week=WEEK-9']}>
        <Routes>
          <Route path="/curriculum/archive" element={<CurriculumArchivePage />} />
          <Route path="/curriculum/module-builder" element={<BuilderStub />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByTestId('builder-location')).toHaveTextContent('/curriculum/module-builder?module=MOD-LIVE&week=WEEK-9');
  });

  it('says so when the record a link names is no longer archived', async () => {
    renderArchive('/curriculum/archive?type=cohort&q=COH-GONE&open=cohort%3ACOH-GONE');
    expect(await screen.findByText(/no longer in the archive/i)).toBeInTheDocument();
  });
});
