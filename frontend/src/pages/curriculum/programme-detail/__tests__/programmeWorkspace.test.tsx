import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type {
  CurriculumCohort,
  CurriculumComponent,
  CurriculumGroup,
  CurriculumModule,
  CurriculumProgramme,
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

vi.mock('@/components/feature/WorkspaceShell', () => ({
  WorkspaceShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/feature/CurriculumSweetAlert', () => ({
  showCurriculumAlert: vi.fn(async () => undefined),
  showCurriculumConfirm: vi.fn(async () => undefined),
}));

vi.mock('@/lib/curriculumApi', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/curriculumApi')>()),
  fetchCurriculumProgrammeDetail: vi.fn(async () => ({
    schema: 'test',
    programme,
    cohorts: [],
    flat: { cohorts, groups, groupIds: ['GROUP-1'], modules, sessions: [], components: [] },
  })),
  fetchCurriculumComponents: vi.fn(async () => components),
  fetchCurriculumProgrammes: vi.fn(async () => [programme]),
  fetchCurriculumCoaches: vi.fn(async () => [{ id: 1, name: 'Coach One' }, { id: 2, name: 'Coach Two' }]),
  fetchCurriculumTutors: vi.fn(async () => [{ id: 3, name: 'Tutor One' }]),
  fetchCurriculumKsbFrameworks: vi.fn(async () => []),
  fetchCurriculumHolidays: vi.fn(async () => []),
  fetchCurriculumKsbSets: vi.fn(async () => []),
  fetchCurriculumStandards: vi.fn(async () => []),
  fetchCurriculumProgrammeKsbCoverage: vi.fn(async () => null),
  fetchCurriculumProgrammeLearnerRoster: vi.fn(async () => ({ assignedLearners: [] })),
  fetchCurriculumProgrammeLearnerKsbImpact: vi.fn(async () => null),
}));

async function renderWorkspace() {
  const { default: ProgrammeDetailPage } = await import('../page');
  const result = render(
    <MemoryRouter initialEntries={['/curriculum/programmes/PROG-DATA']}>
      <Routes>
        <Route path="/curriculum/programmes/:id" element={<ProgrammeDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
  await screen.findByRole('heading', { name: 'Data Analyst' });
  return result;
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

    // Weeks and components still belong to an individual module workspace.
    expect(strip.queryByRole('button', { name: /^Weeks/ })).not.toBeInTheDocument();
    expect(strip.queryByRole('button', { name: /^Review/ })).not.toBeInTheDocument();
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
    vi.mocked(api.fetchCurriculumProgrammeDetail).mockResolvedValueOnce({
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
    expect(groupRow?.children[4]).toHaveTextContent('1');
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
    vi.mocked(api.fetchCurriculumProgrammeDetail).mockResolvedValueOnce({
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
    // payload, so "no components have been authored" has to be said to both or
    // the assertion is only ever winning a race with the second read.
    vi.mocked(api.fetchCurriculumComponents).mockResolvedValueOnce([]);

    await renderWorkspace();

    const otjhCard = screen.getByText('OTJH').closest('.rounded-xl');
    expect(otjhCard).not.toBeNull();
    expect(otjhCard).toHaveTextContent('0h');
  });

  it('keeps empty table structure visible and disables filters until records exist', async () => {
    const api = await import('@/lib/curriculumApi');
    vi.mocked(api.fetchCurriculumProgrammeDetail).mockResolvedValueOnce({
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

    expect(screen.getByRole('link', { name: /^Data Foundations/ })).toHaveAttribute('href', '/curriculum/modules/MOD-1?moduleName=Data+Foundations');
    // Row actions say what they do rather than leaving the reader to decode a
    // glyph, and there is one per module.
    expect(screen.getAllByRole('button', { name: 'Builder' })).toHaveLength(2);
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
    expect(screen.getByText(/Week 1 · Getting started/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Join' })).toHaveAttribute('href', 'https://teams.example/meet/1');
  });
});
