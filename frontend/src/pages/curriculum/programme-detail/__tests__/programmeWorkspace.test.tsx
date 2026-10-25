import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type {
  CurriculumCohort,
  CurriculumComponent,
  CurriculumComponentSummaryRow,
  CurriculumGroup,
  CurriculumModule,
  CurriculumProgramme,
  CurriculumProgrammeDetail,
  CurriculumSession,
} from '@/lib/curriculumApi';

/**
 * The Programme workspace is the top of the hierarchy, and every level below it
 * already has a page that owns it. So this page is only allowed to answer the
 * questions that need the whole programme in view; anything that belongs to one
 * cohort, group or module is *opened*, never redrawn here.
 *
 * These tests pin that boundary, because it is exactly what drifted before: the
 * page had grown a flat Groups tab that repeated the Cohorts tab, a Weeks tab
 * that repeated the module's own timeline, and a Review tab that drew cohorts,
 * groups, modules and weeks a third time.
 */

const programme = {
  id: 'program-data',
  sourceId: 'PROG-DATA',
  name: 'Data Analyst',
  standard: 'ST0118',
  level: 'Level 4',
  owner: 'Rachel Myers',
  color: '#6941c6',
  description: 'Data curriculum',
} as CurriculumProgramme;

const cohorts = [
  {
    id: 'COHORT-1',
    name: 'Sept 2026',
    programme: 'Data Analyst',
    programmeId: 'PROG-DATA',
    startDate: '2026-09-02',
    endDate: '2027-06-30',
    apprenticeshipEndDate: '2027-09-30',
    epaMonths: 3,
    status: 'active',
    learners: 12,
    holidayIds: [],
    modules: [],
  },
] as unknown as CurriculumCohort[];

const groups = [
  {
    id: 'GROUP-1',
    name: 'Group A',
    cohortId: 'COHORT-1',
    cohort: 'Sept 2026',
    programme: 'Data Analyst',
    programmeId: 'PROG-DATA',
    learners: 12,
    coach: 'Coach One',
    // Carried by the payload, and deliberately never rendered on a group: the
    // tutor is assigned per module, in the module form.
    tutor: 'Tutor One',
    startDate: '2026-09-02',
    endDate: '2027-06-30',
    status: 'active',
    schedule: 'Mondays',
    mode: 'Live',
    modules: ['Data Foundations'],
    sessions: 6,
  },
] as unknown as CurriculumGroup[];

const modules = [
  {
    id: 'MOD-1',
    moduleCatalogueId: 'MOD-1',
    sourceId: 1,
    name: 'Data Foundations',
    programme: 'Data Analyst',
    programmeId: 'PROG-DATA',
    cohortId: 'COHORT-1',
    cohort: 'Sept 2026',
    groupId: 'GROUP-1',
    group: 'Group A',
    tutor: 'Tutor One',
    weeks: 1,
    status: 'published',
    ksbCodes: ['K1'],
  },
  {
    // Stored against a cohort that is not a cohort record on this programme.
    // The page used to synthesize a cohort row for it, which is why its cohort
    // count could disagree with the Cohorts page.
    id: 'MOD-2',
    moduleCatalogueId: 'MOD-2',
    sourceId: 2,
    name: 'Orphan Module',
    programme: 'Data Analyst',
    programmeId: 'PROG-DATA',
    cohort: 'Ghost Cohort',
    group: 'Ghost Group',
    tutor: '',
    weeks: 0,
    status: 'draft',
    ksbCodes: [],
  },
] as unknown as CurriculumModule[];

const components = [
  {
    id: 'COMP-1',
    moduleCatalogueId: 'MOD-1',
    title: 'Intro live session',
    type: 'Live Session',
    module: 'Data Foundations',
    programme: 'Data Analyst',
    week: 'Week 1',
    weekTitle: 'Getting started',
    duration: 60,
    expectedOtjh: 1,
    ksbRefs: ['K1'],
    status: 'published',
    lastEdited: '',
    settings: {
      liveSessionUrl: 'https://teams.example/meet/1',
      sessionDate: '2026-09-07',
      sessionTime: '09:00',
      attendanceRequired: true,
    },
  },
] as unknown as CurriculumComponent[];

/**
 * What /components/summary/ answers for a component list: the server's
 * buckets, written out here independently of the page, so the Overview is
 * tested against the same input whichever of the two reads it was built from.
 */
function summaryOf(rows: CurriculumComponent[]): CurriculumComponentSummaryRow[] {
  const buckets = new Map<string, CurriculumComponentSummaryRow>();
  rows.forEach(row => {
    const moduleCatalogueId = String(row.moduleCatalogueId || '');
    const key = [moduleCatalogueId, row.weekId || '', row.week, row.weekTitle, row.module, row.programme].join('|');
    const bucket = buckets.get(key) || {
      moduleCatalogueId, moduleId: String(row.moduleId || moduleCatalogueId), weekId: String(row.weekId || ''),
      week: String(row.week || ''), weekTitle: String(row.weekTitle || ''), module: String(row.module || ''),
      programme: String(row.programme || ''), count: 0, publishedCount: 0, otjhMinutes: 0,
      displayOrder: null, title: '',
    };
    bucket.count += 1;
    bucket.publishedCount += row.status === 'published' ? 1 : 0;
    bucket.otjhMinutes += Math.max(0, Math.round((Number(row.expectedOtjh) || 0) * 60));
    const order = Number(row.displayOrder ?? 0);
    if (bucket.displayOrder === null || order < bucket.displayOrder) {
      bucket.displayOrder = order;
      bucket.title = String(row.title || '');
    }
    buckets.set(key, bucket);
  });
  return [...buckets.values()];
}

vi.mock('@/components/feature/WorkspaceShell', () => ({
  WorkspaceShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/feature/CurriculumSweetAlert', () => ({
  showCurriculumAlert: vi.fn(async () => undefined),
  showCurriculumConfirm: vi.fn(async () => undefined),
}));

vi.mock('@/api/curriculumLearnerAssignments', () => ({
  fetchLearnerAssignments: vi.fn(async (target: { id: string; name: string; scope: string }) => ({
    target: { ...target, moduleCount: 1, programmeName: 'Data Analyst' },
    learners: [], totals: { learnerCount: 0, assignedCount: 0 },
  })),
  assignCurriculumLearners: vi.fn(),
  unassignCurriculumLearners: vi.fn(),
  applyCurriculumLearnerAssignments: vi.fn(async () => ({
    added: [], removed: [], failed: [], failureMessage: null, abandoned: false,
    changedCount: 0, moduleCount: 1,
  })),
}));

