/**
 * Regression tests for the edit-mode hydration deadlock.
 *
 * The wizard gates "Next" on `programmeDetail.loading === false`
 * (`editingScheduledProgrammeNeedsHydration` in AddCurriculumStructureWizard).
 * `loadCohortStepData` sets `loading: true` up front, so any path that returns
 * without clearing it leaves the wizard permanently stuck on the Cohort step
 * with "Loading the saved programme structure before editing." in the footer.
 *
 * Two such paths existed:
 *  1. Two concurrent callers (the step effect and the prefetch effect both call
 *     loadCohortStepData for the same programme). The first caller loses the
 *     generation race and returns early, and if its bail lands after the
 *     winner's clear, `loading` stays true forever.
 *  2. `loadResource`'s CACHE_WARM_DURATION_MS guard returns null without ever
 *     invoking the fetcher, so a second call inside the 5s window resolves with
 *     no data — the caller must still clear `loading`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useCurriculumWizardData, type WizardStep } from './useCurriculumWizardData';
import {
  clearCurriculumGetCache,
  fetchCurriculumCoaches,
  fetchCurriculumHolidays,
  fetchCurriculumKsbSets,
  fetchCurriculumModules,
  fetchCurriculumProgrammeDetail,
  fetchCurriculumProgrammes,
  fetchCurriculumStandards,
  fetchCurriculumTutors,
} from '@/lib/curriculumApi';

vi.mock('@/lib/curriculumApi', async () => {
  const actual = await vi.importActual<typeof import('@/lib/curriculumApi')>('@/lib/curriculumApi');
  return {
    ...actual,
    clearCurriculumGetCache: vi.fn(),
    fetchCurriculumProgrammes: vi.fn(),
    fetchCurriculumProgrammeDetail: vi.fn(),
    fetchCurriculumModules: vi.fn(),
    fetchCurriculumKsbSets: vi.fn(),
    fetchCurriculumStandards: vi.fn(),
    fetchCurriculumCoaches: vi.fn(),
    fetchCurriculumTutors: vi.fn(),
    fetchCurriculumHolidays: vi.fn(),
  };
});

const detail = { schema: 'v1', programme: { id: 'prog-1' }, cohorts: [], flat: {} };

describe('useCurriculumWizardData — edit-mode hydration must always settle', () => {
  beforeEach(() => {
    vi.mocked(fetchCurriculumProgrammes).mockResolvedValue([]);
    vi.mocked(fetchCurriculumProgrammeDetail).mockResolvedValue(detail as never);
    vi.mocked(fetchCurriculumModules).mockResolvedValue([]);
    vi.mocked(fetchCurriculumKsbSets).mockResolvedValue([]);
    vi.mocked(fetchCurriculumStandards).mockResolvedValue([]);
    vi.mocked(fetchCurriculumCoaches).mockResolvedValue([]);
    vi.mocked(fetchCurriculumTutors).mockResolvedValue([]);
    vi.mocked(fetchCurriculumHolidays).mockResolvedValue([]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // The exact sequence the Edit button produces: open on the programme step
  // (whose prefetch warms the cohort data), then advance to the cohort step.
  it('clears loading after the programme step prefetch warms the cohort request', async () => {
    const { rerender, result } = renderHook(
      ({ step }: { step: WizardStep }) =>
        useCurriculumWizardData({ isOpen: true, currentStep: step, selectedProgrammeId: 'prog-1' }),
      { initialProps: { step: 'programme' as WizardStep } },
    );

    // Let the 300ms prefetch timer fire and settle.
    await new Promise(r => setTimeout(r, 600));

    rerender({ step: 'cohort' as const });

    await waitFor(
      () => {
        expect(result.current.programmeDetail?.loading).toBe(false);
      },
      { timeout: 4000 },
    );
  });

  it('clears loading when two concurrent loads race for the same programme', async () => {
    const { rerender, result } = renderHook(
      ({ step, programmeId }: { step: WizardStep; programmeId: string }) =>
        useCurriculumWizardData({ isOpen: true, currentStep: step, selectedProgrammeId: programmeId }),
      { initialProps: { step: 'cohort' as WizardStep, programmeId: 'prog-1' } },
    );

    // Group also calls loadCohortStepData; flipping between the two steps
    // rapidly starts overlapping loads for the same key.
    rerender({ step: 'group' as const, programmeId: 'prog-1' });
    rerender({ step: 'cohort' as const, programmeId: 'prog-1' });

    await waitFor(
      () => {
        expect(result.current.programmeDetail?.loading).toBe(false);
      },
      { timeout: 4000 },
    );
  });

  it('clears loading when the cache-warm guard short-circuits the fetch', async () => {
    const { result } = renderHook(() =>
      useCurriculumWizardData({ isOpen: true, currentStep: 'cohort', selectedProgrammeId: 'prog-1' }),
    );

    await waitFor(() => {
      expect(result.current.programmeDetail?.loading).toBe(false);
    });

    // A second mount inside CACHE_WARM_DURATION_MS makes loadResource return
    // null without calling the fetcher at all.
    const second = renderHook(() =>
      useCurriculumWizardData({ isOpen: true, currentStep: 'cohort', selectedProgrammeId: 'prog-1' }),
    );

    await waitFor(
      () => {
        expect(second.result.current.programmeDetail?.loading).toBe(false);
      },
      { timeout: 4000 },
    );
  });

  it('reports an error rather than loading forever when the detail fetch fails', async () => {
    vi.mocked(fetchCurriculumProgrammeDetail).mockRejectedValue(new Error('boom'));

    const { result } = renderHook(() =>
      useCurriculumWizardData({ isOpen: true, currentStep: 'cohort', selectedProgrammeId: 'prog-err' }),
    );

    await waitFor(
      () => {
        expect(result.current.programmeDetail?.loading).toBe(false);
      },
      { timeout: 8000 },
    );
    expect(result.current.programmeDetail?.error).toBeTruthy();
  });
});
