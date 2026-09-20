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
    limit: 200,
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

function renderSystemPage() {
  return render(<MemoryRouter><SystemAuditTrailPage /></MemoryRouter>);
}

describe('system-wide Audit Trail', () => {
  beforeEach(() => {
    fetchActivityPeople.mockReset();
    fetchActivityPeople.mockResolvedValue(people());
    fetchCurriculumAuditTrail.mockReset();
    fetchCurriculumAuditTrail.mockResolvedValue({
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
    });
    fetchCurriculumOverview.mockReset();
    fetchCurriculumOverview.mockResolvedValue({ modules: [] });
  });

  it('asks for every workspace, not one', async () => {
    renderSystemPage();
    await screen.findByText('Sam Hunt');
    // '' is "all workspaces". A scope that leaked a workspace in here would
    // make a system-wide page silently show one corner of the LMS.
    expect(fetchActivityPeople).toHaveBeenCalledWith(expect.objectContaining({ workspace: '' }));
  });

  it('shows which workspaces each person was actually in', async () => {
    renderSystemPage();
    expect(await screen.findByText(/Coach, Safeguarding/)).toBeInTheDocument();
  });

  it('offers the workspace filter, built from what the server recognises', async () => {
    renderSystemPage();
    await screen.findByText('Sam Hunt');
    await userEvent.click(screen.getByRole('combobox', { name: /workspace/i }));
    const options = screen.getAllByRole('option').map(option => option.textContent);
    expect(options).toEqual(expect.arrayContaining(['Curriculum Studio', 'Coach', 'Safeguarding']));
  });

  it('refetches scoped to the workspace that was picked', async () => {
    renderSystemPage();
    await screen.findByText('Sam Hunt');
    await userEvent.click(screen.getByRole('combobox', { name: /workspace/i }));
    await userEvent.click(screen.getByRole('option', { name: 'Safeguarding' }));
    expect(fetchActivityPeople).toHaveBeenLastCalledWith(
      expect.objectContaining({ workspace: 'safeguarding' }),
    );
  });

  it('says which workspaces the Changes feed cannot speak for', async () => {
    renderSystemPage();
    await screen.findByText('Sam Hunt');
    await userEvent.click(screen.getByRole('button', { name: /Changes/ }));

    // The honest gap: visits are recorded everywhere, saves are not yet.
    expect(await screen.findByText(/covers Curriculum Studio only/i)).toBeInTheDocument();
    expect(screen.getByText(/Coach, Safeguarding/)).toBeInTheDocument();
  });

  it('drops the coverage notice once every workspace is covered', async () => {
    fetchActivityPeople.mockResolvedValue(people({
      changeWorkspaces: ['curriculum', 'coach', 'safeguarding'],
    }));
    renderSystemPage();
    await screen.findByText('Sam Hunt');
    await userEvent.click(screen.getByRole('button', { name: /Changes/ }));

    expect(screen.queryByText(/covers Curriculum Studio only/i)).not.toBeInTheDocument();
  });
});

describe("Curriculum Studio's scoped door", () => {
  beforeEach(() => {
    fetchActivityPeople.mockReset();
    fetchActivityPeople.mockResolvedValue(people({ workspace: 'curriculum' }));
    fetchCurriculumOverview.mockReset();
    fetchCurriculumOverview.mockResolvedValue({ modules: [] });
  });

  it('asks only for curriculum', async () => {
    render(<MemoryRouter><CurriculumAuditTrailPage /></MemoryRouter>);
    await screen.findByText('Sam Hunt');
    expect(fetchActivityPeople).toHaveBeenCalledWith(
      expect.objectContaining({ workspace: 'curriculum' }),
    );
  });

  it('offers no workspace filter, because its scope is not the reader’s to change', async () => {
    render(<MemoryRouter><CurriculumAuditTrailPage /></MemoryRouter>);
    await screen.findByText('Sam Hunt');
    expect(screen.queryByRole('combobox', { name: /workspace/i })).not.toBeInTheDocument();
  });
});