vi.mock('@/lib/curriculumApi', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/curriculumApi')>()),
  fetchCurriculumProgrammeDetail: vi.fn(async () => ({
    schema: 'test',
    programme,
    cohorts: [],
    flat: { cohorts, groups, groupIds: ['GROUP-1'], modules, sessions: [], components: [] },
  })),
  fetchCurriculumProgrammeDetailShell: vi.fn(async () => ({
    schema: 'test',
    programme,
    flat: { cohorts, groups, groupIds: ['GROUP-1'], weekTemplates: [] },
  })),
  fetchCurriculumProgrammeDetailModules: vi.fn(async () => ({
    schema: 'test',
    flat: { modules, sessions: [] },
  })),
  fetchProgrammeKsbStats: vi.fn(async () => ({ programmeId: 'PROG-DATA' })),
  fetchCurriculumComponents: vi.fn(async () => components),
  fetchCurriculumComponentSummary: vi.fn(async () => summaryOf(components)),
  fetchCurriculumProgrammes: vi.fn(async () => [programme]),
  fetchCurriculumCoaches: vi.fn(async () => [{ id: 1, name: 'Coach One' }, { id: 2, name: 'Coach Two' }]),
  fetchCurriculumTutors: vi.fn(async () => [{ id: 3, name: 'Tutor One' }]),
  fetchCurriculumKsbFrameworks: vi.fn(async () => []),
  fetchCurriculumHolidays: vi.fn(async () => []),
  fetchCurriculumKsbSets: vi.fn(async () => []),
  fetchCurriculumStandards: vi.fn(async () => []),
  fetchCurriculumProgrammeKsbCoverage: vi.fn(async () => null),
  fetchCurriculumProgrammeKsbCoverageSummary: vi.fn(async () => null),
  fetchCurriculumKsbAchievement: vi.fn(async () => ({
    appliedSource: { type: 'standard', id: 'ST0118', label: 'Data standard', definitionCount: 1 },
    summary: { appliedKsbCount: 1, consumedKsbCount: 0, learnerCount: 0, consumptionCount: 0 },
    items: [], ksbPagination: { page: 1, pageSize: 25, total: 0, hasNext: false },
    consumptionLog: { items: [], page: 1, pageSize: 50, total: 0, hasNext: false },
  })),
  fetchCurriculumProgrammeLearnerRoster: vi.fn(async () => ({ assignedLearners: [] })),
  fetchCurriculumScopeLearnerRoster: vi.fn(async () => ({ assignedLearners: [] })),
  fetchCurriculumProgrammeLearnerKsbImpact: vi.fn(async () => null),
  fetchProgrammeReviews: vi.fn(async () => []),
  // Inert like the real one; a test that needs a remote write captures the listener.
  subscribeCurriculumRemoteWrites: vi.fn(() => () => {}),
}));

/**
 * Moves the clock the page reads its return-refresh interval from. Restored by
 * the returned function; the timers themselves keep running for real.
 */
function skewClock() {
  const realNow = Date.now.bind(Date);
  let skew = 0;
  const spy = vi.spyOn(Date, 'now').mockImplementation(() => realNow() + skew);
  return {
    advance(ms: number) { skew += ms; },
    restore() { spy.mockRestore(); },
  };
}

async function returnToTab() {
  await act(async () => { window.dispatchEvent(new Event('focus')); });
}

/** The page reads the detail document in two parts; serve both from one document. */
function mockProgrammeDetailOnce(api: typeof import('@/lib/curriculumApi'), detail: CurriculumProgrammeDetail) {
  const { modules: detailModules, sessions: detailSessions, ...shellFlat } = detail.flat;
  vi.mocked(api.fetchCurriculumProgrammeDetailShell).mockResolvedValueOnce({ schema: detail.schema, programme: detail.programme, flat: shellFlat });
  vi.mocked(api.fetchCurriculumProgrammeDetailModules).mockResolvedValueOnce({ schema: detail.schema, flat: { modules: detailModules, sessions: detailSessions } });
}

