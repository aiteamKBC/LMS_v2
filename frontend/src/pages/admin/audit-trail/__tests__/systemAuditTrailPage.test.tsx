import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { CurriculumActivityPeople } from '@/lib/curriculumApi';

/**
 * The system-wide door onto the Audit Trail.
 *
 * What is guarded here is the difference between the two doors, because that
 * difference is the whole reason there is one implementation rather than two.
 * A scoped page that quietly asked for every workspace would show Safeguarding
 * inside Curriculum Studio's chrome; a system-wide page that quietly asked for
 * one would look complete while hiding most of the LMS. Both failures look like
 * a working page.
 *
 * The other thing guarded here is the coverage notice. The reading half covers
 * every workspace and the Changes half does not yet, and an empty Changes feed
 * must not be readable as "nobody changed anything anywhere".
 *
 * The page opens on Changes, so every People assertion below goes through
 * `openPeople()` first. That is the tab order, not ceremony: a test that found
 * the people list without asking for it would mean the page had stopped
 * opening where it is meant to.
 */

vi.mock('@/components/feature/WorkspaceShell', () => ({
  WorkspaceShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

const fetchActivityPeople = vi.fn();
const fetchCurriculumAuditTrail = vi.fn();
const fetchCurriculumOverview = vi.fn();
vi.mock('@/lib/curriculumApi', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@/lib/curriculumApi');
  return {
    ...actual,
    fetchActivityPeople: (...args: unknown[]) => fetchActivityPeople(...args),
    fetchCurriculumAuditTrail: (...args: unknown[]) => fetchCurriculumAuditTrail(...args),
    fetchCurriculumOverview: (...args: unknown[]) => fetchCurriculumOverview(...args),
  };
});

import SystemAuditTrailPage from '../page';
import CurriculumAuditTrailPage from '@/pages/curriculum/audit-trail/page';

function people(overrides: Partial<CurriculumActivityPeople> = {}): CurriculumActivityPeople {
  return {
    generatedAt: '2026-09-20T10:00:00',
    windowDays: 30,
    since: '2026-08-21T10:00:00',
    workspace: '',
    workspaces: [
      { value: 'curriculum', label: 'Curriculum Studio' },
      { value: 'coach', label: 'Coach' },
      { value: 'safeguarding', label: 'Safeguarding' },
    ],
    workspaceRecorded: true,
    changeWorkspaces: ['curriculum'],
    visitsRecorded: true,
    changesRecorded: true,
    signInsRecorded: true,
    truncated: false,
    shown: 1,
    limit: 50,
    page: 1,
    pageSize: 50,
    pages: 1,
    total: 1,
    roles: ['coach'],
    rolesIncludeBlank: false,
    totals: { people: 1, visits: 3, pageViews: 20, readActions: 4, changes: 2, signIns: 1 },
    people: [{
      email: 'sam@kentbusinesscollege.com',
      name: 'Sam Hunt',
      role: 'coach',
      firstSeen: '2026-09-19T09:00:00',
      lastSeen: '2026-09-20T09:30:00',
      visits: 3,
      pageViews: 20,
      readActions: 4,
      pagesOpened: 7,
      changes: 2,
      signIns: 1,
      lastPageKey: 'caseload',
      lastPageLabel: 'Caseload',
      lastWorkspace: 'coach',
      workspaces: [
        { workspace: 'coach', label: 'Coach', hits: 18, lastAt: '2026-09-20T09:30:00' },
        { workspace: 'safeguarding', label: 'Safeguarding', hits: 6, lastAt: '2026-09-19T14:00:00' },
      ],
    }],
    ...overrides,
  };
}

/** What the Changes half is handed, shaped as the server answers it. */
function trail(overrides: Record<string, unknown> = {}) {
  return {
    generatedAt: '2026-09-20T10:00:00',
    windowDays: 30,
    since: '2026-08-21T10:00:00',
    limit: 200,
    total: 0,
    truncated: false,
    actionCounts: {},
    entityCounts: {},
    unreadable: [],
    authorRecorded: true,
    source: 'revisions',
    structuredMetadata: true,
    sources: [],
    actorTypes: [],
    actors: [],
    events: [],
    // Named on the trail response, as both readings do. The page opens on
    // Changes, so this is where its workspace filter and coverage notice come
    // from -- People may never have been asked for.
    workspaces: [
      { value: 'curriculum', label: 'Curriculum Studio' },
      { value: 'coach', label: 'Coach' },
      { value: 'safeguarding', label: 'Safeguarding' },
    ],
    changeWorkspaces: ['curriculum'],
    ...overrides,
  };
}

function renderSystemPage() {
  return render(<MemoryRouter><SystemAuditTrailPage /></MemoryRouter>);
}

/** The page opens on Changes; People is the second tab. */
async function openPeople() {
  await userEvent.click(await screen.findByRole('button', { name: /^People/ }));
  return screen.findByText('Sam Hunt');
}

describe('system-wide Audit Trail', () => {
  beforeEach(() => {
    fetchActivityPeople.mockReset();
    fetchActivityPeople.mockResolvedValue(people());
    fetchCurriculumAuditTrail.mockReset();
    fetchCurriculumAuditTrail.mockResolvedValue(trail());
    fetchCurriculumOverview.mockReset();
    fetchCurriculumOverview.mockResolvedValue({ modules: [] });
  });

  // The tab the page lands on. Changes is the question this screen is named
  // for, and People is a click away; opening on People put the feed behind a
  // tab nobody pressed.
  it('opens on Changes, with People behind it', async () => {
    renderSystemPage();
    const tabs = await screen.findAllByRole('button', { name: /^(Changes|People)/ });
    expect(tabs.map(tab => tab.textContent?.replace(/\d+$/, '').trim())).toEqual(['Changes', 'People']);
    expect(tabs[0]).toHaveAttribute('aria-pressed', 'true');
    expect(tabs[1]).toHaveAttribute('aria-pressed', 'false');
    // The feed is read on arrival; the people list is not read until asked for.
    expect(fetchCurriculumAuditTrail).toHaveBeenCalled();
    expect(fetchActivityPeople).not.toHaveBeenCalled();
  });

  it('asks for every workspace, not one', async () => {
    renderSystemPage();
    await openPeople();
    // '' is "all workspaces". A scope that leaked a workspace in here would
    // make a system-wide page silently show one corner of the LMS.
    expect(fetchActivityPeople).toHaveBeenCalledWith(expect.objectContaining({ workspace: '' }));
  });

  it('shows which workspaces each person was actually in', async () => {
    renderSystemPage();
    await openPeople();
    expect(await screen.findByText(/Coach, Safeguarding/)).toBeInTheDocument();
  });

  it('offers the workspace filter, built from what the server recognises', async () => {
    renderSystemPage();
    await openPeople();
    await userEvent.click(screen.getByRole('combobox', { name: /workspace/i }));
    const options = screen.getAllByRole('option').map(option => option.textContent);
    expect(options).toEqual(expect.arrayContaining(['Curriculum Studio', 'Coach', 'Safeguarding']));
  });

  // Saved history is kept, page activity is not: the Changes feed may look
  // back 30 or 60 days system-wide, while People keeps its seven.
  it('opens the Changes feed on 7 days and offers 30 and 60 system-wide', async () => {
    renderSystemPage();
    await screen.findByRole('button', { name: /^Changes/ });
    expect(fetchCurriculumAuditTrail).toHaveBeenLastCalledWith(expect.objectContaining({ days: 7 }));

    await userEvent.click(screen.getByRole('combobox', { name: /period/i }));
    const options = screen.getAllByRole('option').map(option => option.textContent);
    expect(options).toEqual(expect.arrayContaining(['Last 7 days', 'Last 30 days', 'Last 60 days']));

    await userEvent.click(screen.getByRole('option', { name: 'Last 60 days' }));
    expect(fetchCurriculumAuditTrail).toHaveBeenLastCalledWith(expect.objectContaining({ days: 60 }));
  });

  it('keeps the People period to the seven days page activity is kept for', async () => {
    renderSystemPage();
    await screen.findByRole('button', { name: /^Changes/ });
    await userEvent.click(screen.getByRole('combobox', { name: /period/i }));
    await userEvent.click(screen.getByRole('option', { name: 'Last 30 days' }));

    await openPeople();
    expect(fetchActivityPeople).toHaveBeenLastCalledWith(expect.objectContaining({ days: 7 }));
    await userEvent.click(screen.getByRole('combobox', { name: /period/i }));
    const options = screen.getAllByRole('option').map(option => option.textContent);
    expect(options).not.toContain('Last 30 days');
    expect(options).not.toContain('Last 60 days');
  });

  it('refetches scoped to the workspace that was picked', async () => {
    renderSystemPage();
    await openPeople();
    await userEvent.click(screen.getByRole('combobox', { name: /workspace/i }));
    await userEvent.click(screen.getByRole('option', { name: 'Safeguarding' }));
    expect(fetchActivityPeople).toHaveBeenLastCalledWith(
      expect.objectContaining({ workspace: 'safeguarding' }),
    );
  });

  it('says which workspaces the Changes feed cannot speak for', async () => {
    renderSystemPage();

    // The honest gap: visits are recorded everywhere, saves are not yet.
    // Read on the tab the page opens on, without People having been asked for.
    expect(await screen.findByText(/covers Curriculum Studio only/i)).toBeInTheDocument();
    expect(screen.getByText(/Coach, Safeguarding/)).toBeInTheDocument();
  });

  // The timestamp reading is what a database without the revision log falls
  // back to. It reads every workspace with usable timestamps now, so the notice
  // names what it actually covers -- and still names what it does not.
  it('names the workspaces the timestamp reading covers, and the ones it cannot', async () => {
    fetchCurriculumAuditTrail.mockResolvedValue(trail({
      source: 'timestamps',
      authorRecorded: false,
      changeWorkspaces: ['curriculum', 'coach'],
      revisionWorkspaces: [],
      derivedWorkspaces: ['curriculum', 'coach'],
      uncoveredWorkspaces: ['safeguarding'],
    }));
    renderSystemPage();

    expect(await screen.findByText(/covers Curriculum Studio, Coach only/i)).toBeInTheDocument();
    expect(screen.getByText(/Saves made in Safeguarding are not in it/)).toBeInTheDocument();
    expect(screen.getByText(/none of their records keeps a\s+timestamp/)).toBeInTheDocument();
  });

  // The server's own list of what is uncovered wins over working it out here:
  // a workspace can be missing from both lists only if the page guessed.
  it('reads the uncovered workspaces from the server rather than inferring them', async () => {
    fetchCurriculumAuditTrail.mockResolvedValue(trail({
      changeWorkspaces: ['curriculum'],
      revisionWorkspaces: ['curriculum'],
      derivedWorkspaces: [],
      uncoveredWorkspaces: ['coach'],
    }));
    renderSystemPage();

    expect(await screen.findByText(/Saves made in Coach are not in it/)).toBeInTheDocument();
    expect(screen.queryByText(/Saves made in Coach, Safeguarding/)).not.toBeInTheDocument();
  });

  it('says nothing about coverage once every workspace is covered by either reading', async () => {
    fetchCurriculumAuditTrail.mockResolvedValue(trail({
      source: 'timestamps',
      authorRecorded: false,
      changeWorkspaces: ['curriculum', 'coach', 'safeguarding'],
      derivedWorkspaces: ['curriculum', 'coach', 'safeguarding'],
      uncoveredWorkspaces: [],
    }));
    renderSystemPage();
    await screen.findByRole('button', { name: /^Changes/ });

    expect(screen.queryByText(/This feed covers/i)).not.toBeInTheDocument();
  });

  /**
   * Three pages of people, answered the way the server answers: echoing back
   * the page it was asked for. A mock that always claimed page one would send
   * the page control back to one on every click — and would be testing the
   * mock rather than the page.
   */
  function threePages(overrides: Partial<CurriculumActivityPeople> = {}) {
    fetchActivityPeople.mockImplementation((options: { page?: number } = {}) =>
      Promise.resolve(people({
        total: 141,
        pages: 3,
        page: options.page ?? 1,
        roles: ['admin', 'coach'],
        ...overrides,
      })));
  }

  // The list is one page of a longer answer. Everything that narrows it has to
  // be asked of the server for that reason: a filter applied to the rows on
  // screen would search fifty people and report the result as all 141.
  it('asks the server for the page that was clicked', async () => {
    threePages();
    renderSystemPage();
    await openPeople();

    await userEvent.click(screen.getByRole('button', { name: 'Page 2' }));

    expect(fetchActivityPeople).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }));
  });

  it('asks the server for the role, rather than filtering the page', async () => {
    threePages();
    renderSystemPage();
    await openPeople();

    await userEvent.click(screen.getByRole('combobox', { name: /role/i }));
    await userEvent.click(screen.getByRole('option', { name: 'Admin' }));

    expect(fetchActivityPeople).toHaveBeenLastCalledWith(expect.objectContaining({ role: 'admin' }));
  });

  // A new question is a new list, and page three of the old one is not part of
  // it -- landing there would show nothing and read as "nobody matched".
  it('returns to the first page when the filters change', async () => {
    threePages();
    renderSystemPage();
    await openPeople();
    await userEvent.click(screen.getByRole('button', { name: 'Page 3' }));
    expect(fetchActivityPeople).toHaveBeenLastCalledWith(expect.objectContaining({ page: 3 }));

    await userEvent.click(screen.getByRole('combobox', { name: /role/i }));
    await userEvent.click(screen.getByRole('option', { name: 'Admin' }));

    expect(fetchActivityPeople).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1 }));
  });

  // Page controls over a single page are furniture that says the list is
  // paginated and then refuses to paginate.
  it('shows no page controls when everybody fits on one page', async () => {
    renderSystemPage();
    await openPeople();

    expect(screen.queryByRole('button', { name: 'Page 1' })).not.toBeInTheDocument();
  });

  it('drops the coverage notice once every workspace is covered', async () => {
    fetchCurriculumAuditTrail.mockResolvedValue(trail({
      changeWorkspaces: ['curriculum', 'coach', 'safeguarding'],
    }));
    renderSystemPage();
    await screen.findByRole('button', { name: /^Changes/ });

    expect(screen.queryByText(/covers Curriculum Studio only/i)).not.toBeInTheDocument();
  });
});

