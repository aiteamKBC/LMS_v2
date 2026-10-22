import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type {
  CurriculumArchivedCohort,
  CurriculumArchivedGroup,
  CurriculumArchivedModule,
  CurriculumArchivedProgramme,
  CurriculumArchiveEntry,
  CurriculumArchivePage,
  CurriculumArchiveRecord,
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
 * The page reads one paginated endpoint, /curriculum/archive/. The fake below
 * answers it the way the server does -- filter, nest, page -- over a handful of
 * records, so what is asserted is the page's side of that contract: an
 * archived module is listed with what the buttons would do, Restore calls the
 * restore endpoint and re-reads, a deep link lands on the one record it names
 * wherever it sits, and records archived together are shown together.
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
  archivedViaParent: '',
  programmeArchived: false,
} as CurriculumArchivedModule;

// A second archived module, so "the link filtered the list" is a real claim.
const otherArchivedModule: CurriculumArchivedModule = {
  ...archivedModule,
  id: 'MOD-OTHER',
  catalogueId: 'MOD-OTHER',
  title: 'Data Foundations',
  weeks: 12,
  sessions: 12,
  components: 40,
  archivedAt: '2026-07-01T09:00:00Z',
} as CurriculumArchivedModule;

const archivedProgramme = {
  id: 'PROG-OLD',
  sourceId: 'PROG-OLD',
  name: 'Retired Leadership Programme',
  standard: 'ST0384',
  level: '3',
  status: 'archived',
  isArchived: true,
  cohorts: 2,
  groups: 3,
  modules: 4,
  weeks: 20,
  ksbMapped: 0,
  ksbTotal: 10,
  archivedAt: '2026-09-10T08:00:00Z',
  archivedBy: 'programme-delete',
  archivedViaParent: '',
} as unknown as CurriculumArchivedProgramme;

// Archived by the programme's own delete -- so it belongs under it.
const cohortWithProgramme = {
  id: 'COH-OLD',
  name: 'Spring Intake',
  programme: 'Retired Leadership Programme',
  programmeId: 'PROG-OLD',
  groups: 0,
  learners: 0,
  archivedAt: '2026-09-10T08:00:00Z',
  archivedBy: 'programme-delete',
  archivedViaParent: 'PROG-OLD',
} as unknown as CurriculumArchivedCohort;

let records: CurriculumArchiveRecord[] = [];

function keyOf(record: CurriculumArchiveRecord) {
  return record.key;
}

function parentKeyOf(item: CurriculumArchiveRecord, keys: Set<string>) {
  const via = (item.record as { archivedViaParent?: string }).archivedViaParent || '';
  if (!via) return null;
  for (const kind of ['group', 'cohort', 'programme']) {
    if (keys.has(`${kind}:${via}`) && `${kind}:${via}` !== item.key) return `${kind}:${via}`;
  }
  return null;
}

function searchText(item: CurriculumArchiveRecord) {
  const record = item.record as unknown as Record<string, unknown>;
  return ['name', 'title', 'id', 'programme'].map(field => String(record[field] ?? '')).join(' ').toLowerCase();
}

