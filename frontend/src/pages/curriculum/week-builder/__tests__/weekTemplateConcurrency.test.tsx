import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  WeekTemplateApiError,
  weekTemplateConflict,
  type WeekTemplate,
} from '../weekTemplateData';

/**
 * Two people in the same week template, saving before either one polls.
 *
 * This endpoint takes the component list whole: a PATCH deletes every
 * component row the template owns and re-inserts what it was sent. So a save
 * built on a version somebody else has already replaced does not lose a field,
 * it loses their whole afternoon -- and until the server started refusing it,
 * the only thing standing in the way was a poll happening to arrive first.
 */

describe('recognising a refused week template save', () => {
  const conflictBody = {
    error: 'Someone else saved this while you were editing it.',
    conflict: true,
    expectedRevision: 'rev-10',
    currentRevision: 'rev-11',
    weekTemplate: {
      id: 'WT-1',
      title: 'Week one',
      revision: 'rev-11',
      components: [{ id: 'C1', type: 'reading', title: 'Reading task' }],
    },
  };

  it('reads the stored template and the version to retry against', () => {
    const conflict = weekTemplateConflict(
      new WeekTemplateApiError('Week template API returned 409', 409, conflictBody),
    );

    expect(conflict?.currentRevision).toBe('rev-11');
    expect(conflict?.template?.components.map(item => item.id)).toEqual(['C1']);
    // Mapped, not handed back raw: the editor merges against the same shape it
    // holds, never against whatever the wire happened to carry.
    expect(conflict?.template?.revision).toBe('rev-11');
  });

  it('is not confused by another kind of refusal', () => {
    // A tutor double-booking is a 409 too, and means something completely
    // different: there is nothing to rebase onto and nothing to retry.
    expect(weekTemplateConflict(
      new WeekTemplateApiError('Week template API returned 409', 409, { error: 'Tutor is already booked.' }),
    )).toBeNull();
    expect(weekTemplateConflict(
      new WeekTemplateApiError('Week template API returned 500', 500, conflictBody),
    )).toBeNull();
    expect(weekTemplateConflict(new Error('offline'))).toBeNull();
  });
});

/**
 * The editor end to end: a refused save, the merge, and the retry.
 */
// The editor reads the signed-in account on its first line, and renders inside
// the workspace chrome. Neither has anything to do with concurrency.
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ auth: { account: { role: 'curriculum' } } }),
}));

vi.mock('@/components/feature/WorkspaceShell', () => ({
  WorkspaceShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/feature/CurriculumSweetAlert', () => ({
  showCurriculumAlert: vi.fn(async () => undefined),
  showCurriculumConfirm: vi.fn(async () => true),
  showCurriculumLoading: vi.fn(),
  closeCurriculumLoading: vi.fn(),
}));

const fetchWeekTemplateDetail = vi.fn();
const updateWeekTemplate = vi.fn();
const createWeekTemplate = vi.fn();

vi.mock('../weekTemplateData', async importOriginal => {
  const original = await importOriginal<typeof import('../weekTemplateData')>();
  return {
    ...original,
    fetchWeekTemplates: vi.fn(async () => []),
    fetchWeekTemplateDetail: (...args: unknown[]) => fetchWeekTemplateDetail(...args),
    updateWeekTemplate: (...args: unknown[]) => updateWeekTemplate(...args),
    createWeekTemplate: (...args: unknown[]) => createWeekTemplate(...args),
    // The editor renders a spinner until its picker scope and points rules have
    // landed. Neither has anything to do with concurrency; both are answered
    // immediately so every case below starts at the editor.
    loadCurriculumScope: vi.fn(async () => ({ programmes: [], cohorts: [], groups: [], modules: [] })),
    fetchComponentPointsDefaults: vi.fn(async () => ({})),
    fetchWorkspaceQuizzes: vi.fn(async () => []),
  };
});

function component(id: string, title: string) {
  return {
    id,
    weekId: 'WT-1',
    type: 'reading' as const,
    title,
    description: '',
    expectedOtjh: 1,
    points: 5,
    reflectionRequired: false,
    reflectionQuestion: '',
    workplaceEvidenceRequired: false,
    tutorValidationRequired: false,
    coachValidationRequired: true,
    ksbMappings: [],
    settings: {},
  };
}

