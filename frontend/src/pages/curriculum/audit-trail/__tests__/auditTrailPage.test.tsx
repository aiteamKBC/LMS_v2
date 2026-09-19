import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { CurriculumActivityPeople, CurriculumAuditEvent, CurriculumAuditTrail } from '@/lib/curriculumApi';

/**
 * The Audit Trail page, read as a person reads it.
 *
 * The distinctions being guarded here are all ones that are invisible when they
 * go wrong. A system cascade shown as a person's edit still looks like a page
 * full of history; so does an auto-save listed as though "auto-save" were the
 * thing that happened, or a page offering a filter it cannot actually answer.
 */

vi.mock('@/components/feature/WorkspaceShell', () => ({
  WorkspaceShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

const fetchCurriculumAuditTrail = vi.fn();
const fetchCurriculumOverview = vi.fn();
const fetchCurriculumActivityPeople = vi.fn();
vi.mock('@/lib/curriculumApi', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@/lib/curriculumApi');
  return {
    ...actual,
    fetchCurriculumOverview: (...args: unknown[]) => fetchCurriculumOverview(...args),
    fetchCurriculumAuditTrail: (...args: unknown[]) => fetchCurriculumAuditTrail(...args),
    fetchCurriculumActivityPeople: (...args: unknown[]) => fetchCurriculumActivityPeople(...args),
  };
});

import CurriculumAuditTrailPage from '../page';

function event(overrides: Partial<CurriculumAuditEvent> = {}): CurriculumAuditEvent {
  return {
    id: 'rev:1',
    at: '2026-09-16T14:32:00Z',
    action: 'updated',
    actionLabel: 'Edited',
    entity: 'component',
    entityLabel: 'Component',
    entityId: 'COMP-1',
    revisionNo: 4,
    title: 'Final Knowledge Check',
    context: 'Marketing L4 › Sept 2026 › Group A › Digital Marketing',
    parents: {},
    moduleCatalogueId: 'MOD-1',
    parentId: 'WEEK-1',
    versionLabel: '',
    contentStatus: '',
    actorName: 'Ayman Badewi',
    actorEmail: 'ayman@kentbusinesscollege.com',
    actorType: 'user',
    actorTypeLabel: 'Person',
    triggeredByEmail: '',
    triggeredByName: '',
    source: 'auto-save',
    sourceLabel: 'Auto-save',
    metadata: {},
    reason: '',
    changes: [{ field: 'title', label: 'Title', before: 'Quiz 1', after: 'Final Knowledge Check' }],
    snapshot: null,
    href: '/curriculum/module-builder',
    ...overrides,
  } as CurriculumAuditEvent;
}

function trail(overrides: Partial<CurriculumAuditTrail> = {}): CurriculumAuditTrail {
  return {
    generatedAt: '2026-09-16T15:00:00Z',
    windowDays: 30,
    since: '2026-08-17T15:00:00Z',
    limit: 200,
    total: 1,
    truncated: false,
    actionCounts: {} as CurriculumAuditTrail['actionCounts'],
    entityCounts: {},
    unreadable: [],
    authorRecorded: true,
    source: 'revisions',
    structuredMetadata: true,
    sources: [],
    actorTypes: [],
    actors: [{ email: 'ayman@kentbusinesscollege.com', name: 'Ayman Badewi', changes: 4 }],
    events: [event()],
    ...overrides,
  } as CurriculumAuditTrail;
}

function people(overrides: Partial<CurriculumActivityPeople> = {}): CurriculumActivityPeople {
  return {
    generatedAt: '2026-09-16T15:00:00Z',
    windowDays: 30,
    since: '2026-08-17T15:00:00Z',
    visitsRecorded: true,
    changesRecorded: true,
    signInsRecorded: true,
    truncated: false,
    totals: { people: 1, visits: 2, pageViews: 9, readActions: 4, changes: 4, signIns: 2 },
    people: [{
      email: 'ayman@kentbusinesscollege.com',
      name: 'Ayman Badewi',
      role: 'admin',
      firstSeen: '2026-09-16T09:00:00Z',
      lastSeen: '2026-09-16T14:32:00Z',
      visits: 2,
      pageViews: 9,
      readActions: 4,
      pagesOpened: 5,
      changes: 4,
      signIns: 2,
      lastPageKey: 'module-builder',
      lastPageLabel: 'Module builder',
    }],
    ...overrides,
  } as CurriculumActivityPeople;
}

/**
 * The page opens on People, so a test about the change feed has to move to it
 * first. Kept in one helper so the tab is switched exactly the same way
 * everywhere rather than each test inventing its own route into the feed.
 */
async function renderChanges() {
  const result = render(
    <MemoryRouter initialEntries={['/curriculum/audit-trail']}>
      <CurriculumAuditTrailPage />
    </MemoryRouter>,
  );
  await userEvent.click(await screen.findByRole('button', { name: /Changes/ }));
  return result;
}

function renderPeople() {
  return render(
    <MemoryRouter initialEntries={['/curriculum/audit-trail']}>
      <CurriculumAuditTrailPage />
    </MemoryRouter>,
  );
}

describe('Curriculum audit trail page', () => {
  beforeEach(() => {
    fetchCurriculumAuditTrail.mockReset();
    fetchCurriculumAuditTrail.mockResolvedValue(trail());
    fetchCurriculumOverview.mockReset();
    fetchCurriculumOverview.mockResolvedValue({ modules: [] });
    fetchCurriculumActivityPeople.mockReset();
    fetchCurriculumActivityPeople.mockResolvedValue(people());
  });

  it('shows a person as the person, and the save source as a source', async () => {
    await renderChanges();
    expect(await screen.findByText('Final Knowledge Check')).toBeInTheDocument();
    expect(screen.getByText('Ayman Badewi')).toBeInTheDocument();
    // The event is the edit. How it arrived is said separately, and never as
    // the headline. Scoped to the row, because "Edited" is also a filter option.
    const row = screen.getByRole('listitem');
    expect(within(row).getByText('Edited')).toBeInTheDocument();
    expect(within(row).getByText('Saved automatically')).toBeInTheDocument();
  });

  it('links a component change to its exact module and week location', async () => {
    await renderChanges();
    const link = await screen.findByRole('link', { name: 'Final Knowledge Check' });
    expect(link).toHaveAttribute(
      'href',
      '/curriculum/module-builder?module=MOD-1&component=COMP-1&focus=component&week=WEEK-1',
    );
  });

  it('takes archived component changes to the archive instead of a missing builder', async () => {
    fetchCurriculumAuditTrail.mockResolvedValue(trail({ events: [event({ action: 'archived', actionLabel: 'Archived', contentStatus: 'archived' })] }));
    await renderChanges();
    expect(await screen.findByRole('link', { name: 'Final Knowledge Check' })).toHaveAttribute(
      'href',
      '/curriculum/module-builder?view=archive&archiveModule=MOD-1',
    );
  });

  it('shows a system action as the system, naming the person who caused it', async () => {
    fetchCurriculumAuditTrail.mockResolvedValue(trail({
      events: [event({
        id: 'rev:2',
        action: 'recalculated',
        actionLabel: 'Recalculated',
        entity: 'module',
        entityLabel: 'Module',
        title: 'Digital Marketing',
        actorName: 'System',
        actorEmail: '',
        actorType: 'system',
        actorTypeLabel: 'System',
        triggeredByEmail: 'ayman@kentbusinesscollege.com',
        triggeredByName: 'Ayman Badewi',
        source: 'recalculation',
        sourceLabel: 'Recalculation',
        changes: [{ field: 'programme_name', label: 'Programme name', before: 'Old', after: 'New' }],
      })],
    }));
    await renderChanges();
    expect(await screen.findByText('Recalculated')).toBeInTheDocument();
    expect(screen.getByText('System')).toBeInTheDocument();
    // The person is shown as the cause, not as the author. The wording has to
    // carry that difference, because "Ayman Badewi" alone would read as
    // "Ayman edited this module", which he did not.
    expect(screen.getByText(/Triggered by/)).toBeInTheDocument();
    expect(screen.getByText('Ayman Badewi')).toBeInTheDocument();
    expect(screen.getByText('Saved via Recalculation')).toBeInTheDocument();
  });

  it('does not claim a trigger for a change nobody caused', async () => {
    fetchCurriculumAuditTrail.mockResolvedValue(trail({
      events: [event({
        actorName: 'System', actorEmail: '', actorType: 'job', actorTypeLabel: 'Scheduled job',
        triggeredByEmail: '', triggeredByName: '',
        source: 'scheduled-job', sourceLabel: 'Scheduled job',
      })],
    }));
    await renderChanges();
    await screen.findByText('Final Knowledge Check');
    expect(screen.queryByText(/Triggered by/)).not.toBeInTheDocument();
  });

  it('names a file event and what it attached', async () => {
    fetchCurriculumAuditTrail.mockResolvedValue(trail({
      events: [event({
        action: 'file_uploaded',
        actionLabel: 'Uploaded file',
        title: 'Reading Material',
        changes: [],
        metadata: { file_name: 'week-4-reading.pdf', file_type: 'application/pdf', file_size: 1048576 },
      })],
    }));
    await renderChanges();
    expect(await screen.findByText('Uploaded file')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Details/ }));
    expect(await screen.findByText('week-4-reading.pdf')).toBeInTheDocument();
    expect(screen.getByText('File name')).toBeInTheDocument();
  });

  it('shows before and after for the fields that moved', async () => {
    await renderChanges();
    await screen.findByText('Final Knowledge Check');
    await userEvent.click(screen.getByRole('button', { name: /1 changed field/ }));
    // The old value and the new one, side by side and labelled as such.
    const before = (await screen.findByText(/^Before:$/)).parentElement;
    expect(before?.textContent).toContain('Quiz 1');
    expect(screen.getByText(/^After:$/).parentElement?.textContent).toContain('Final Knowledge Check');
    expect(screen.getByText('Title')).toBeInTheDocument();
  });

  it('offers the source and actor-type filters only when the server can answer them', async () => {
    await renderChanges();
    await screen.findByText('Final Knowledge Check');
    expect(screen.getByLabelText(/How/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Made by/)).toBeInTheDocument();
  });

  it('hides those filters when the audit metadata columns do not exist yet', async () => {
    // Before the Phase 2 SQL has run there is no column to filter on. A select
    // that silently matched nothing would imply the data is there.
    fetchCurriculumAuditTrail.mockResolvedValue(trail({ structuredMetadata: false }));
    await renderChanges();
    await screen.findByText('Final Knowledge Check');
    expect(screen.queryByLabelText(/How/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Made by/)).not.toBeInTheDocument();
  });

  it('still renders an older API response that carries none of the new fields', async () => {
    // A deployed frontend must not break against a backend that has not been
    // updated yet, so every new field is read defensively.
    const legacy = event();
    Reflect.deleteProperty(legacy, 'actorTypeLabel');
    Reflect.deleteProperty(legacy, 'triggeredByName');
    Reflect.deleteProperty(legacy, 'sourceLabel');
    Reflect.deleteProperty(legacy, 'metadata');
    const older = trail({ events: [legacy] });
    Reflect.deleteProperty(older, 'structuredMetadata');
    fetchCurriculumAuditTrail.mockResolvedValue(older);

    await renderChanges();
    expect(await screen.findByText('Final Knowledge Check')).toBeInTheDocument();
    expect(screen.getByText('Ayman Badewi')).toBeInTheDocument();
    // Falls back to the stored value when there is no label for it.
    expect(screen.getByText('Saved automatically')).toBeInTheDocument();
  });

  it('says plainly when no author is recorded rather than showing a blank column', async () => {
    fetchCurriculumAuditTrail.mockResolvedValue(trail({
      authorRecorded: false,
      source: 'timestamps',
      structuredMetadata: false,
      actors: [],
      events: [event({ actorName: '', actorEmail: '', actorType: '', actorTypeLabel: '', source: '', sourceLabel: '' })],
    }));
    await renderChanges();
    expect(await screen.findByText(/No author is recorded against these changes/)).toBeInTheDocument();
  });
});