/** The server's answer, over `records`. */
function archivePage(params: { page: number; pageSize: number; type?: string; programme?: string; q?: string }): CurriculumArchivePage {
  const q = (params.q || '').toLowerCase();
  const programmeId = (item: CurriculumArchiveRecord) => item.kind === 'programme'
    ? item.record.sourceId || item.record.id : item.record.programmeId;
  const scoped = records.filter(item => !params.programme || programmeId(item) === params.programme);
  const matching = scoped.filter(item => !q || searchText(item).includes(q));
  const counts = { programme: 0, cohort: 0, group: 0, module: 0 };
  matching.forEach(item => { counts[item.kind] += 1; });
  const totals = { programme: 0, cohort: 0, group: 0, module: 0 };
  records.forEach(item => { totals[item.kind] += 1; });
  const keys = new Set(records.map(keyOf));
  let entries: CurriculumArchiveEntry[];
  if (params.type) {
    entries = matching
      .filter(item => item.kind === params.type)
      .map(item => ({ ...item, archivedWith: parentKeyOf(item, keys), children: [] }) as CurriculumArchiveEntry);
  } else {
    const matched = new Set(matching.map(keyOf));
    entries = scoped
      .filter(item => !parentKeyOf(item, keys))
      .map(item => ({
        ...item,
        children: scoped
          .filter(child => parentKeyOf(child, keys) === item.key)
          .map(child => ({ ...child, archivedWith: item.key })),
      }) as CurriculumArchiveEntry)
      .filter(entry => matched.has(entry.key) || entry.children.some(child => matched.has(child.key)));
  }
  const pages = Math.max(1, Math.ceil(entries.length / params.pageSize));
  const page = Math.min(Math.max(1, params.page), pages);
  return {
    page,
    pageSize: params.pageSize,
    pages,
    total: entries.length,
    counts,
    totals,
    archiveTotal: records.length,
    programmes: [...new Map(records.map(item => [programmeId(item), item.kind === 'programme' ? item.record.name : item.record.programme]))]
      .filter(([value]) => Boolean(value)).map(([value, label]) => ({ value, label: label || value })),
    results: entries.slice((page - 1) * params.pageSize, page * params.pageSize),
  };
}

const fetchCurriculumArchivePage = vi.fn(async (params: Parameters<typeof archivePage>[0]) => archivePage(params));
const fetchCurriculumArchiveRecord = vi.fn(async (key: string) => records.find(item => item.key === key) || null);
const fetchArchivedModuleStructure = vi.fn(async (): Promise<unknown> => null);
const fetchProgrammeKsbStats = vi.fn(async (): Promise<unknown> => ({ ksbMapped: 0, ksbTotal: 10 }));
const restoreCurriculumModule = vi.fn(async () => ({ restored: true, id: 'MOD-ARCHIVED' }));
const restoreCurriculumProgramme = vi.fn(async (_id: string) => ({ restored: true }));
const restoreCurriculumCohort = vi.fn(async (_id: string) => ({ restored: true }));
const restoreCurriculumGroup = vi.fn(async (_id: string) => ({ restored: true }));
const permanentlyDeleteCurriculumModule = vi.fn(async (_id: string) => ({ deleted: true }));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ auth: { account: { role: 'curriculum' } } }),
}));

// Search/filter audit transport is outside the restoration workflow under test.
vi.mock('@/lib/curriculumActivity', () => ({ recordCurriculumAction: vi.fn(), recordCurriculumSearch: vi.fn() }));

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
    fetchCurriculumArchivePage: (...args: unknown[]) => fetchCurriculumArchivePage(...(args as [Parameters<typeof archivePage>[0]])),
    fetchCurriculumArchiveRecord: (...args: unknown[]) => fetchCurriculumArchiveRecord(...(args as [string])),
    fetchArchivedModuleStructure: (...args: unknown[]) => fetchArchivedModuleStructure(...(args as [])),
    fetchProgrammeKsbStats: (...args: unknown[]) => fetchProgrammeKsbStats(...(args as [])),
    restoreCurriculumModule: (...args: unknown[]) => restoreCurriculumModule(...(args as [])),
    restoreCurriculumProgramme,
    restoreCurriculumCohort,
    restoreCurriculumGroup,
    permanentlyDeleteCurriculumModule,
  };
});

const { default: CurriculumArchivePage } = await import('../page');
const { CurriculumApiError } = await import('@/lib/curriculumApi');

function renderArchive(route = '/curriculum/archive') {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <CurriculumArchivePage />
    </MemoryRouter>,
  );
}

function BuilderStub() {
  const location = useLocation();
  return <p data-testid="builder-location">{location.pathname}{location.search}</p>;
}

