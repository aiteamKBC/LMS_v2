import { StrictMode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurriculumKsbAchievementResponse } from '@/lib/curriculumApi';
import { fetchCurriculumKsbAchievement } from '@/lib/curriculumApi';
import { KsbAchievementTab } from '../KsbAchievementTab';

/**
 * The Achievement tab says "No KSB source is applied" only when the answer for
 * this programme says so. A request the tab has replaced -- StrictMode's second
 * mount, or the placeholder id giving way to the real one -- must not clear the
 * loading state of the read that replaced it: that read takes ~90s on a large
 * programme, and for all of it the tab used to report a programme on ST0845 as
 * having no source.
 */

vi.mock('@/lib/curriculumApi', () => ({
  fetchCurriculumKsbAchievement: vi.fn(),
  fetchCurriculumKsbAchievementConsumptions: vi.fn(async () => ({ items: [] })),
}));

const fetchAchievement = vi.mocked(fetchCurriculumKsbAchievement);

function achievement(source: { type: string; id: string; label: string }): CurriculumKsbAchievementResponse {
  return {
    scope: { programmeId: 'PROG', cohortId: null, groupId: null, moduleId: null },
    appliedSource: { ...source, definitionCount: source.id ? 71 : 0 },
    summary: { appliedKsbCount: source.id ? 71 : 0, consumedKsbCount: 0, learnerCount: 0, consumptionCount: 0 },
    items: [],
    ksbPagination: { page: 1, pageSize: 25, total: 0, hasNext: false },
    consumptionLog: { items: [], page: 1, pageSize: 50, total: 0, hasNext: false },
  } as unknown as CurriculumKsbAchievementResponse;
}

const ST0845 = achievement({ type: 'standard', id: 'st0845-v1-1', label: 'Project controls professional (ST0845 v1.1)' });
const NO_SOURCE = achievement({ type: '', id: '', label: '' });

/** A pending read that rejects the way curriculumApi's settleWithCallerAbort does. */
function pendingRead() {
  let resolve!: (value: CurriculumKsbAchievementResponse) => void;
  let signal: AbortSignal | undefined;
  const promise = (s?: AbortSignal) => {
    signal = s;
    return new Promise<CurriculumKsbAchievementResponse>((res, reject) => {
      resolve = res;
      s?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')), { once: true });
    });
  };
  return { promise, resolve: (value: CurriculumKsbAchievementResponse) => resolve(value), aborted: () => Boolean(signal?.aborted) };
}

function renderTab(programmeId: string, strict = false) {
  const tree = (id: string) => (
    <MemoryRouter initialEntries={['/curriculum/programmes/PROG?tab=achievement']}>
      <KsbAchievementTab programmeId={id} />
    </MemoryRouter>
  );
  const view = render(strict ? <StrictMode>{tree(programmeId)}</StrictMode> : tree(programmeId));
  return {
    ...view,
    rerenderWith: (id: string) => view.rerender(strict ? <StrictMode>{tree(id)}</StrictMode> : tree(id)),
  };
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('KsbAchievementTab applied source', () => {
  beforeEach(() => {
    fetchAchievement.mockReset();
  });

  it('keeps reading, not "No KSB source", while StrictMode\'s replacement read is pending', async () => {
    const reads = [pendingRead(), pendingRead()];
    fetchAchievement.mockImplementation((_id, _params, signal) => reads[fetchAchievement.mock.calls.length - 1].promise(signal));

    renderTab('PROG-PCP-L6', true);
    await waitFor(() => expect(fetchAchievement).toHaveBeenCalledTimes(2));
    expect(reads[0].aborted()).toBe(true);
    await flush();

    expect(screen.getByText('Loading actual KSB consumption…')).toBeInTheDocument();
    expect(screen.queryByText('No KSB source is applied to this programme.')).not.toBeInTheDocument();

    reads[1].resolve(ST0845);
    expect(await screen.findByText('Project controls professional (ST0845 v1.1)')).toBeInTheDocument();
    expect(screen.queryByText('No KSB source is applied to this programme.')).not.toBeInTheDocument();
  });

  it('names an applied standard by its label', async () => {
    fetchAchievement.mockResolvedValue(ST0845);
    renderTab('PROG-PCP-L6');
    expect(await screen.findByText('Project controls professional (ST0845 v1.1)')).toBeInTheDocument();
    expect(screen.getByText(/71 KSB definitions/)).toBeInTheDocument();
  });

  it('names an applied active manual profile by its label', async () => {
    fetchAchievement.mockResolvedValue(achievement({ type: 'framework', id: 'KSBP-ACTIVE', label: 'Bespoke data profile' }));
    renderTab('PROG-BESPOKE');
    expect(await screen.findByText('Bespoke data profile')).toBeInTheDocument();
    expect(screen.queryByText('No KSB source is applied to this programme.')).not.toBeInTheDocument();
  });

  it('still says "No KSB source" when the answer for this programme has none', async () => {
    fetchAchievement.mockResolvedValue(NO_SOURCE);
    renderTab('PROG-BARE');
    expect(await screen.findByText('No KSB source is applied to this programme.')).toBeInTheDocument();
  });

  it('never shows the placeholder or previous programme\'s answer while the next one loads', async () => {
    const next = pendingRead();
    fetchAchievement
      .mockResolvedValueOnce(NO_SOURCE)
      .mockImplementationOnce((_id, _params, signal) => next.promise(signal));

    const view = renderTab('PROG-OLD');
    expect(await screen.findByText('No KSB source is applied to this programme.')).toBeInTheDocument();

    view.rerenderWith('PROG-PCP-L6');
    await waitFor(() => expect(fetchAchievement).toHaveBeenLastCalledWith('PROG-PCP-L6', expect.anything(), expect.anything()));
    expect(screen.queryByText('No KSB source is applied to this programme.')).not.toBeInTheDocument();
    expect(screen.getByText('Loading actual KSB consumption…')).toBeInTheDocument();

    next.resolve(ST0845);
    expect(await screen.findByText('Project controls professional (ST0845 v1.1)')).toBeInTheDocument();
  });

  it('drops a replaced read that answers late, so the current source stands', async () => {
    const stale = pendingRead();
    fetchAchievement
      .mockImplementationOnce((_id, _params, signal) => stale.promise(signal))
      .mockResolvedValueOnce(ST0845);

    const view = renderTab('PROG-OLD');
    await waitFor(() => expect(fetchAchievement).toHaveBeenCalledTimes(1));
    view.rerenderWith('PROG-PCP-L6');
    expect(await screen.findByText('Project controls professional (ST0845 v1.1)')).toBeInTheDocument();

    stale.resolve(NO_SOURCE);
    await flush();
    expect(screen.getByText('Project controls professional (ST0845 v1.1)')).toBeInTheDocument();
    expect(screen.queryByText('No KSB source is applied to this programme.')).not.toBeInTheDocument();
  });
});