/** The list row for the fixture person, found through a cell only they have. */
function personRow(): HTMLElement | null {
  return screen.getByText('ayman@kentbusinesscollege.com').closest('[role="button"]');
}

describe('Curriculum audit trail: the People view', () => {
  beforeEach(() => {
    fetchCurriculumAuditTrail.mockReset();
    fetchCurriculumAuditTrail.mockResolvedValue(trail());
    fetchCurriculumActivityPeople.mockReset();
    fetchCurriculumActivityPeople.mockResolvedValue(people());
  });

  it('opens on the people who used the curriculum, not on the change feed', async () => {
    renderPeople();
    // The question the page is most often asked is "who has been in here", and
    // the change feed cannot answer it: somebody who only read appears nowhere
    // in it.
    expect(await screen.findByText('Ayman Badewi')).toBeInTheDocument();
    expect(screen.getByText('ayman@kentbusinesscollege.com')).toBeInTheDocument();
    expect(fetchCurriculumActivityPeople).toHaveBeenCalled();
    expect(fetchCurriculumAuditTrail).not.toHaveBeenCalled();
  });

  it('offers a named way into one person, not a bare clickable row', async () => {
    renderPeople();
    await screen.findByText('Ayman Badewi');
    // An exact name, because the row itself is a button too and its accessible
    // name contains every cell -- including this button's own label.
    expect(screen.getByRole('button', { name: 'View activity' })).toBeInTheDocument();
  });

  it('counts the three sources separately rather than summing them', async () => {
    renderPeople();
    await screen.findByText('Ayman Badewi');
    // A page open, a save and a sign-in are three different claims. One
    // "activity" total would quietly merge somebody who read for an hour with
    // somebody who signed in and left.
    const row = personRow();
    expect(row?.textContent).toContain('9');
    expect(row?.textContent).toContain('4');
    expect(row?.textContent).toContain('Module builder');
  });

  it('says page opens are not recorded, and shows a dash rather than a zero', async () => {
    // A zero would be a claim that nobody opened anything. The truth is that
    // nothing was looking.
    fetchCurriculumActivityPeople.mockResolvedValue(people({
      visitsRecorded: false,
      people: [{
        email: 'ayman@kentbusinesscollege.com',
        name: 'Ayman Badewi',
        role: '',
        firstSeen: '2026-09-16T09:00:00Z',
        lastSeen: '2026-09-16T14:32:00Z',
        visits: 0,
        pageViews: 0,
        readActions: 0,
        pagesOpened: 0,
        changes: 4,
        signIns: 2,
        lastPageKey: '',
        lastPageLabel: '',
      }],
    }));
    renderPeople();
    // The exact sentence in the notice. The hero says the same thing in its own
    // words, so a loose match would find both.
    expect(await screen.findByText('Page opens are not being recorded yet.')).toBeInTheDocument();
    const row = personRow();
    expect(row?.textContent).toContain('—');
    // The sources that ARE recorded still report their real numbers.
    expect(row?.textContent).toContain('4');
  });

  it('moves to the change feed only when asked, and loads it then', async () => {
    renderPeople();
    await screen.findByText('Ayman Badewi');
    expect(fetchCurriculumAuditTrail).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: /Changes/ }));
    expect(await screen.findByText('Final Knowledge Check')).toBeInTheDocument();
    expect(fetchCurriculumAuditTrail).toHaveBeenCalled();
  });

  it('keeps the current people visible while Refresh revalidates in the background', async () => {
    renderPeople();
    expect(await screen.findByText('Ayman Badewi')).toBeInTheDocument();

    let resolveRefresh: (value: CurriculumActivityPeople) => void = () => undefined;
    fetchCurriculumActivityPeople.mockImplementationOnce(() => new Promise(resolve => {
      resolveRefresh = resolve;
    }));

    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(screen.getByText('Ayman Badewi')).toBeInTheDocument();
    expect(fetchCurriculumActivityPeople).toHaveBeenLastCalledWith(expect.objectContaining({ revalidate: true }));

    resolveRefresh(people());
  });
});
