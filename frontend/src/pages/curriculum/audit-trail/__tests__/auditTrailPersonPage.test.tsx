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

const fetchCurriculumPersonActivity = vi.fn();
vi.mock('@/lib/curriculumApi', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@/lib/curriculumApi');
  return {
    ...actual,
    fetchCurriculumPersonActivity: (...args: unknown[]) => fetchCurriculumPersonActivity(...args),
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
    fetchCurriculumPersonActivity.mockReset();
    fetchCurriculumPersonActivity.mockResolvedValue(activity());
  });

  it('reads the person from the URL and shows their visits', async () => {
    renderPage();
    expect(await screen.findByText('Module workspace')).toBeInTheDocument();
    expect(fetchCurriculumPersonActivity).toHaveBeenCalledWith(
      'ayman@kentbusinesscollege.com',
      expect.objectContaining({ days: 30 }),
    );
  });

  it('puts what was done on the page it was done on', async () => {
    renderPage();
    await screen.findByText('Module workspace');
    // A search means something different depending on which page it was typed
    // on, so it is shown under that page rather than in a flat event list.
    await userEvent.click(screen.getByRole('button', { name: /1 action, 1 change/ }));
    expect(await screen.findByText('Searched')).toBeInTheDocument();
    expect(screen.getByText('query: week 4')).toBeInTheDocument();
    expect(screen.getByText('Digital Marketing', { selector: 'a' })).toBeInTheDocument();
  });

  it('says a time on page was not recorded rather than showing it as zero', async () => {
    fetchCurriculumPersonActivity.mockResolvedValue(activity({
      visits: [{
        ...activity().visits[0],
        pages: [{ ...activity().visits[0].pages[0], durationMs: null, actions: [], changes: [] }],
      }],
    }));
    renderPage();
    expect(await screen.findByText('time open not recorded')).toBeInTheDocument();
    expect(screen.getByText('opened, nothing else recorded')).toBeInTheDocument();
  });

  it('lists a change it could not place on a page instead of guessing one', async () => {
    fetchCurriculumPersonActivity.mockResolvedValue(activity({
      visits: [{ ...activity().visits[0], changeCount: 0, pages: [{ ...activity().visits[0].pages[0], changes: [] }] }],
      changes: [change({ placed: false })],
      counts: { visits: 1, pageViews: 1, readActions: 1, changes: 1, changesOnAPage: 0, signIns: 1 },
    }));
    renderPage();
    const section = (await screen.findByText(/Changes we could not place on a page/)).closest('section');
    expect(section).toBeTruthy();
    expect(within(section as HTMLElement).getByText('Digital Marketing')).toBeInTheDocument();
  });

  it('keeps account sign-ins separate from curriculum visits', async () => {
    renderPage();
    // A sign-in says the person entered the LMS, not that they opened the
    // curriculum. Merging the two would overstate what is known.
    expect(await screen.findByText('Account sign-ins')).toBeInTheDocument();
    expect(screen.getByText(/does not mean the curriculum was opened/)).toBeInTheDocument();
  });

  it('says plainly when no visit was ever recorded', async () => {
    fetchCurriculumPersonActivity.mockResolvedValue(activity({
      visitsRecorded: false,
      visits: [],
      changes: [change({ placed: false })],
    }));
    renderPage();
    expect(await screen.findByText('Page opens are not being recorded.')).toBeInTheDocument();
    // The changes still show: they were recorded by the save itself.
    expect(screen.getByText(/Changes we could not place on a page/)).toBeInTheDocument();
  });
});