describe('Curriculum archive', { timeout: 15000 }, () => {
  beforeEach(() => {
    records = [
      { kind: 'module', key: 'module:MOD-ARCHIVED', record: archivedModule },
      { kind: 'module', key: 'module:MOD-OTHER', record: otherArchivedModule },
    ];
    fetchCurriculumArchivePage.mockClear();
    fetchCurriculumArchiveRecord.mockClear();
    fetchProgrammeKsbStats.mockClear();
    restoreCurriculumModule.mockClear();
    restoreCurriculumProgramme.mockClear();
    restoreCurriculumCohort.mockClear();
    restoreCurriculumGroup.mockClear();
    permanentlyDeleteCurriculumModule.mockClear();
  });

  it('lists what is in the archive, how it got there, and what the buttons would do', async () => {
    renderArchive();

    expect(await screen.findByText('Project Management Professional')).toBeInTheDocument();
    // The counts are the whole decision, so they are on the row rather than
    // behind the details panel.
    expect(screen.getByText(/Brings it back to the catalogue with its 34 weeks and 601 components/)).toBeInTheDocument();
    expect(screen.getByText(/Removes it and its 34 weeks and 601 components for good/)).toBeInTheDocument();
    expect(screen.getAllByText('Archived on its own').length).toBeGreaterThan(0);
  });

  it('asks the server for one page, and for the next when the reader turns it', async () => {
    records = Array.from({ length: 30 }, (_, index) => ({
      kind: 'module' as const,
      key: `module:MOD-${index}`,
      record: { ...archivedModule, id: `MOD-${index}`, title: `Module ${String(index).padStart(2, '0')}` } as CurriculumArchivedModule,
    }));
    renderArchive();
    await screen.findByText('Module 00');
    expect(fetchCurriculumArchivePage).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, pageSize: 25 }), expect.anything());
    expect(screen.getByText('30 archived records')).toBeVisible();
    expect(screen.getByRole('button', { name: /^Modules\s*30$/ })).toBeVisible();
    expect(screen.queryByText('Module 29')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Page 2' }));
    expect(await screen.findByText('Module 29')).toBeInTheDocument();
    expect(fetchCurriculumArchivePage).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }), expect.anything());
  });

  it('restores an archived module and re-reads the archive behind it', async () => {
    renderArchive('/curriculum/archive?type=module&q=MOD-ARCHIVED');
    await screen.findByText('Project Management Professional');
    const calls = fetchCurriculumArchivePage.mock.calls.length;

    await userEvent.click(await screen.findByRole('button', { name: /^restore$/i }));

    await waitFor(() => expect(restoreCurriculumModule).toHaveBeenCalledWith('MOD-ARCHIVED'));
    // The row it dealt with has to leave the list, which means re-reading it.
    await waitFor(() => expect(fetchCurriculumArchivePage.mock.calls.length).toBe(calls + 1));
  });

  it('opens on the one record a ?type= and ?q= link names', async () => {
    renderArchive('/curriculum/archive?type=module&q=MOD-ARCHIVED');

    expect(await screen.findByText('Project Management Professional')).toBeInTheDocument();
    expect(fetchCurriculumArchivePage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'module', q: 'MOD-ARCHIVED' }), expect.anything(),
    );
    expect(screen.queryByText('Data Foundations')).not.toBeInTheDocument();
  });

  it('lists what a programme took with it under the programme, and blocks restoring those on their own', async () => {
    records = [
      { kind: 'programme', key: 'programme:PROG-OLD', record: archivedProgramme },
      { kind: 'cohort', key: 'cohort:COH-OLD', record: cohortWithProgramme },
    ];
    renderArchive();

    // The redesigned columns show the record name and its programme ownership.
    expect(await screen.findAllByText('Retired Leadership Programme')).toHaveLength(2);
    // One entry, not two rows: the cohort waits behind its programme.
    expect(screen.queryByText('Spring Intake')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /\+ 1 cohort archived with it/ }));
    expect(await screen.findByText('Spring Intake')).toBeInTheDocument();
    expect(screen.getByText(/Can’t restore: Its programme is archived too/)).toBeInTheDocument();
    expect(within(screen.getByText('Spring Intake').parentElement!.parentElement!).getByRole('button', { name: /^Restore$/ })).toBeDisabled();

    // The Cohorts tab lists it flat, still saying where it came from.
    await userEvent.click(screen.getByRole('button', { name: /Cohorts/ }));
    await waitFor(() => expect(fetchCurriculumArchivePage).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'cohort' }), expect.anything(),
    ));
    expect(await screen.findByText('Archived with the programme Retired Leadership Programme')).toBeInTheDocument();
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

    expect(await screen.findByText('Gantt charts')).toBeInTheDocument();
    expect(fetchCurriculumArchiveRecord).toHaveBeenCalledWith('module:MOD-ARCHIVED', expect.anything());
    expect(fetchArchivedModuleStructure).toHaveBeenCalledWith('MOD-ARCHIVED', expect.anything());
    expect(screen.getByText('Gantt charts').closest('[data-focused]')).toHaveAttribute('data-focused', 'true');
    expect(screen.getByText('Risk logs').closest('[data-focused]')).toBeNull();
    expect(screen.queryByText('Welcome')).not.toBeInTheDocument();
  });

  it('opens a linked record that is not on the page being shown', async () => {
    records = [
      ...Array.from({ length: 30 }, (_, index) => ({
        kind: 'module' as const,
        key: `module:MOD-${index}`,
        record: { ...archivedModule, id: `MOD-${index}`, title: `Module ${index}`, archivedAt: '2026-09-01T00:00:00Z' } as CurriculumArchivedModule,
      })),
      { kind: 'module', key: 'module:MOD-OTHER', record: otherArchivedModule },
    ];
    renderArchive('/curriculum/archive?open=module%3AMOD-OTHER');
    // Not on page 1 of the list, so the only place it can be is the panel.
    expect(await screen.findByText(/^Archived module/)).toBeInTheDocument();
    expect(screen.getAllByText('Data Foundations').length).toBeGreaterThan(0);
  });

  it('sends an item archived out of a still-live module on to the Module Builder at its week', async () => {
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

  it('hands a live module on to the Builder even when the list read fails', async () => {
    fetchCurriculumArchivePage.mockRejectedValueOnce(new Error('Curriculum API returned 502'));
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

  it('reads a programme\'s KSB numbers only when its panel opens', async () => {
    records = [{ kind: 'programme', key: 'programme:PROG-OLD', record: archivedProgramme }];
    fetchProgrammeKsbStats.mockImplementationOnce(() => new Promise(() => undefined));
    renderArchive();
    expect(await screen.findAllByText('Retired Leadership Programme')).toHaveLength(2);
    // The archive lists the programme without asking for its numbers.
    expect(fetchProgrammeKsbStats).not.toHaveBeenCalled();
    // Its real archive date, not "Date not recorded".
    expect(screen.queryByText('Date not recorded')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /details/i }));
    expect(await screen.findByText('Loading…')).toBeInTheDocument();
    expect(fetchProgrammeKsbStats).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('0 of 10')).not.toBeInTheDocument();
  });

  it('fills in a programme\'s KSB line when its numbers arrive, and drops it when they cannot be read', async () => {
    records = [{ kind: 'programme', key: 'programme:PROG-OLD', record: archivedProgramme }];
    fetchProgrammeKsbStats.mockResolvedValueOnce({ ksbMapped: 7, ksbTotal: 10 });
    const first = renderArchive('/curriculum/archive?open=programme%3APROG-OLD');
    expect(await screen.findByText('7 of 10')).toBeInTheDocument();
    first.unmount();

    fetchProgrammeKsbStats.mockRejectedValueOnce(new Error('Curriculum API returned 404'));
    renderArchive('/curriculum/archive?open=programme%3APROG-OLD');
    expect(await screen.findAllByText('Retired Leadership Programme')).not.toHaveLength(0);
    await waitFor(() => expect(screen.queryByText('Loading…')).not.toBeInTheDocument());
    expect(screen.queryByText(/of 10/)).not.toBeInTheDocument();
  });

  it('says the archive is empty when it is, rather than staying on a skeleton', async () => {
    records = [];
    renderArchive();
    expect(await screen.findByText('Nothing in the archive')).toBeInTheDocument();
    expect(screen.getByText('0 archived records')).toBeVisible();
  });

  it('reports a failed read as a failure, not as an empty archive, and retries', async () => {
    fetchCurriculumArchivePage.mockRejectedValueOnce(new Error('Curriculum API timed out for /curriculum/archive/'));
    renderArchive();

    expect(await screen.findByText('The archive could not be read')).toBeInTheDocument();
    expect(screen.queryByText('Nothing in the archive')).not.toBeInTheDocument();
    expect(screen.queryByText('0 archived records')).not.toBeInTheDocument();
    expect(screen.getByText(/timed out/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(await screen.findByText('Project Management Professional')).toBeInTheDocument();
    expect(screen.queryByText('The archive could not be read')).not.toBeInTheDocument();
  });
});

function recordActions(name: string) {
  const title = screen.getAllByText(name).find(element => element.tagName === 'P')!;
  return within(title.parentElement!.parentElement!);
}

describe('Archive design data and actions', () => {
  beforeEach(() => {
    records = [
      { kind: 'module', key: 'module:MOD-ARCHIVED', record: archivedModule },
      { kind: 'module', key: 'module:MOD-OTHER', record: otherArchivedModule },
    ];
    fetchCurriculumArchivePage.mockReset().mockImplementation(async params => archivePage(params));
    restoreCurriculumModule.mockReset().mockResolvedValue({ restored: true, id: 'MOD-ARCHIVED' });
    restoreCurriculumProgramme.mockClear();
    restoreCurriculumCohort.mockClear();
    restoreCurriculumGroup.mockClear();
    permanentlyDeleteCurriculumModule.mockClear();
  });

  it('keeps type-qualified record identity when all four kinds share the same ID', async () => {
    records = [
      { kind: 'programme', key: 'programme:SAME', record: { ...archivedProgramme, id: 'SAME', sourceId: 'SAME', name: 'Archived programme' } },
      { kind: 'cohort', key: 'cohort:SAME', record: { ...cohortWithProgramme, id: 'SAME', name: 'Archived cohort', programmeId: 'ACTIVE', archivedViaParent: '', archivedBy: '' } },
      { kind: 'group', key: 'group:SAME', record: { id: 'SAME', name: 'Archived group', cohortId: 'ACTIVE-COHORT', cohort: 'Existing cohort', programmeId: 'ACTIVE', programme: 'Existing programme', learners: 0, cohortArchived: false } as CurriculumArchivedGroup },
      { kind: 'module', key: 'module:SAME', record: { ...archivedModule, id: 'SAME', catalogueId: 'SAME', title: 'Archived module', programmeId: 'ACTIVE' } },
    ];
    renderArchive();
    await screen.findByText('Archived module');
    expect(recordActions('Archived programme').getByText('Archived on its own')).toBeVisible();
    expect(recordActions('Archived programme').queryByText('Archived with its programme')).not.toBeInTheDocument();
    expect(restoreCurriculumProgramme).not.toHaveBeenCalled();
    for (const [name, restore] of [
      ['Archived programme', restoreCurriculumProgramme], ['Archived cohort', restoreCurriculumCohort],
      ['Archived group', restoreCurriculumGroup], ['Archived module', restoreCurriculumModule],
    ] as const) {
      await userEvent.click(recordActions(name).getByRole('button', { name: /^Restore$/ }));
      await waitFor(() => expect(restore).toHaveBeenCalledWith('SAME'));
      await waitFor(() => expect(recordActions(name).getByRole('button', { name: /^Restore$/ })).toBeEnabled());
      expect(restore).toHaveBeenCalledTimes(1);
    }
  });

  it('shows dependency blockers and keeps unavailable restores disabled', async () => {
    records = [
      { kind: 'module', key: 'module:MOD-ARCHIVED', record: { ...archivedModule, programmeArchived: true } },
      { kind: 'group', key: 'group:GROUP-OLD', record: { id: 'GROUP-OLD', name: 'Archived dependent group', cohort: 'Archived parent cohort', programme: 'Original programme', programmeId: 'ORIGINAL', cohortArchived: true, learners: 0 } as CurriculumArchivedGroup },
    ];
    renderArchive();
    await screen.findByText('Archived dependent group');
    expect(recordActions('Project Management Professional').getByRole('button', { name: /^Restore$/ })).toBeDisabled();
    expect(recordActions('Archived dependent group').getByRole('button', { name: /^Restore$/ })).toBeDisabled();
    expect(recordActions('Archived dependent group').getByText(/^Its cohort is archived too/)).toBeVisible();
    expect(screen.getByText('Non-restorable total unavailable')).toBeVisible();
    expect(restoreCurriculumModule).not.toHaveBeenCalled();
    expect(restoreCurriculumGroup).not.toHaveBeenCalled();
  });

  it('retains a failed restore and reconciles rows and totals only from the subsequent server read', async () => {
    restoreCurriculumModule.mockRejectedValueOnce(new CurriculumApiError('Conflict', 409, '/curriculum/modules/MOD-ARCHIVED/restore/', { error: 'The programme is now archived' })).mockImplementationOnce(async () => {
      records = records.filter(item => item.key !== 'module:MOD-ARCHIVED');
      return { restored: true, id: 'MOD-ARCHIVED' };
    });
    renderArchive('/curriculum/archive?type=module');
    await screen.findByText('Project Management Professional');
    await userEvent.click(recordActions('Project Management Professional').getByRole('button', { name: /^Restore$/ }));
    expect(await screen.findByText('The programme is now archived')).toBeVisible();
    expect(screen.getByText('2 archived records')).toBeVisible();
    expect(screen.getByText('Project Management Professional')).toBeVisible();
    await waitFor(() => expect(recordActions('Project Management Professional').getByRole('button', { name: /^Restore$/ })).toBeEnabled());
    await userEvent.click(recordActions('Project Management Professional').getByRole('button', { name: /^Restore$/ }));
    await waitFor(() => expect(screen.queryByText('Project Management Professional')).not.toBeInTheDocument());
    expect(screen.getByText('1 archived record')).toBeVisible();
    expect(screen.getByText('Data Foundations')).toBeVisible();
  });

  it('locks duplicate submissions and other actions through the authoritative refresh', async () => {
    let finishRestore!: (value: { restored: boolean; id: string }) => void;
    let finishRead!: (value: CurriculumArchivePage) => void;
    restoreCurriculumModule.mockImplementationOnce(() => new Promise(resolve => { finishRestore = resolve; }));
    renderArchive();
    await screen.findByText('Project Management Professional');
    fetchCurriculumArchivePage.mockImplementationOnce(() => new Promise(resolve => { finishRead = resolve; }));
    const restore = recordActions('Project Management Professional').getByRole('button', { name: /^Restore$/ });
    fireEvent.click(restore); fireEvent.click(restore);
    await waitFor(() => expect(restoreCurriculumModule).toHaveBeenCalledTimes(1));
    expect(recordActions('Data Foundations').getByRole('button', { name: /^Delete$/ })).toBeDisabled();
    await act(async () => finishRestore({ restored: true, id: 'MOD-ARCHIVED' }));
    await waitFor(() => expect(finishRead).toBeTypeOf('function'));
    expect(restore).toBeDisabled();
    await act(async () => finishRead(archivePage({ page: 1, pageSize: 25 })));
    await waitFor(() => expect(restore).toBeEnabled());
    // No optimistic removal: this response still contains the original row.
    expect(screen.getByText('Project Management Professional')).toBeVisible();
  });

  it('does not substitute update dates, current users, unavailable item counts or retention claims', async () => {
    records = [{ kind: 'programme', key: 'programme:PROG-OLD', record: { ...archivedProgramme, archivedAt: '', lastUpdated: '2060-01-01', modules: undefined } as unknown as CurriculumArchivedProgramme }];
    renderArchive();
    await screen.findAllByText('Retired Leadership Programme');
    const row = recordActions('Retired Leadership Programme');
    expect(row.getByText('Date not recorded')).toBeVisible();
    expect(row.getByText('Module count unavailable')).toBeVisible();
    expect(row.getByText('Not recorded')).toBeVisible();
    expect(row.queryByText(/2060/)).not.toBeInTheDocument();
    expect(row.queryByText(/programme-delete/)).not.toBeInTheDocument();
    expect(row.queryByText(/retention expired|as a copy|restore to draft/i)).not.toBeInTheDocument();
  });

  it('preserves the permanent-delete action for the chosen module', async () => {
    renderArchive();
    await screen.findByText('Project Management Professional');
    await userEvent.click(recordActions('Project Management Professional').getByRole('button', { name: /^Delete$/ }));
    await waitFor(() => expect(permanentlyDeleteCurriculumModule).toHaveBeenCalledWith('MOD-ARCHIVED'));
    expect(permanentlyDeleteCurriculumModule).toHaveBeenCalledTimes(1);
    expect(restoreCurriculumModule).not.toHaveBeenCalled();
  });

  it('filters by the original archived programme ID and resets server filters without writes', async () => {
    records = [
      { kind: 'programme', key: 'programme:PROG-OLD', record: archivedProgramme },
      { kind: 'module', key: 'module:MOD-ARCHIVED', record: { ...archivedModule, programmeId: 'PROG-OLD', programme: archivedProgramme.name } },
      { kind: 'module', key: 'module:MOD-OTHER', record: otherArchivedModule },
    ];
    renderArchive();
    await screen.findByText('Project Management Professional');
    await userEvent.click(screen.getByRole('combobox', { name: 'Programme' }));
    await userEvent.click(screen.getByRole('option', { name: 'Retired Leadership Programme' }));
    await waitFor(() => expect(fetchCurriculumArchivePage).toHaveBeenLastCalledWith(expect.objectContaining({ programme: 'PROG-OLD', page: 1 }), expect.anything()));
    await waitFor(() => expect(screen.queryByText('Data Foundations')).not.toBeInTheDocument());
    // Global totals are unaffected by a programme filter.
    expect(screen.getByText('3 archived records')).toBeVisible();
    expect(screen.getByRole('button', { name: /^Modules\s*1$/ })).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: /^Modules/ }));
    await userEvent.type(screen.getByRole('textbox', { name: /Search/ }), 'Foundations');
    await waitFor(() => expect(fetchCurriculumArchivePage).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'module', programme: 'PROG-OLD', q: 'Foundations', pageSize: 25 }), expect.anything()));
    expect(await screen.findByText('No archived records match these filters')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: /^Reset$/ }));
    expect(await screen.findByText('Data Foundations')).toBeVisible();
    await waitFor(() => expect(fetchCurriculumArchivePage).toHaveBeenLastCalledWith(expect.objectContaining({ type: '', programme: '', q: '', page: 1 }), expect.anything()));
    expect(restoreCurriculumModule).not.toHaveBeenCalled();
    expect(restoreCurriculumProgramme).not.toHaveBeenCalled();
    expect(permanentlyDeleteCurriculumModule).not.toHaveBeenCalled();
  });
});