describe("Curriculum Studio's scoped door", () => {
  beforeEach(() => {
    fetchActivityPeople.mockReset();
    fetchActivityPeople.mockResolvedValue(people({ workspace: 'curriculum' }));
    fetchCurriculumAuditTrail.mockReset();
    fetchCurriculumAuditTrail.mockResolvedValue(trail());
    fetchCurriculumOverview.mockReset();
    fetchCurriculumOverview.mockResolvedValue({ modules: [] });
  });

  it('asks only for curriculum', async () => {
    render(<MemoryRouter><CurriculumAuditTrailPage /></MemoryRouter>);
    // Both halves, because both of them read through this door.
    expect(fetchCurriculumAuditTrail).toHaveBeenCalledWith(
      expect.objectContaining({ workspace: 'curriculum' }),
    );
    await openPeople();
    expect(fetchActivityPeople).toHaveBeenCalledWith(
      expect.objectContaining({ workspace: 'curriculum' }),
    );
  });

  it('offers no workspace filter, because its scope is not the reader’s to change', async () => {
    render(<MemoryRouter><CurriculumAuditTrailPage /></MemoryRouter>);
    // Neither on the tab it opens on nor on the one behind it.
    await screen.findByRole('button', { name: /^Changes/ });
    expect(screen.queryByRole('combobox', { name: /workspace/i })).not.toBeInTheDocument();
    await openPeople();
    expect(screen.queryByRole('combobox', { name: /workspace/i })).not.toBeInTheDocument();
  });
});
