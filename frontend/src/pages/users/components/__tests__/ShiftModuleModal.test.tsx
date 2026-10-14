import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LearningPlanModule } from '@/api/learningPlan';
import { ShiftModuleModal } from '../ShiftModuleModal';

const mocks = vi.hoisted(() => ({
  fetchLearningPlan: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));
vi.mock('@/api/learningPlan', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/api/learningPlan')>(),
  fetchLearningPlan: mocks.fetchLearningPlan,
}));
vi.mock('@/hooks/useToast', () => ({ useToast: () => mocks }));

const source: LearningPlanModule = {
  moduleId: 'SOURCE', moduleTitle: 'Original module', groupName: 'First cohort group',
  programmeId: 'PROGRAMME', programmeName: 'Example programme', hours: 6,
};
const target: LearningPlanModule = {
  ...source, moduleId: 'TARGET', moduleTitle: 'Another cohort module',
  groupName: 'Second cohort group',
};
const options = {
  programme: { id: 'PROGRAMME', name: 'Example programme' },
  cohort: { id: 'FIRST', name: 'First cohort' },
  groups: [source.groupName, target.groupName], modules: [source, target], reason: '',
};
const progress = {
  weeks: [{
    order: 1,
    from: { weekId: 'W1', weekNumber: 1, title: 'Original week', components: [{
      componentId: 'C1', title: 'Original video', type: 'video', otjHours: 1,
      progress: { entries: 1, kinds: ['video'], lastAt: '', otjHours: 1, points: 2 },
    }] },
    to: { weekId: 'W2', weekNumber: 1, title: 'Target week', components: [{
      // A cloned component keeps its title/type, as required by the current matcher.
      componentId: 'C2', title: 'Original video', type: 'video', otjHours: 1,
    }] },
  }],
  suggested: [{ fromComponentId: 'C1', toComponentId: 'C2' }],
  progressedComponents: 1, reason: '',
};
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json' },
});

describe('programme-wide module shift', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.fetchLearningPlan.mockResolvedValue({ plan: [source] });
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it.each([
    ['missing', undefined],
    ['null', null],
  ])('keeps the dialog usable when the server returns %s programme metadata', async (_label, programme) => {
    // Older deployed responses contain cohort/groups/modules but no programme.
    mocks.fetchLearningPlan.mockResolvedValue({ plan: [source, { ...source, moduleId: 'SECOND', moduleTitle: 'Second source' }] });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ ...options, programme }))
      .mockResolvedValueOnce(response(options));
    vi.stubGlobal('fetch', fetchMock);
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<ShiftModuleModal learnerId="62" learnerName="Example learner" onClose={onClose} />);

    await user.click(await screen.findByRole('button', { name: /Original module/ }));
    expect(await screen.findByText('Programme-wide module options are unavailable. Please contact support.')).toBeVisible();
    expect(screen.getByRole('dialog')).toBeVisible();
    expect(screen.queryByRole('button', { name: /Another cohort module/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/teaches no other modules/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next: match progress' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: /Second source/ }));
    await user.click(await screen.findByRole('button', { name: /Another cohort module/ }));
    expect(screen.queryByText('Programme-wide module options are unavailable. Please contact support.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next: match progress' })).toBeEnabled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('selects another cohort module and saves the existing progress mapping for this learner', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(options))
      .mockResolvedValueOnce(response(progress))
      .mockResolvedValueOnce(response({ plan: [target], progressMoved: 1 }));
    vi.stubGlobal('fetch', fetchMock);
    const onSaved = vi.fn();
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<ShiftModuleModal learnerId="62" learnerName="Example learner" onSaved={onSaved} onClose={onClose} />);

    await user.click(await screen.findByRole('button', { name: /Another cohort module/ }));
    expect(screen.getByText(/Programme modules/)).toHaveTextContent('Example programme');
    expect(screen.queryByText(/Cohort modules/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next: match progress' }));
    expect(await screen.findByLabelText('Move progress on Original video to')).toHaveValue('C2');
    await user.click(screen.getByRole('button', { name: 'Shift module & progress' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(onClose).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe('/learner_api/module-shift/options/?moduleId=SOURCE');
    expect(fetchMock.mock.calls[1][0]).toBe('/learner_api/module-shift/62/progress/?from=SOURCE&to=TARGET');
    const [url, request] = fetchMock.mock.calls[2];
    expect(url).toBe('/learner_api/module-shift/62/');
    expect(request.method).toBe('PATCH');
    expect(JSON.parse(request.body)).toEqual({
      fromModuleId: 'SOURCE', toModuleId: 'TARGET', progressMappings: progress.suggested,
    });
  });

  it('keeps a module already assigned in another cohort disabled', async () => {
    mocks.fetchLearningPlan.mockResolvedValue({ plan: [source, target] });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(options)));
    const user = userEvent.setup();
    render(<ShiftModuleModal learnerId="62" learnerName="Example learner" onClose={vi.fn()} />);
    await user.click(await screen.findByRole('button', { name: /Original module/ }));
    expect(await screen.findByRole('button', { name: /Already assigned to this learner/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next: match progress' })).toBeDisabled();
  });

  it('shows a server programme rejection without reporting success or closing', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(response(options))
      .mockResolvedValueOnce(response({ weeks: [], suggested: [], progressedComponents: 0, reason: '' }))
      .mockResolvedValueOnce(response({ error: 'That module is not taught to this programme.' }, 400)));
    const onClose = vi.fn();
    const onSaved = vi.fn();
    const user = userEvent.setup();
    render(<ShiftModuleModal learnerId="62" learnerName="Example learner" onClose={onClose} onSaved={onSaved} />);
    await user.click(await screen.findByRole('button', { name: /Another cohort module/ }));
    await user.click(screen.getByRole('button', { name: 'Next: match progress' }));
    await screen.findByText(/There is no recorded progress to move/);
    await user.click(screen.getByRole('button', { name: 'Shift module' }));
    expect(await screen.findByText('That module is not taught to this programme.')).toBeVisible();
    expect(onClose).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
    expect(mocks.success).not.toHaveBeenCalled();
  });
});