async function renderWorkspace(query = '') {
  const { default: ProgrammeDetailPage } = await import('../page');
  const result = render(
    <MemoryRouter initialEntries={[`/curriculum/programmes/PROG-DATA${query}`]}>
      <Routes>
        <Route path="/curriculum/programmes/:id" element={<ProgrammeDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
  await screen.findByRole('heading', { name: 'Data Analyst' });
  return result;
}

async function renderEmbeddedWorkspace() {
  const { default: ProgrammeDetailPage } = await import('../page');
  return render(<MemoryRouter initialEntries={['/curriculum/programmes']}><ProgrammeDetailPage programmeId="PROG-DATA" embedded /></MemoryRouter>);
}

/** The tab strip, which is the page's table of contents. */
function tabStrip() {
  const overview = screen.getByRole('button', { name: /Overview/ });
  const strip = overview.parentElement?.parentElement;
  if (!strip) throw new Error('No tab strip rendered');
  return within(strip);
}

async function openTab(name: RegExp) {
  await userEvent.click(tabStrip().getByRole('button', { name }));
}

describe('Programme workspace', { timeout: 15000 }, () => {
  it('keeps timeline details and its editor on the chosen placement when two groups share a catalogue module', async () => {
    const api = await import('@/lib/curriculumApi');
    const moduleForm = await import('@/pages/curriculum/shared/entities/moduleForm');
    vi.clearAllMocks();
    const secondGroup = { ...groups[0], id: 'GROUP-2', name: 'Group B', coach: 'Coach Two' };
    const placements = [groups[0], secondGroup].map((group, index) => ({
      ...modules[0], id: `PLACEMENT-${index + 1}`, moduleCatalogueId: 'MOD-SHARED',
      groupId: group.id, group: group.name, tutor: `Placement Tutor ${index + 1}`,
      startDate: '2026-09-07', endDate: '2026-09-28', sessionsNumber: 2,
      weeklySchedule: [{ day: 'Monday', startTime: '09:00', endTime: '11:00' }],
      sessionHolidays: [{ id: `H${index + 1}`, label: `Holiday ${index + 1}`, startDate: '2026-09-14', endDate: '2026-09-20' }],
    }));
    vi.mocked(api.fetchCurriculumProgrammeDetailShell).mockResolvedValueOnce({
      schema: 'curriculum', programme, flat: { cohorts, groups: [groups[0], secondGroup], groupIds: ['GROUP-1', 'GROUP-2'], weekTemplates: [] },
    });
    vi.mocked(api.fetchCurriculumProgrammeDetailModules).mockResolvedValueOnce({ schema: 'curriculum', flat: {
      modules: placements,
      sessions: [groups[0], secondGroup].map((group, index) => ({
        id: `S${index + 1}`, moduleCatalogueId: 'MOD-SHARED', groupId: group.id, cohortId: cohorts[0].id,
        module: modules[0].name, programme: programme.name, title: `Group ${index + 1} session`, date: '2026-09-21',
        skippedHolidays: ['2026-09-14'], week: 1, startTime: '09:00', endTime: '11:00',
      } as CurriculumSession)),
    } });
    // Observe the record passed to the existing editor without mounting its
    // scheduling side effects; the form's own mocked tests cover its saves.
    const target = vi.spyOn(moduleForm, 'moduleFormTarget').mockReturnValue(null);
    try {
      await renderEmbeddedWorkspace();
      await screen.findByRole('button', { name: 'Sept 2026 2 groups' });
      await userEvent.click(screen.getByRole('button', { name: 'Sept 2026 2 groups' }));
      const bars = screen.getAllByRole('link', { name: /Data Foundations.*7 Sept/ });
      expect(bars).toHaveLength(2);
      await userEvent.hover(bars[1]);
      const preview = screen.getByRole('dialog', { name: 'Data Foundations details' });
      expect(preview).toHaveTextContent('Placement Tutor 2');
      expect(preview).toHaveTextContent('Coach Two'); expect(preview).toHaveTextContent('Holiday 2');
      expect(preview).toHaveTextContent('Group 2 session');
      expect(preview).not.toHaveTextContent('Placement Tutor 1'); expect(preview).not.toHaveTextContent('Group 1 session');
      await userEvent.click(bars[1]);
      await userEvent.click(within(screen.getByRole('dialog', { name: 'Choose What To Edit' })).getByRole('button', { name: /Edit schedule assignment/ }));
      expect(target).toHaveBeenCalledWith(expect.objectContaining({ id: 'PLACEMENT-2', moduleCatalogueId: 'MOD-SHARED', groupId: 'GROUP-2' }));
    } finally { target.mockRestore(); }
  });

  it('embeds the existing programme data with seven primary sections and retains additional tools', async () => {
    const api = await import('@/lib/curriculumApi');
    vi.clearAllMocks();
    await renderEmbeddedWorkspace();
    await screen.findByRole('heading', { name: 'Data Analyst' });
    const tabs = within(screen.getByRole('tablist', { name: 'Programme sections' }));
    expect(tabs.getAllByRole('tab').map(tab => tab.textContent)).toEqual(['Overview', 'Cohorts', 'Groups', 'Modules', 'KSB Coverage', 'Reviews', 'Learners']);
    expect(screen.queryByRole('link', { name: /Open full programme workspace/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Refresh selected programme' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit programme' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Manage Cohorts & Groups' })).toBeInTheDocument();
    expect(screen.getByText('Guided learning hours').nextElementSibling).toHaveTextContent('Not provided');
    expect(screen.getByRole('region', { name: 'Delivery size' })).toHaveTextContent('Cohorts1Groups1Modules2Weeks1Learners12');
    await userEvent.click(within(screen.getByRole('region', { name: 'Delivery size' })).getByRole('button', { name: /Weeks/ }));
    expect(tabs.getByRole('tab', { name: 'Modules' })).toHaveAttribute('aria-selected', 'true');
    await userEvent.click(tabs.getByRole('tab', { name: 'Overview' }));
    await userEvent.click(tabs.getByRole('tab', { name: 'Learners' }));
    await screen.findByRole('heading', { name: /Learners in Data Analyst/ });
    expect(api.fetchCurriculumScopeLearnerRoster).toHaveBeenCalledWith('programme', 'PROG-DATA', expect.objectContaining({ learnerStatus: 'all' }), expect.anything());
    await userEvent.click(screen.getByText('More programme tools'));
    expect(screen.getByRole('button', { name: 'Sessions' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Achievement KSBs' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Quality' })).toBeInTheDocument();
  });

  it('does not claim successful readiness when coverage is unavailable', async () => {
    const api = await import('@/lib/curriculumApi');
    vi.mocked(api.fetchCurriculumProgrammeKsbCoverageSummary).mockRejectedValue(new Error('Coverage offline'));
    try {
      await renderEmbeddedWorkspace();
      await screen.findByRole('heading', { name: 'Data Analyst' });
      expect(await screen.findByText('Coverage offline')).toBeInTheDocument();
      expect(screen.getByText(/not attached to a live cohort/)).toBeInTheDocument();
      expect(screen.queryByText('Every group has a coach, every module has a tutor, every week has content and every KSB is mapped.')).not.toBeInTheDocument();
    } finally {
      vi.mocked(api.fetchCurriculumProgrammeKsbCoverageSummary).mockResolvedValue(null as never);
    }
  });

  it('synchronizes browser metadata without a refresh cycle and notifies the browser after the retained quality refresh', async () => {
    const api = await import('@/lib/curriculumApi');
    const { default: ProgrammeDetailPage } = await import('../page');
    vi.clearAllMocks();
    const onReloaded = vi.fn(async () => undefined);
    const view = render(<MemoryRouter><ProgrammeDetailPage programmeId="PROG-DATA" programmeSnapshot={programme} onReloaded={onReloaded} summaryActions={<button type="button">Add structure</button>} embedded /></MemoryRouter>);
    await screen.findByRole('heading', { name: 'Data Analyst' });
    const actions = within(screen.getByRole('group', { name: 'Programme actions' }));
    expect(actions.getByRole('button', { name: 'Edit programme' })).toBeInTheDocument();
    expect(actions.getByRole('button', { name: 'Add structure' })).toBeInTheDocument();
    const updated = { ...programme, name: 'Updated Data Analyst', color: '#0f766e' };
    vi.mocked(api.fetchCurriculumProgrammeDetailShell).mockResolvedValueOnce({ schema: 'test', programme: updated, flat: { cohorts, groups, groupIds: ['GROUP-1'], weekTemplates: [] } });
    view.rerender(<MemoryRouter><ProgrammeDetailPage programmeId="PROG-DATA" programmeSnapshot={updated} onReloaded={onReloaded} embedded /></MemoryRouter>);
    await screen.findByRole('heading', { name: 'Updated Data Analyst' });
    expect(screen.getByRole('region', { name: 'Programme summary' })).toHaveStyle({ '--programme-color': '#0f766e' });
    expect(onReloaded).not.toHaveBeenCalled();
    expect(api.fetchCurriculumProgrammeDetailShell).toHaveBeenCalledTimes(2);
    vi.mocked(api.fetchCurriculumProgrammeDetailShell).mockResolvedValueOnce({ schema: 'test', programme: updated, flat: { cohorts, groups, groupIds: ['GROUP-1'], weekTemplates: [] } });
    await userEvent.click(screen.getByText('More programme tools'));
    await userEvent.click(screen.getByRole('button', { name: /^Quality$/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Refresh checks' }));
    await vi.waitFor(() => expect(onReloaded).toHaveBeenCalledTimes(1));
    expect(api.fetchCurriculumProgrammeDetailShell).toHaveBeenCalledTimes(3);
  });

  it('keeps late responses for the previous programme out of the selected workspace', async () => {
    const api = await import('@/lib/curriculumApi');
    const { default: ProgrammeDetailPage } = await import('../page');
    let resolveOld!: (value: Awaited<ReturnType<typeof api.fetchCurriculumProgrammeDetailShell>>) => void;
    vi.mocked(api.fetchCurriculumProgrammeDetailShell).mockReturnValueOnce(new Promise(resolve => { resolveOld = resolve; }));
    const view = await renderEmbeddedWorkspace();
    await vi.waitFor(() => expect(resolveOld).toBeTypeOf('function'));
    const nextProgramme = { ...programme, id: 'PROG-NEXT', sourceId: 'PROG-NEXT', name: 'Second Programme' };
    vi.mocked(api.fetchCurriculumProgrammeDetailShell).mockResolvedValueOnce({ schema: 'test', programme: nextProgramme, flat: { cohorts: [], groups: [], groupIds: [], weekTemplates: [] } });
    view.rerender(<MemoryRouter initialEntries={['/curriculum/programmes']}><ProgrammeDetailPage key="PROG-NEXT" programmeId="PROG-NEXT" embedded /></MemoryRouter>);
    await screen.findByRole('heading', { name: 'Second Programme' });
    await act(async () => { resolveOld({ schema: 'test', programme, flat: { cohorts, groups, groupIds: ['GROUP-1'], weekTemplates: [] } }); });
    expect(screen.getByRole('heading', { name: 'Second Programme' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Data Analyst' })).not.toBeInTheDocument();
  });

  it('shows KSB summary counts while modules are still pending and loads the matrix only on its tab', async () => {
    const api = await import('@/lib/curriculumApi');
    vi.clearAllMocks();
    let finishModules!: (value: { schema: string; flat: { modules: CurriculumModule[]; sessions: CurriculumSession[] } }) => void;
    vi.mocked(api.fetchCurriculumProgrammeDetailModules).mockImplementationOnce(() => new Promise(resolve => { finishModules = resolve; }));
    vi.mocked(api.fetchCurriculumProgrammeKsbCoverageSummary).mockResolvedValueOnce({
      view: 'summary', scope: 'programme', identifier: 'PROG-DATA', items: [
        { code: 'K1', title: 'K1', coverage_key: 'standard|st0118|K1', source_type: 'standard', source_id: 'ST0118', raw_total_weight: 0, occurrence_count: 1 },
        { code: 'K2', title: 'K2', coverage_key: 'standard|st0118|K2', source_type: 'standard', source_id: 'ST0118', raw_total_weight: 0, occurrence_count: 0 },
      ],
    } as never);
    await renderWorkspace();
    await screen.findByText('1/2 mapped');
    expect(tabStrip().getByRole('button', { name: /KSB Coverage/ })).toHaveTextContent('1');
    expect(api.fetchCurriculumProgrammeKsbCoverage).not.toHaveBeenCalled();
    expect(api.fetchCurriculumComponents).not.toHaveBeenCalled();
    await openTab(/KSB Coverage/);
    await vi.waitFor(() => expect(api.fetchCurriculumProgrammeKsbCoverage).toHaveBeenCalledTimes(1));
    await act(async () => { finishModules({ schema: 'test', flat: { modules, sessions: [] } }); });
  });
  it('opens Achievement with its own projection and summary reads, without the component list or coverage matrix', async () => {
    const api = await import('@/lib/curriculumApi');
    vi.clearAllMocks();
    await renderWorkspace('?tab=achievement');
    await screen.findByText('Actual KSB consumption across this programme');
    await vi.waitFor(() => expect(api.fetchCurriculumComponentSummary).toHaveBeenCalledTimes(1));
    expect(api.fetchCurriculumKsbAchievement).toHaveBeenCalledWith('PROG-DATA', expect.anything(), expect.anything());
    expect(api.fetchCurriculumComponents).not.toHaveBeenCalled();
    expect(api.fetchCurriculumProgrammeKsbCoverage).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(api.fetchCurriculumProgrammeKsbCoverageSummary).toHaveBeenCalledTimes(1));
    const clock = skewClock();
    try {
      clock.advance(31_000);
      await returnToTab();
      await vi.waitFor(() => expect(api.fetchCurriculumComponentSummary).toHaveBeenCalledTimes(2));
      expect(api.fetchCurriculumComponents).not.toHaveBeenCalled();
      expect(api.fetchCurriculumProgrammeKsbCoverage).not.toHaveBeenCalled();
    } finally {
      clock.restore();
    }
    await openTab(/KSB Coverage/);
    await vi.waitFor(() => expect(api.fetchCurriculumProgrammeKsbCoverage).toHaveBeenCalledTimes(1));
    expect(api.fetchCurriculumComponents).toHaveBeenCalledTimes(1);
  });

  it('loads only overview dependencies and does not repeat components when stats arrive', async () => {
    const api = await import('@/lib/curriculumApi');
    vi.clearAllMocks();
    let finishStats!: (value: Awaited<ReturnType<typeof api.fetchProgrammeKsbStats>>) => void;
    vi.mocked(api.fetchProgrammeKsbStats).mockImplementationOnce(() => new Promise(resolve => { finishStats = resolve; }));
    await renderWorkspace();
    // The Overview's figures come from the summary; the full component list is
    // left for a tab that lists components.
    await vi.waitFor(() => expect(api.fetchCurriculumComponentSummary).toHaveBeenCalledTimes(1));
    expect(api.fetchCurriculumComponents).not.toHaveBeenCalled();
    expect(api.fetchCurriculumCoaches).not.toHaveBeenCalled();
    expect(api.fetchCurriculumTutors).not.toHaveBeenCalled();
    expect(api.fetchCurriculumHolidays).not.toHaveBeenCalled();
    expect(api.fetchCurriculumKsbFrameworks).not.toHaveBeenCalled();
    expect(api.fetchCurriculumKsbSets).not.toHaveBeenCalled();
    await act(async () => finishStats({ programmeId: 'PROG-DATA' } as Awaited<ReturnType<typeof api.fetchProgrammeKsbStats>>));
    expect(api.fetchCurriculumComponentSummary).toHaveBeenCalledTimes(1);
    expect(api.fetchCurriculumComponents).not.toHaveBeenCalled();
    await openTab(/Groups/);
    await vi.waitFor(() => expect(api.fetchCurriculumCoaches).toHaveBeenCalledTimes(1));
    expect(api.fetchCurriculumComponents).toHaveBeenCalledTimes(1);
    expect(api.fetchCurriculumTutors).not.toHaveBeenCalled();
    expect(api.fetchCurriculumHolidays).not.toHaveBeenCalled();
    await openTab(/KSB Coverage/);
    await vi.waitFor(() => expect(api.fetchCurriculumKsbSets).toHaveBeenCalledTimes(1));
    expect(api.fetchCurriculumComponents).toHaveBeenCalledTimes(1);
  });

  it('refreshes component contents after a return even when module IDs are unchanged', async () => {
    const api = await import('@/lib/curriculumApi');
    vi.clearAllMocks();
    await renderWorkspace();
    await vi.waitFor(() => expect(api.fetchCurriculumComponentSummary).toHaveBeenCalledTimes(1));
    // A tab that lists components has asked for the full list, so a return
    // refreshes both reads. (One return: the hook throttles a second.)
    await openTab(/Modules/);
    await vi.waitFor(() => expect(api.fetchCurriculumComponents).toHaveBeenCalledTimes(1));
    // Past the quiet spell that follows the first load.
    const clock = skewClock();
    try {
      clock.advance(31_000);
      await returnToTab();
      await vi.waitFor(() => expect(api.fetchCurriculumComponents).toHaveBeenCalledTimes(2));
      await vi.waitFor(() => expect(api.fetchCurriculumComponentSummary).toHaveBeenCalledTimes(2));
    } finally {
      clock.restore();
    }
    expect(api.fetchCurriculumComponents).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ revalidate: true }));
    expect(api.fetchCurriculumComponentSummary).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ revalidate: true }));
    expect(api.fetchProgrammeKsbStats).toHaveBeenLastCalledWith('PROG-DATA', undefined, expect.objectContaining({ revalidate: true }));
  });

  it('does not re-read on a return within 30 seconds of the last read', async () => {
    const api = await import('@/lib/curriculumApi');
    vi.clearAllMocks();
    await renderWorkspace();
    await vi.waitFor(() => expect(api.fetchCurriculumComponentSummary).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(api.fetchCurriculumScopeLearnerRoster).toHaveBeenCalledTimes(1));
    const clock = skewClock();
    try {
      // Clicking between DevTools and the page: a burst of returns, seconds apart.
      for (let i = 0; i < 5; i += 1) {
        clock.advance(5_000);
        await returnToTab();
      }
      expect(api.fetchCurriculumProgrammeDetailShell).toHaveBeenCalledTimes(1);
      expect(api.fetchCurriculumProgrammeDetailModules).toHaveBeenCalledTimes(1);
      expect(api.fetchProgrammeKsbStats).toHaveBeenCalledTimes(1);
      expect(api.fetchCurriculumComponentSummary).toHaveBeenCalledTimes(1);
      expect(api.fetchCurriculumScopeLearnerRoster).toHaveBeenCalledTimes(1);
      // 30s after the first load settled: exactly one round.
      clock.advance(6_000);
      await returnToTab();
      await vi.waitFor(() => expect(api.fetchCurriculumComponentSummary).toHaveBeenCalledTimes(2));
      expect(api.fetchCurriculumProgrammeDetailShell).toHaveBeenCalledTimes(2);
      expect(api.fetchCurriculumProgrammeDetailModules).toHaveBeenCalledTimes(2);
      expect(api.fetchProgrammeKsbStats).toHaveBeenCalledTimes(2);
      await vi.waitFor(() => expect(api.fetchCurriculumScopeLearnerRoster).toHaveBeenCalledTimes(2));
    } finally {
      clock.restore();
    }
  });

  it('does not start a second round on a return while one is still in flight', async () => {
    const api = await import('@/lib/curriculumApi');
    vi.clearAllMocks();
    await renderWorkspace();
    await vi.waitFor(() => expect(api.fetchCurriculumComponentSummary).toHaveBeenCalledTimes(1));
    let finishModules!: (value: { schema: string; flat: { modules: CurriculumModule[]; sessions: CurriculumSession[] } }) => void;
    vi.mocked(api.fetchCurriculumProgrammeDetailModules).mockImplementationOnce(() => new Promise(resolve => { finishModules = resolve; }));
    const clock = skewClock();
    try {
      clock.advance(31_000);
      await returnToTab();
      expect(api.fetchCurriculumProgrammeDetailShell).toHaveBeenCalledTimes(2);
      // The modules are still on their way: later returns, however far apart, wait.
      clock.advance(60_000);
      await returnToTab();
      clock.advance(60_000);
      await returnToTab();
      expect(api.fetchCurriculumProgrammeDetailShell).toHaveBeenCalledTimes(2);
      expect(api.fetchCurriculumProgrammeDetailModules).toHaveBeenCalledTimes(2);
      await act(async () => { finishModules({ schema: 'test', flat: { modules, sessions: [] } }); });
      // The modules stay on screen through the silent read, with no skeleton left behind.
      expect(screen.getByRole('heading', { name: 'Data Analyst' })).toBeInTheDocument();
      expect(screen.queryByRole('status', { name: 'Loading modules count' })).not.toBeInTheDocument();
    } finally {
      clock.restore();
    }
  });

  it('keeps the newer read when an older one answers last', async () => {
    const api = await import('@/lib/curriculumApi');
    vi.clearAllMocks();
    const listeners: Array<(path: string) => void> = [];
    vi.mocked(api.subscribeCurriculumRemoteWrites).mockImplementation(listener => {
      listeners.push(listener);
      return () => {};
    });
    await renderWorkspace();
    await vi.waitFor(() => expect(api.fetchCurriculumComponentSummary).toHaveBeenCalledTimes(1));
    let finishStaleShell!: (value: Awaited<ReturnType<typeof api.fetchCurriculumProgrammeDetailShell>>) => void;
    vi.mocked(api.fetchCurriculumProgrammeDetailShell)
      .mockImplementationOnce(() => new Promise(resolve => { finishStaleShell = resolve; }))
      .mockResolvedValueOnce({ schema: 'test', programme: { ...programme, name: 'Data Analyst Renamed' }, flat: { cohorts, groups, groupIds: ['GROUP-1'], weekTemplates: [] } } as never);
    const clock = skewClock();
    try {
      clock.advance(31_000);
      await returnToTab();
      // A write from elsewhere lands while the return read is still out.
      await act(async () => { listeners.forEach(listener => listener('*')); });
      expect(await screen.findByRole('heading', { name: 'Data Analyst Renamed' })).toBeInTheDocument();
      await act(async () => {
        finishStaleShell({ schema: 'test', programme, flat: { cohorts, groups, groupIds: ['GROUP-1'], weekTemplates: [] } } as never);
      });
      expect(screen.getByRole('heading', { name: 'Data Analyst Renamed' })).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Data Analyst' })).not.toBeInTheDocument();
    } finally {
      clock.restore();
      vi.mocked(api.subscribeCurriculumRemoteWrites).mockImplementation(() => () => {});
    }
  });

  it('shows the same Overview figures from the component summary as from the full component list', async () => {
    const api = await import('@/lib/curriculumApi');
    vi.clearAllMocks();
    const base = components[0];
    const authored = [
      { ...base, id: 'A-1', weekId: 'W-1', week: 'Week 1', weekTitle: 'Getting started', expectedOtjh: 0.33, status: 'published', displayOrder: 2 },
      { ...base, id: 'A-2', weekId: 'W-1', week: 'Week 1', weekTitle: 'Getting started', expectedOtjh: 0.33, status: 'draft', displayOrder: 1 },
      { ...base, id: 'A-3', weekId: 'W-3', week: 'Week 3', weekTitle: 'Week 3', expectedOtjh: 0.025, status: 'draft', displayOrder: 1 },
      // No authored week matches: placed by the number in its label.
      { ...base, id: 'A-4', weekId: 'W-GONE', week: 'Week 5', weekTitle: 'Week 5', expectedOtjh: 1.5, status: 'published', displayOrder: 1 },
      // Another module's component never counts here.
      { ...base, id: 'X-1', moduleCatalogueId: 'MOD-OTHER', moduleId: 'MOD-OTHER', expectedOtjh: 50, status: 'published' },
    ] as unknown as CurriculumComponent[];
    const outlined = [{
      ...modules[0],
      weeks: 3,
      weekStructure: [
        { id: 'W-1', weekNumber: 1, title: 'Getting started' },
        { id: 'W-2', weekNumber: 2, title: 'An empty week' },
        { id: 'W-3', weekNumber: 3, title: '' },
      ],
    }] as unknown as CurriculumModule[];
    mockProgrammeDetailOnce(api, {
      schema: 'test', programme, cohorts: [],
      flat: { cohorts, groups, groupIds: ['GROUP-1'], modules: outlined, sessions: [], components: [] },
    });
    vi.mocked(api.fetchCurriculumComponentSummary).mockResolvedValueOnce(summaryOf(authored));
    vi.mocked(api.fetchCurriculumComponents).mockResolvedValueOnce(authored);

    await renderWorkspace();
    const readiness = () => screen.getByText('Authored OTJH').parentElement?.parentElement?.textContent;
    // 4 weeks (1, 2, 3 and the label-placed 5); 4 components; 20+20+2+90 minutes.
    await vi.waitFor(() => expect(readiness()).toContain('Components4'));
    const fromSummary = {
      readiness: readiness(),
      hero: screen.getByText(/\d+ components$/).textContent,
      empty: screen.getByText(/weeks? (has|have) no content/).textContent,
    };
    expect(fromSummary.readiness).toContain('Weeks4');
    expect(fromSummary.readiness).toContain('Authored OTJH2h 12m');
    expect(fromSummary.hero).toBe('4 components');
    expect(fromSummary.empty).toBe('1 week has no content');
    expect(api.fetchCurriculumComponents).not.toHaveBeenCalled();

    await openTab(/Modules/);
    await vi.waitFor(() => expect(api.fetchCurriculumComponents).toHaveBeenCalledTimes(1));
    await openTab(/Overview/);
    await vi.waitFor(() => expect(readiness()).toBe(fromSummary.readiness));
    expect(screen.getByText(/\d+ components$/).textContent).toBe(fromSummary.hero);
    expect(screen.getByText(/weeks? (has|have) no content/).textContent).toBe(fromSummary.empty);
  });

  it('loads holiday choices only for the editor and offers retry instead of opening an incomplete form', async () => {
    const api = await import('@/lib/curriculumApi');
    vi.clearAllMocks();
    vi.mocked(api.fetchCurriculumHolidays).mockRejectedValueOnce(new Error('Holiday choices unavailable'));
    await renderWorkspace();
    await openTab(/Cohorts/);
    expect(api.fetchCurriculumHolidays).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: /^Add cohort$/i }));
    await screen.findByText('Holiday choices unavailable');
    expect(screen.queryByRole('button', { name: /^Create cohort$/i })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await vi.waitFor(() => expect(api.fetchCurriculumHolidays).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(screen.queryByText('Loading editor options')).not.toBeInTheDocument());
    expect(api.fetchCurriculumComponents).toHaveBeenCalledTimes(1);
  });

  it('loads the workspace module projection and retains canonical links and edit metadata', async () => {
    const api = await import('@/lib/curriculumApi');
    const { moduleFormTarget } = await import('@/pages/curriculum/shared/entities/moduleForm');
    const projectedModule = {
      ...modules[0], sourceType: 'delivery', notes: 'Saved description', color: '#123456',
      weeklySchedule: [{ day: 'Monday', startTime: '09:00', endTime: '10:00' }],
      sessionHolidays: ['H-1'], deliveryWeeks: 2, coverImage: 'https://example.invalid/cover.png',
      weekStructureOutline: true,
      weekStructure: [{ id: 'W-1', weekNumber: 1, title: 'Orientation', componentsOmitted: true }],
    } as unknown as CurriculumModule;
    vi.mocked(api.fetchCurriculumProgrammeDetailModules).mockResolvedValueOnce({
      schema: 'test', flat: { modules: [projectedModule], sessions: [] },
    });
    await renderWorkspace();
    expect(api.fetchCurriculumProgrammeDetailModules).toHaveBeenCalledWith(
      'PROG-DATA', expect.anything(), expect.objectContaining({ visibility: 'all', view: 'workspace' }),
    );
    await openTab(/Modules/);
    expect(await screen.findByRole('link', { name: /^Data Foundations/ })).toHaveAttribute(
      'href', '/curriculum/module-builder?module=MOD-1&moduleTitle=Data+Foundations&programme=PROG-DATA&programmeName=Data+Analyst',
    );
    expect(moduleFormTarget(projectedModule)).toMatchObject({
      id: 'MOD-1', notes: 'Saved description', color: '#123456',
      weeklySchedule: projectedModule.weeklySchedule, sessionHolidays: ['H-1'],
      deliveryWeeks: 2, coverImage: 'https://example.invalid/cover.png',
    });
  });

  it('opens cohort and module assignment with the correct independent scope', async () => {
    const { fetchLearnerAssignments } = await import('@/api/curriculumLearnerAssignments');
    await renderWorkspace();
    await openTab(/Cohorts/);
    await userEvent.click(screen.getByRole('button', { name: 'Assign learners' }));
    await screen.findByText(/Learners you add join this cohort and receive all 1 modules in it\./);
    expect(fetchLearnerAssignments).toHaveBeenCalledWith(
      { scope: 'cohort', id: 'COHORT-1', name: 'Sept 2026' }, expect.any(AbortSignal),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await openTab(/Modules/);
    await userEvent.click(screen.getAllByRole('button', { name: 'Assign learners' })[0]);
    await screen.findByText(/Learners you add receive this module only/);
    expect(fetchLearnerAssignments).toHaveBeenCalledWith(
      { scope: 'module', id: 'MOD-1', name: 'Data Foundations' }, expect.any(AbortSignal),
    );
  });

  it('opens with the programme in a header, not straight into a records table', async () => {
    await renderWorkspace();

    // The other three Curriculum workspaces all open with this: breadcrumb,
    // title, and the counts that say what state the record is in. This page had
    // none of it and began at its tab strip.
    expect(screen.getByRole('link', { name: 'Programmes' })).toHaveAttribute('href', '/curriculum/programmes');
    expect(screen.getByRole('heading', { name: 'Data Analyst' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Edit programme/ })).toBeInTheDocument();
    expect(screen.getByText('Delivery setup')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Manage Cohorts & Groups/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Open Module Builder/ })).toBeInTheDocument();
  });

  it('shows the programme hierarchy as explicit, ordered navigation', async () => {
    await renderWorkspace();
    const strip = tabStrip();

    expect(strip.getByRole('button', { name: /Overview/ })).toBeInTheDocument();
    const cohortsTab = strip.getByRole('button', { name: /Cohorts/ });
    const groupsTab = strip.getByRole('button', { name: /Groups/ });
    const modulesTab = strip.getByRole('button', { name: /Modules/ });
    const sessionsTab = strip.getByRole('button', { name: /Sessions/ });
    expect(cohortsTab.compareDocumentPosition(groupsTab) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(groupsTab.compareDocumentPosition(modulesTab) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(modulesTab.compareDocumentPosition(sessionsTab) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(strip.getByRole('button', { name: /KSB Coverage/ })).toBeInTheDocument();
    expect(strip.getByRole('button', { name: /Achievement KSBs/ })).toBeInTheDocument();
    expect(strip.getByRole('button', { name: /Quality/ })).toBeInTheDocument();
    // Reviews ID sits beside Quality: Programme Review Templates, not the old
    // removed "Review" tab that used to redraw cohorts/groups/modules/weeks.
    expect(strip.getByRole('button', { name: /Reviews ID/ })).toBeInTheDocument();

    // Weeks and components still belong to an individual module workspace.
    expect(strip.queryByRole('button', { name: /^Weeks/ })).not.toBeInTheDocument();
  });

  it('opens the Reviews ID tab to an explanatory empty state when no reviews exist', async () => {
    await renderWorkspace();
    await openTab(/Reviews ID/);

    expect(await screen.findByText('No reviews have been configured yet')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Add New Review/ }).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /Clone Review From Another Programme/ })).toBeInTheDocument();
  });

  it('puts Modules after the delivery hierarchy and reports completed design without a second way into KSB Coverage', async () => {
    await renderWorkspace();
    await openTab(/Modules/);

    expect(screen.queryByText('Programme design')).not.toBeInTheDocument();
    expect(tabStrip().getByRole('button', { name: /Open Module Builder/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Add cohort$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Add module$/ })).not.toBeInTheDocument();
    expect(await screen.findByText('Design foundation ready')).toBeInTheDocument();
    // The banner reports the state and stops there: KSB Coverage is a tab in the
    // strip above, so a second button into it was a duplicate door.
    expect(screen.queryByRole('button', { name: /Continue to KSB Coverage/ })).not.toBeInTheDocument();

    await openTab(/KSB Coverage/);
    expect(await screen.findByText('KSB coverage heatmap')).toBeInTheDocument();
  });

  it('sends the reader to the page that owns each record type rather than being a second catalogue', async () => {
    await renderWorkspace();

    expect(screen.getByRole('link', { name: /cohort/ })).toHaveAttribute('href', '/curriculum/cohorts?programme=PROG-DATA');
    expect(screen.getByRole('link', { name: /group/ })).toHaveAttribute('href', '/curriculum/groups?programme=PROG-DATA');
    expect(screen.getByRole('link', { name: /module/ })).toHaveAttribute('href', '/curriculum/module-builder?programme=PROG-DATA&programmeName=Data+Analyst');
  });

  it('reports a module whose cohort is not a cohort record instead of inventing one', async () => {
    await renderWorkspace();

    // One cohort record, so one cohort — the orphan module does not add a second.
    expect(screen.getByRole('link', { name: /Cohorts page/ })).toHaveAccessibleName(/^1 cohort/);
    expect(screen.getByText(/not attached to a live cohort/)).toBeInTheDocument();
    expect(screen.getByText(/Ghost Cohort/)).toBeInTheDocument();
  });

  it('shows a cohort with its groups, and never a tutor on a group', async () => {
    await renderWorkspace();
    await openTab(/Cohorts/);

    expect(screen.queryByText('Delivery setup')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^Sept 2026/ })).toHaveAttribute('href', '/curriculum/cohorts/COHORT-1');

    await openTab(/Groups/);
    expect(screen.getByPlaceholderText('Search groups, coaches, days or mode...')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Cohort' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Coaching' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Group A/ })).toHaveAttribute('href', '/curriculum/groups/GROUP-1?groupName=Group+A');
    expect(screen.getByRole('button', { name: 'Add module' })).toBeInTheDocument();
    // The coach belongs to the group and is assignable in place.
    expect(screen.getByText('Coach One')).toBeInTheDocument();
    // The tutor does not, even though the group payload carries one.
    expect(screen.queryByText('Tutor One')).not.toBeInTheDocument();
  });

  it('does not count a same-named module that is assigned to another group', async () => {
    const api = await import('@/lib/curriculumApi');
    const otherGroup = {
      ...groups[0],
      id: 'GROUP-2',
      name: 'Group B',
      learners: 0,
      modules: ['Data Foundations'],
    } as CurriculumGroup;
    const otherModule = {
      ...modules[0],
      id: 'MOD-OTHER-GROUP',
      moduleCatalogueId: 'MOD-OTHER-GROUP',
      sourceId: 'MOD-OTHER-GROUP',
      groupId: 'GROUP-2',
      group: 'Group B',
    } as CurriculumModule;
    mockProgrammeDetailOnce(api, {
      schema: 'test',
      programme,
      cohorts: [],
      flat: {
        cohorts,
        groups: [...groups, otherGroup],
        groupIds: ['GROUP-1', 'GROUP-2'],
        modules: [...modules, otherModule],
        sessions: [],
        components: [],
      },
    });

    await renderWorkspace();
    await openTab(/Groups/);

    const groupRow = screen.getByRole('link', { name: /Group A/ }).parentElement;
    expect(groupRow).not.toBeNull();
    expect(groupRow?.children[3]).toHaveTextContent('1');
  });

  it('reports zero OTJH when sessions exist but no components have been authored', async () => {
    const api = await import('@/lib/curriculumApi');
    const scheduledSession = {
      id: 'SESSION-1',
      trainingPlanId: 'PLAN-1',
      programmeId: 'PROG-DATA',
      cohortId: 'COHORT-1',
      groupId: 'GROUP-1',
      moduleCatalogueId: 'MOD-1',
      title: 'Generated live session',
      type: 'Live Session',
      date: '2026-09-07',
      day: 'Monday',
      startTime: '09:00',
      endTime: '11:00',
      tutor: 'Tutor One',
      group: 'Group A',
      cohort: 'Sept 2026',
      programme: 'Data Analyst',
      venue: 'Online',
      module: 'Data Foundations',
      week: 1,
      status: 'scheduled',
      ksbCodes: [],
    } as CurriculumSession;
    mockProgrammeDetailOnce(api, {
      schema: 'test',
      programme,
      cohorts: [],
      flat: {
        cohorts,
        groups,
        groupIds: ['GROUP-1'],
        modules,
        sessions: [scheduledSession],
        components: [],
      },
    });
    // The page reads components from their own endpoint, not from the detail
    // payload, so "no components have been authored" has to be said to it or
    // the assertion is only ever winning a race with that read. The Overview
    // reads the summary; the full list is not requested on this tab at all.
    vi.mocked(api.fetchCurriculumComponentSummary).mockResolvedValueOnce([]);

    await renderWorkspace();

    const otjhCard = screen.getByText('OTJH').parentElement;
    expect(otjhCard).not.toBeNull();
    expect(otjhCard).toHaveTextContent('0h');
  });

  it('uses the same component Expected OTJH total as Module Builder in the Modules tab', async () => {
    const api = await import('@/lib/curriculumApi');
    const authoredComponents = [
      { ...components[0], id: 'COMP-A', type: 'Reading Material', expectedOtjh: 0.33 },
      { ...components[0], id: 'COMP-B', type: 'Quiz', title: 'Knowledge check', expectedOtjh: 0.33 },
      { ...components[0], id: 'COMP-C', type: 'PowerPoint', title: 'Slides', expectedOtjh: 0.33 },
      { ...components[0], id: 'COMP-OLD', moduleCatalogueId: '', moduleId: '', title: 'Old same-title row', expectedOtjh: 200 },
    ] as unknown as CurriculumComponent[];
    mockProgrammeDetailOnce(api, {
      schema: 'test',
      programme,
      cohorts: [],
      flat: {
        cohorts,
        groups,
        groupIds: ['GROUP-1'],
        modules: [modules[0]],
        sessions: [],
        components: authoredComponents,
      },
    });
    vi.mocked(api.fetchCurriculumComponents).mockResolvedValueOnce(authoredComponents);

    await renderWorkspace();
    await openTab(/Modules/);

    const moduleRow = screen.getByRole('link', { name: /^Data Foundations/ }).parentElement;
    expect(moduleRow).not.toBeNull();
    expect(moduleRow).toHaveTextContent('1h');
  });

  it('keeps empty table structure visible and disables filters until records exist', async () => {
    const api = await import('@/lib/curriculumApi');
    mockProgrammeDetailOnce(api, {
      schema: 'test',
      programme,
      cohorts: [],
      flat: { cohorts: [], groups: [], groupIds: [], modules: [], sessions: [], components: [] },
    });

    await renderWorkspace();
    await openTab(/Cohorts/);

    expect(screen.getAllByRole('button', { name: /^Add cohort$/ })).toHaveLength(1);
    expect(screen.getByPlaceholderText('Search cohorts, dates, status...')).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Record status' })).toBeDisabled();

    await openTab(/Groups/);
    expect(screen.getByText('Coach')).toBeInTheDocument();
    expect(screen.getByText('Add a cohort before creating groups')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Search groups, coaches, days or mode...')).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Cohort' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Coaching' })).toBeDisabled();

    await openTab(/Modules/);
    expect(screen.getByText('Module')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Search modules, cohort, group, tutor, KSB...')).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Cohort' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Group' })).toBeDisabled();
  });

  it('lists modules as rows that open the module, not as cards that redraw it', async () => {
    await renderWorkspace();
    await openTab(/Modules/);

    // The row opens the Module Builder: authoring the weeks, components and
    // material is what a reader comes to a module for from here.
    expect(screen.getByRole('link', { name: /^Data Foundations/ })).toHaveAttribute(
      'href',
      '/curriculum/module-builder?module=MOD-1&moduleTitle=Data+Foundations&programme=PROG-DATA&programmeName=Data+Analyst',
    );
    // Row actions say what they do rather than leaving the reader to decode a
    // glyph, and there is one per module. The module's read-only home stays one
    // named action away.
    expect(screen.getAllByRole('button', { name: 'Workspace' })).toHaveLength(2);
    // A module's Teams series, week timeline and KSB weights are its own page's
    // job. Repeating them here is what made this tab a second module workspace.
    expect(screen.queryByText(/Fetch attendance & recordings/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Week breakdown/)).not.toBeInTheDocument();
    expect(screen.queryByText('Getting started')).not.toBeInTheDocument();
  });

  it('rolls every module up into one programme Sessions view', async () => {
    await renderWorkspace();
    await openTab(/Sessions/);

    expect(screen.getByText('Intro live session')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Getting started/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Join' })).toHaveAttribute('href', 'https://teams.example/meet/1');
  });

  it('builds weeks and sessions from a week outline and components read without their long text', async () => {
    const api = await import('@/lib/curriculumApi');
    // What the server sends for omitWeekComponents / omitContent: weeks with no
    // `components` key, and a component whose transcript was left out.
    const outlineModule = {
      ...modules[0],
      weekStructureOutline: true,
      weekStructure: [{ id: 'WEEK-1', weekNumber: 1, title: 'Kick-off week', componentsOmitted: true }],
    } as unknown as CurriculumModule;
    const trimmedComponents = [
      { ...components[0], weekId: 'WEEK-1', settingsOmitted: ['transcript'] },
    ] as unknown as CurriculumComponent[];
    vi.mocked(api.fetchCurriculumProgrammeDetailShell).mockClear();
    vi.mocked(api.fetchCurriculumProgrammeDetailModules).mockClear();
    vi.mocked(api.fetchCurriculumComponents).mockClear();
    mockProgrammeDetailOnce(api, {
      schema: 'test',
      programme,
      cohorts: [],
      flat: { cohorts, groups, groupIds: ['GROUP-1'], modules: [outlineModule], sessions: [] },
    });
    vi.mocked(api.fetchCurriculumComponents).mockResolvedValueOnce(trimmedComponents);

    await renderWorkspace();
    expect(api.fetchCurriculumProgrammeDetailShell).toHaveBeenCalledWith('PROG-DATA', expect.anything(), expect.objectContaining({ visibility: 'all' }));
    expect(api.fetchCurriculumProgrammeDetailModules).toHaveBeenCalledWith('PROG-DATA', expect.anything(), expect.objectContaining({ visibility: 'all' }));
    // Requested when the Sessions tab opens; the Overview reads the summary.
    await openTab(/Sessions/);
    await vi.waitFor(() => expect(api.fetchCurriculumComponents).toHaveBeenCalledWith(
      expect.anything(), expect.objectContaining({ moduleCatalogueIds: ['MOD-1'], omitContent: true }),
    ));

    // The week title comes from the outline; the session, its schedule and its
    // Teams link from the trimmed component -- none of which was left out.
    expect(await screen.findByRole('button', { name: /Kick-off week/ })).toBeInTheDocument();
    expect(screen.getByText('Intro live session')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Join' })).toHaveAttribute('href', 'https://teams.example/meet/1');
  });

  it('draws the programme, cohorts and groups before its modules arrive', async () => {
    const api = await import('@/lib/curriculumApi');
    let deliverModules: (value: Awaited<ReturnType<typeof api.fetchCurriculumProgrammeDetailModules>>) => void = () => undefined;
    vi.mocked(api.fetchCurriculumProgrammeDetailModules).mockReturnValueOnce(new Promise(resolve => { deliverModules = resolve; }));

    await renderWorkspace();

    // The shell alone draws the page; the module counts wait, and say so.
    expect(tabStrip().getByRole('button', { name: /Cohorts/ })).toHaveTextContent('1');
    expect(screen.getByRole('status', { name: 'Loading modules count' })).toBeInTheDocument();
    await openTab(/Modules/);
    expect(screen.getByText("Loading this programme's modules...")).toBeInTheDocument();

    deliverModules({ schema: 'test', flat: { modules, sessions: [] } });
    expect(await screen.findByRole('link', { name: /^Data Foundations/ })).toBeInTheDocument();
    expect(screen.queryByRole('status', { name: 'Loading modules count' })).not.toBeInTheDocument();
  });
});
