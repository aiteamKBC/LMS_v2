import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { CurriculumAuditEvent, CurriculumAuditTrail } from '@/lib/curriculumApi';

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
vi.mock('@/lib/curriculumApi', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@/lib/curriculumApi');
  return { ...actual, fetchCurriculumAuditTrail: (...args: unknown[]) => fetchCurriculumAuditTrail(...args) };
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

function renderPage() {
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
  });

  it('shows a person as the person, and the save source as a source', async () => {
    renderPage();
    expect(await screen.findByText('Final Knowledge Check')).toBeInTheDocument();
    expect(screen.getByText('Ayman Badewi')).toBeInTheDocument();
    // The event is the edit. How it arrived is said separately, and never as
    // the headline. Scoped to the row, because "Edited" is also a filter option.
    const row = screen.getByRole('listitem');
    expect(within(row).getByText('Edited')).toBeInTheDocument();
    expect(within(row).getByText('via Auto-save')).toBeInTheDocument();
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
    renderPage();
    expect(await screen.findByText('Recalculated')).toBeInTheDocument();
    expect(screen.getByText('System')).toBeInTheDocument();
    // The person is shown as the cause, not as the author. The wording has to
    // carry that difference, because "Ayman Badewi" alone would read as
    // "Ayman edited this module", which he did not.
    expect(screen.getByText(/Triggered by/)).toBeInTheDocument();
    expect(screen.getByText('Ayman Badewi')).toBeInTheDocument();
    expect(screen.getByText('via Recalculation')).toBeInTheDocument();
  });

  it('does not claim a trigger for a change nobody caused', async () => {
    fetchCurriculumAuditTrail.mockResolvedValue(trail({
      events: [event({
        actorName: 'System', actorEmail: '', actorType: 'job', actorTypeLabel: 'Scheduled job',
        triggeredByEmail: '', triggeredByName: '',
        source: 'scheduled-job', sourceLabel: 'Scheduled job',
      })],
    }));
    renderPage();
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
    renderPage();
    expect(await screen.findByText('Uploaded file')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Details/ }));
    expect(await screen.findByText('week-4-reading.pdf')).toBeInTheDocument();
    expect(screen.getByText('File name')).toBeInTheDocument();
  });

  it('shows before and after for the fields that moved', async () => {
    renderPage();
    await screen.findByText('Final Knowledge Check');
    await userEvent.click(screen.getByRole('button', { name: /1 changed field/ }));
    // The old value and the new one, side by side and labelled as such.
    const before = (await screen.findByText(/^Before:$/)).parentElement;
    expect(before?.textContent).toContain('Quiz 1');
    expect(screen.getByText(/^After:$/).parentElement?.textContent).toContain('Final Knowledge Check');
    expect(screen.getByText('Title')).toBeInTheDocument();
  });

  it('offers the source and actor-type filters only when the server can answer them', async () => {
    renderPage();
    await screen.findByText('Final Knowledge Check');
    expect(screen.getByLabelText(/How/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Made by/)).toBeInTheDocument();
  });

  it('hides those filters when the audit metadata columns do not exist yet', async () => {
    // Before the Phase 2 SQL has run there is no column to filter on. A select
    // that silently matched nothing would imply the data is there.
    fetchCurriculumAuditTrail.mockResolvedValue(trail({ structuredMetadata: false }));
    renderPage();
    await screen.findByText('Final Knowledge Check');
    expect(screen.queryByLabelText(/How/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Made by/)).not.toBeInTheDocument();
  });

  it('still renders an older API response that carries none of the new fields', async () => {
    // A deployed frontend must not break against a backend that has not been
    // updated yet, so every new field is read defensively.
    const legacy = event();
    delete (legacy as Record<string, unknown>).actorTypeLabel;
    delete (legacy as Record<string, unknown>).triggeredByName;
    delete (legacy as Record<string, unknown>).sourceLabel;
    delete (legacy as Record<string, unknown>).metadata;
    const older = trail({ events: [legacy] });
    delete (older as Record<string, unknown>).structuredMetadata;
    fetchCurriculumAuditTrail.mockResolvedValue(older);

    renderPage();
    expect(await screen.findByText('Final Knowledge Check')).toBeInTheDocument();
    expect(screen.getByText('Ayman Badewi')).toBeInTheDocument();
    // Falls back to the stored value when there is no label for it.
    expect(screen.getByText('via auto-save')).toBeInTheDocument();
  });

  it('says plainly when no author is recorded rather than showing a blank column', async () => {
    fetchCurriculumAuditTrail.mockResolvedValue(trail({
      authorRecorded: false,
      source: 'timestamps',
      structuredMetadata: false,
      actors: [],
      events: [event({ actorName: '', actorEmail: '', actorType: '', actorTypeLabel: '', source: '', sourceLabel: '' })],
    }));
    renderPage();
    expect(await screen.findByText(/No author is recorded against these changes/)).toBeInTheDocument();
  });
});
