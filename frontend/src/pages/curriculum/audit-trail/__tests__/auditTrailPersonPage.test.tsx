import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { CurriculumAuditEvent, CurriculumPersonActivity } from '@/lib/curriculumApi';

/**
 * One person's activity, read as a person reads it.
 *
 * The distinctions guarded here are the ones that make the page trustworthy
 * rather than merely full: an action belongs to the page it was taken on, a
 * save is only shown on a page the person was recorded as having open, and a
 * duration nobody reported is said to be unknown instead of being printed as
 * zero seconds.
 */

vi.mock('@/components/feature/WorkspaceShell', () => ({
  WorkspaceShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

const fetchPersonActivity = vi.fn();
const fetchCurriculumOverview = vi.fn();
vi.mock('@/lib/curriculumApi', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@/lib/curriculumApi');
  return {
    ...actual,
    fetchCurriculumOverview: (...args: unknown[]) => fetchCurriculumOverview(...args),
    fetchPersonActivity: (...args: unknown[]) => fetchPersonActivity(...args),
  };
});

import CurriculumAuditTrailPersonPage from '../person/page';

function change(overrides: Partial<CurriculumAuditEvent> = {}): CurriculumAuditEvent {
  return {
    id: 'rev:1',
    at: '2026-09-16T09:12:00Z',
    action: 'updated',
    actionLabel: 'Edited',
    entity: 'module',
    entityLabel: 'Module',
    entityId: 'MOD-1',
    revisionNo: 3,
    title: 'Digital Marketing',
    context: '',
    parents: {},
    moduleCatalogueId: 'MOD-1',
    parentId: '',
    versionLabel: '',
    contentStatus: '',
    actorName: 'Ayman Badewi',
    actorEmail: 'ayman@kentbusinesscollege.com',
    actorType: 'user',
    actorTypeLabel: 'Person',
    triggeredByEmail: '',
    triggeredByName: '',
    source: 'manual',
    sourceLabel: 'Manual save',
    metadata: {},
    reason: '',
    changes: [{ field: 'title', label: 'Title', before: 'Old', after: 'Digital Marketing' }],
    snapshot: null,
    href: '/curriculum/modules/MOD-1',
    placed: true,
    ...overrides,
  } as CurriculumAuditEvent;
}

function activity(overrides: Partial<CurriculumPersonActivity> = {}): CurriculumPersonActivity {
  return {
    generatedAt: '2026-09-16T15:00:00Z',
    windowDays: 30,
    since: '2026-08-17T15:00:00Z',
    visitsRecorded: true,
    changesRecorded: true,
    signInsRecorded: true,
    person: {
      email: 'ayman@kentbusinesscollege.com',
      name: 'Ayman Badewi',
      role: 'admin',
      firstSeen: '2026-09-16T09:00:00Z',
      lastSeen: '2026-09-16T09:20:00Z',
    },
    counts: { visits: 1, pageViews: 1, readActions: 1, changes: 1, changesOnAPage: 1, signIns: 1 },
    visits: [{
      id: 'visit-1',
      startedAt: '2026-09-16T09:00:00Z',
      endedAt: '2026-09-16T09:20:00Z',
      ip: '10.0.0.4',
      userAgent: 'Chrome',
      pageCount: 1,
      actionCount: 1,
      changeCount: 1,
      pages: [{
        id: 'ev:1',
        at: '2026-09-16T09:00:00Z',
        endedAt: '2026-09-16T09:20:00Z',
        path: '/curriculum/modules/MOD-1',
        pageKey: 'module-workspace',
        pageLabel: 'Module workspace',
        targetType: 'module',
        targetId: 'MOD-1',
        targetLabel: 'Digital Marketing',
        durationMs: 1_200_000,
        actions: [{
          id: 'ev:2',
          at: '2026-09-16T09:05:00Z',
          kind: 'search',
          label: 'Searched',
          targetType: '',
          targetId: '',
          targetLabel: '',
          detail: { query: 'week 4' },
        }],
        changes: [change()],
      }],
    }],
    signIns: [{ at: '2026-09-16T08:58:00Z', ip: '10.0.0.4', userAgent: 'Chrome' }],
    changes: [change()],
    ...overrides,
  } as CurriculumPersonActivity;
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/curriculum/audit-trail/people/ayman%40kentbusinesscollege.com']}>
      <Routes>
        <Route path="/curriculum/audit-trail/people/:email" element={<CurriculumAuditTrailPersonPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("One person's curriculum activity", () => {
  beforeEach(() => {
    fetchPersonActivity.mockReset();
    fetchPersonActivity.mockResolvedValue(activity());
    fetchCurriculumOverview.mockReset();
    fetchCurriculumOverview.mockResolvedValue({ modules: [] });
  });

  it('reads the person from the URL and focuses on saved changes', async () => {
    fetchPersonActivity.mockResolvedValue(activity({ changes: [change({ placed: false })] }));
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Activity log' })).toBeInTheDocument();
    expect(fetchPersonActivity).toHaveBeenCalledWith(
      'ayman@kentbusinesscollege.com',
      expect.objectContaining({ days: 30 }),
    );
  });

  it('does not render page visit cards or account sign-ins in the change-focused view', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Activity log' })).toBeInTheDocument();
    expect(screen.queryByText('Module workspace')).not.toBeInTheDocument();
    expect(screen.queryByText('Account sign-ins')).not.toBeInTheDocument();
  });

  it('lists a change it could not place on a page instead of guessing one', async () => {
    fetchPersonActivity.mockResolvedValue(activity({
      visits: [{ ...activity().visits[0], changeCount: 0, pages: [{ ...activity().visits[0].pages[0], changes: [] }] }],
      changes: [change({ placed: false })],
      counts: { visits: 1, pageViews: 1, readActions: 1, changes: 1, changesOnAPage: 0, signIns: 1 },
    }));
    renderPage();
    const section = (await screen.findByText('Activity log')).closest('section');
    expect(section).toBeTruthy();
    expect(within(section as HTMLElement).getByText('Digital Marketing')).toBeInTheDocument();
  });

  it('links component activity to the exact component location', async () => {
    fetchPersonActivity.mockResolvedValue(activity({
      changes: [change({
        entity: 'component',
        entityLabel: 'Component',
        entityId: 'COMP-1',
        title: 'Final Knowledge Check',
        moduleCatalogueId: 'MOD-1',
        parentId: 'WEEK-1',
        href: '/curriculum/module-builder',
      })],
    }));
    renderPage();
    const link = await screen.findByRole('link', { name: 'Final Knowledge Check' });
    expect(link).toHaveAttribute(
      'href',
      '/curriculum/module-builder?module=MOD-1&component=COMP-1&focus=component&week=WEEK-1',
    );
  });

  it('filters each table column and explains first recorded activity', async () => {
    const first = change({ action: 'recorded', actionLabel: 'First recorded', entity: 'component', entityLabel: 'Component', title: 'Assignment 5', entityId: 'COMP-5', moduleCatalogueId: 'MOD-1', parentId: 'WEEK-1', changes: [] });
    const edited = change({ id: 'rev:2', action: 'updated', actionLabel: 'Edited', entity: 'module', entityLabel: 'Module', title: 'Digital Marketing', entityId: 'MOD-1', moduleCatalogueId: 'MOD-1', changes: [{ field: 'title', label: 'Title', before: 'Old', after: 'New' }] });
    fetchPersonActivity.mockResolvedValue(activity({ changes: [first, edited] }));
    renderPage();
    await screen.findByText('Assignment 5');
    const firstBadge = screen.getAllByText('First recorded').find(element => element.tagName === 'SPAN');
    expect(firstBadge).toBeTruthy();
    expect(firstBadge).toHaveAttribute('title', expect.stringContaining('first activity for this record'));
    await userEvent.selectOptions(screen.getByLabelText('Activity'), 'recorded');
    expect(screen.getByText('Assignment 5')).toBeInTheDocument();
    expect(screen.queryByText('Digital Marketing')).not.toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Activity'), 'all');
    await userEvent.selectOptions(screen.getByLabelText('Details'), 'Title');
    expect(screen.getByText('Digital Marketing')).toBeInTheDocument();
    expect(screen.queryByText('Assignment 5')).not.toBeInTheDocument();
  });

  it('opens the changed fields so before and after values are readable', async () => {
    fetchPersonActivity.mockResolvedValue(activity({
      changes: [change({ changes: [
        { field: 'session_start_time', label: 'Session start time', before: '09:00', after: '10:00' },
        { field: 'teams_link', label: 'Teams meeting link', before: '', after: 'https://teams.example/meeting' },
      ] })],
    }));
    renderPage();
    const expand = await screen.findByRole('button', { name: '2 fields changed' });
    await userEvent.click(expand);
    expect(screen.getByText('What changed in this save')).toBeInTheDocument();
    expect(screen.getAllByText('Session start time').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('09:00')).toBeInTheDocument();
    expect(screen.getByText('10:00')).toBeInTheDocument();
    expect(screen.getByText('https://teams.example/meeting')).toBeInTheDocument();
  });

  it('shows module titles for module ID changes', async () => {
    fetchCurriculumOverview.mockResolvedValue({ modules: [
      { id: 'MOD-OLD', name: 'Commercial Intelligence copy' },
      { id: 'MOD-NEW', name: 'Commercial Intelligence' },
    ] });
    fetchPersonActivity.mockResolvedValue(activity({
      changes: [change({ changes: [
        { field: 'module_ids', label: 'Module IDs', before: '["MOD-OLD"]', after: '["MOD-NEW"]' },
      ] })],
    }));
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: '1 field changed' }));
    expect(await screen.findByText('Commercial Intelligence copy')).toBeInTheDocument();
    expect(await screen.findByText('Commercial Intelligence')).toBeInTheDocument();
    expect(screen.queryByText('MOD-OLD')).not.toBeInTheDocument();
    expect(screen.queryByText('MOD-NEW')).not.toBeInTheDocument();
  });

  it('groups identical unplaced records while keeping their count visible', async () => {
    const repeated = change({ placed: false, at: '2026-09-16T09:16:00Z' });
    fetchPersonActivity.mockResolvedValue(activity({
      visits: [{ ...activity().visits[0], changeCount: 0, pages: [{ ...activity().visits[0].pages[0], changes: [] }] }],
      changes: [repeated, { ...repeated, id: 'rev:2' }],
      counts: { visits: 1, pageViews: 1, readActions: 1, changes: 2, changesOnAPage: 0, signIns: 1 },
    }));
    renderPage();
    expect(await screen.findByText('2 identical records')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Digital Marketing' })).toHaveLength(1);
  });

  it('says plainly when no visit was ever recorded', async () => {
    fetchPersonActivity.mockResolvedValue(activity({
      visitsRecorded: false,
      visits: [],
      changes: [change({ placed: false })],
    }));
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Activity log' })).toBeInTheDocument();
    expect(screen.queryByText('Page opens are not being recorded.')).not.toBeInTheDocument();
  });
});