function template(overrides: Partial<WeekTemplate> = {}): WeekTemplate {
  const components = overrides.components || [component('C1', 'Reading task')];
  return {
    id: 'WT-1',
    title: 'Week one',
    summary: '',
    learningOutcomes: [],
    courseType: 'paid',
    programmeId: '',
    programmeName: '',
    moduleCatalogueId: '',
    groupId: '',
    groupName: '',
    status: 'draft',
    ksbMappings: [],
    totalOtjh: components.length,
    points: components.length * 5,
    componentCount: components.length,
    author: '',
    revision: 'rev-10',
    ...overrides,
    components,
  };
}

function refusal(stored: WeekTemplate, currentRevision: string) {
  return new WeekTemplateApiError('Week template API returned 409', 409, {
    error: 'Someone else saved this while you were editing it.',
    conflict: true,
    expectedRevision: 'rev-10',
    currentRevision,
    weekTemplate: {
      ...stored,
      revision: currentRevision,
      components: stored.components.map(item => ({ ...item })),
    },
  });
}

describe('week builder under a stale save', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchWeekTemplateDetail.mockResolvedValue(template());
  });

  afterEach(() => vi.useRealTimers());

  async function openEditor(initial = template()) {
    const { TemplateEditor } = await import('../page');
    render(
      <MemoryRouter>
        <TemplateEditor initial={initial} isNew={false} onClose={vi.fn()} />
      </MemoryRouter>,
    );
    await screen.findByDisplayValue('Week one');
  }

  /**
   * Give the editor something of this reader's to save.
   *
   * Save is disabled until the template is dirty, which is right -- and it also
   * means every case here has to start from a real edit rather than an empty
   * save, which is how the race actually happens.
   */
  async function editTitle(text: string) {
    await userEvent.type(screen.getByDisplayValue('Week one'), text);
  }

  it('merges the other editor components in and saves once against their version', async () => {
    const theirs = template({
      components: [component('C1', 'Reading task'), component('A-NEW', 'A added this')],
    });
    updateWeekTemplate
      .mockRejectedValueOnce(refusal(theirs, 'rev-11'))
      .mockImplementationOnce(async (_id: string, input: { components?: unknown[] }) => template({
        components: input.components as never,
        revision: 'rev-12',
      }));
    await openEditor();
    await editTitle(', as B renamed it');

    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(updateWeekTemplate).toHaveBeenCalledTimes(2));
    const first = updateWeekTemplate.mock.calls[0][1] as Record<string, unknown>;
    const retry = updateWeekTemplate.mock.calls[1][1] as { components: { id: string }[]; expectedRevision?: string };
    // The first save carried the version the editor read; the retry carries the
    // one the refusal named, so it is checked rather than forced through.
    expect(first.expectedRevision).toBe('rev-10');
    expect(retry.expectedRevision).toBe('rev-11');
    // And the other editor's component is in the list that was finally stored,
    // which is the whole point: it used to be deleted and never mentioned.
    expect(retry.components.map(item => item.id)).toContain('A-NEW');
  });

  it('stops after three rebases rather than saving forever', async () => {
    updateWeekTemplate
      .mockRejectedValueOnce(refusal(template({ title: 'Theirs 1' }), 'rev-11'))
      .mockRejectedValueOnce(refusal(template({ title: 'Theirs 2' }), 'rev-12'))
      .mockRejectedValueOnce(refusal(template({ title: 'Theirs 3' }), 'rev-13'))
      .mockRejectedValueOnce(refusal(template({ title: 'Theirs 4' }), 'rev-14'))
      .mockRejectedValue(refusal(template({ title: 'Theirs 5' }), 'rev-15'));
    await openEditor();
    await editTitle(', as B renamed it');

    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));

    // The first save plus three rebases, and then it stops and says so rather
    // than spinning: a template being written this fast is worth mentioning.
    await waitFor(() => expect(updateWeekTemplate).toHaveBeenCalledTimes(4));
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(updateWeekTemplate).toHaveBeenCalledTimes(4);
    expect(updateWeekTemplate.mock.calls.map(call => (call[1] as { expectedRevision?: string }).expectedRevision))
      .toEqual(['rev-10', 'rev-11', 'rev-12', 'rev-13']);
  });

  it('saves unguarded when the template carries no version', async () => {
    // A template read before this existed, or one whose revision could not be
    // read. It falls back to the write this editor always did rather than
    // refusing to save at all.
    updateWeekTemplate.mockResolvedValue(template({ revision: 'rev-11' }));
    await openEditor(template({ revision: undefined }));
    await editTitle(', as B renamed it');

    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(updateWeekTemplate).toHaveBeenCalled());
    expect(updateWeekTemplate.mock.calls[0][1]).not.toHaveProperty('expectedRevision');
  });
});
