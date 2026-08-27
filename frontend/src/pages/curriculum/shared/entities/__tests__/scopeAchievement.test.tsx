import { StrictMode } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { CurriculumScopeLearnerKsbImpactResponse } from '@/lib/curriculumApi';

/**
 * The achievement panel is the same read at every level of Programme -> Cohort ->
 * Group -> Module, so these tests pin the things that must not drift as it is
 * dropped into another workspace:
 *
 *  - it reports the scope it was asked for, not the programme;
 *  - achieved is shown against what a learner is actually assigned, and the
 *    panel says where that denominator came from;
 *  - a KSB required-but-taught-nowhere and a KSB a learner earned that this
 *    scope never authored are two different rows, not one grey one;
 *  - achievement that happened elsewhere is reported rather than hidden.
 */

const fetchImpact = vi.fn();

vi.mock('@/lib/curriculumApi', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/curriculumApi')>()),
  fetchCurriculumScopeLearnerKsbImpact: (...args: unknown[]) => fetchImpact(...args),
}));

function impact(overrides: Partial<CurriculumScopeLearnerKsbImpactResponse> = {}) {
  return {
    scope: 'cohort',
    identifier: 'COHORT-1',
    lineage: {
      scope: 'cohort',
      identifier: 'COHORT-1',
      found: true,
      programmeId: 'PROG-1',
      programmeName: 'Data Analyst',
      cohortId: 'COHORT-1',
      cohortName: 'Sept 2026',
      groupId: '',
      groupName: '',
      moduleCatalogueId: '',
      moduleTitle: '',
      weekId: '',
      weekTitle: '',
      componentId: '',
      componentTitle: '',
      placementBasis: 'cohort',
    },
    placementBasis: 'cohort',
    structure: { moduleCount: 2, weekCount: 4, componentCount: 6, ksbMappingCount: 5, groupCount: 2 },
    assignedLearnerCount: 2,
    assignedLearners: [],
    programmeCoverage: {} as CurriculumScopeLearnerKsbImpactResponse['coverage'],
    coverage: {} as CurriculumScopeLearnerKsbImpactResponse['coverage'],
    otjhAchievement: {
      componentCount: 6,
      learnerCount: 2,
      authoredTotal: 20,
      plannedPerLearner: 10,
      plannedTotal: 20,
      achievedTotal: 12,
      declaredTotal: 7,
      creditedFromExpectedTotal: 5,
      achievedPerLearnerAverage: 6,
      progressPercentage: 60,
      completedActivityCount: 3,
      reflectionCount: 2,
      learners: [
        {
          learnerId: 19, learnerName: 'Amelia Hart', email: 'amelia@example.com',
          cohort: 'Sept 2026', group: 'Group A', plannedOtjh: 10, plannedBasis: 'group',
          achievedOtjh: 9, declaredOtjh: 7, completedActivityCount: 2, reflectionCount: 2,
          progressPercentage: 90,
        },
        {
          learnerId: 20, learnerName: 'Ben Carter', email: 'ben@example.com',
          cohort: 'Sept 2026', group: 'Group B', plannedOtjh: 10, plannedBasis: 'none',
          achievedOtjh: 3, declaredOtjh: 0, completedActivityCount: 1, reflectionCount: 0,
          progressPercentage: 30,
        },
      ],
      sources: {},
    },
    ksbAchievement: {
      learnerCount: 2,
      requiredCount: 3,
      ksbCount: 4,
      mappedCount: 2,
      unmappedCount: 1,
      unplannedCount: 1,
      startedCount: 1,
      notStartedCount: 3,
      plannedWeightTotal: 70,
      expectedWeightTotal: 140,
      achievedWeightTotal: 60,
      cappedAchievedWeightTotal: 50,
      declaredReflectionWeightTotal: 10,
      progressPercentage: 36,
      learnersWithAchievement: 1,
      rows: [
        {
          code: 'K1', title: 'Know one', ksbType: 'knowledge', sourceType: 'standard',
          sourceId: 'ST0118', sourceLabel: 'ST0118', plannedWeight: 50,
          expectedWeightTotal: 100, achievedWeightTotal: 60, cappedAchievedWeightTotal: 50,
          declaredReflectionWeightTotal: 10, learnerCount: 2, learnersAchievedCount: 1,
          learnersCompleteCount: 1, achievementPercentage: 50, status: 'in_progress',
        },
        {
          code: 'K9', title: 'Never taught', ksbType: 'knowledge', sourceType: 'standard',
          sourceId: 'ST0118', sourceLabel: 'ST0118', plannedWeight: 0,
          expectedWeightTotal: 0, achievedWeightTotal: 0, cappedAchievedWeightTotal: 0,
          declaredReflectionWeightTotal: 0, learnerCount: 0, learnersAchievedCount: 0,
          learnersCompleteCount: 0, achievementPercentage: 0, status: 'unmapped',
        },
        {
          code: 'B7', title: 'B7', ksbType: 'behaviour', sourceType: '', sourceId: '',
          sourceLabel: '', plannedWeight: 0, expectedWeightTotal: 0, achievedWeightTotal: 5,
          cappedAchievedWeightTotal: 5, declaredReflectionWeightTotal: 0, learnerCount: 0,
          learnersAchievedCount: 1, learnersCompleteCount: 1, achievementPercentage: 0,
          status: 'unplanned',
        },
      ],
      sources: {},
    },
    learnerKsbConsumption: [
      {
        learnerId: 19, learnerName: 'Amelia Hart', email: 'amelia@example.com',
        cohort: 'Sept 2026', group: 'Group A', consumedWeightTotal: 60,
        expectedWeightTotal: 100, cappedConsumedWeightTotal: 50, progressPercentage: 50,
        ksbs: [{
          code: 'K1', expectedWeight: 50, consumedWeight: 60, cappedConsumedWeight: 50,
          progressPercentage: 100, rawProgressPercentage: 120, status: 'complete',
        }],
      },
    ],
    learnerActivities: [
      {
        progressId: 1, learnerId: 19, kind: 'assignment', componentId: 'COMP-1',
        componentTitle: 'Intro assignment', componentType: 'assignment',
        module: 'Data Foundations', week: 'Week 1', submittedAt: '',
        progressStatus: 'achieved', passed: true, countsTowardAchievement: true,
        expectedOtjh: 2, expectedOtjhSource: 'curriculum_component', actualOtjh: 3,
        actualOtjhSource: 'learning_reflection_submissions',
        ksbSnapshot: [{ code: 'K1', weight: 50, countsTowardAchievement: true }],
        achievedKsbWeightTotal: 50, declaredReflectionKsbs: [],
        declaredReflectionKsbWeightTotal: 0, reflection: null, evidence: [], evidenceCount: 0,
      },
    ],
    learnerActivityCount: 1,
    consumptionSources: {
      progress: [],
      learningReflectionSubmissions: [],
      outOfScopeProgress: [{}, {}],
    },
    ...overrides,
  } as unknown as CurriculumScopeLearnerKsbImpactResponse;
}

async function renderPanel(scope: 'cohort' | 'module' = 'cohort', payload = impact()) {
  fetchImpact.mockReset();
  fetchImpact.mockResolvedValue(payload);
  const { ScopeAchievementPanel } = await import('../scopeAchievement');
  const result = render(
    <ScopeAchievementPanel scope={scope} identifier="COHORT-1" learnerStatus="all" />,
  );
  await screen.findByText('Learners assigned');
  return result;
}

describe('ScopeAchievementPanel', () => {
  it('asks for the scope it was given, not the programme', async () => {
    await renderPanel('module');

    expect(fetchImpact).toHaveBeenCalledWith(
      'module', 'COHORT-1', { learnerStatus: 'all' }, expect.anything(),
    );
  });

  it('shows achieved OTJH against what the learners are assigned, and names the authored total separately', async () => {
    await renderPanel();

    // 12h of the 20h its learners are between them assigned.
    expect(screen.getByText('12h')).toBeInTheDocument();
    expect(screen.getByText('of 20h')).toBeInTheDocument();
    // The scope's own authored content is a different fact and is labelled as one.
    expect(screen.getByText(/10h per learner · 20h authored here/)).toBeInTheDocument();
  });

  it('splits declared hours from hours credited by component expectation', async () => {
    await renderPanel();

    expect(screen.getByText(/declared hours where a reflection exists\s*\(7h\)/)).toBeInTheDocument();
    expect(screen.getByText(/completed without one \(5h\)/)).toBeInTheDocument();
  });

  it('says out loud that a multi-group scope measures each learner against their own group', async () => {
    await renderPanel();

    expect(screen.getByText(/delivered by 2 groups/)).toBeInTheDocument();
  });

  it('reports achievement that belongs to another part of the programme', async () => {
    await renderPanel();

    expect(screen.getByText(/2 completed activities belong to another part of this programme/)).toBeInTheDocument();
  });

  it('distinguishes a KSB taught nowhere from one a learner earned that was never planned', async () => {
    await renderPanel();

    const unmapped = screen.getByTitle('Required by the KSB source but taught nowhere in this scope');
    const unplanned = screen.getByTitle('A learner has consumed this KSB, but this scope never authored it');

    expect(unmapped).toBeInTheDocument();
    expect(unplanned).toBeInTheDocument();
    expect(unmapped).not.toBe(unplanned);
  });

  it('flags a learner whose group is delivered nothing in this scope', async () => {
    await renderPanel();
    await userEvent.click(screen.getByRole('button', { name: /Learners/ }));

    expect(screen.getByTitle("No module in this scope is delivered to this learner's group")).toBeInTheDocument();
  });

  it('drills from a KSB to the learners who earned it', async () => {
    await renderPanel();

    await userEvent.click(screen.getByRole('button', { name: /K1/ }));
    await userEvent.click(screen.getByRole('button', { name: /^Learners$/ }));

    // Only the learner with recorded K1 weight survives the filter.
    expect(screen.getByText('Amelia Hart')).toBeInTheDocument();
    expect(screen.queryByText('Ben Carter')).not.toBeInTheDocument();
  });

  it('shows the activity behind the numbers with expected and declared hours apart', async () => {
    await renderPanel();
    await userEvent.click(screen.getByRole('button', { name: /Activity/ }));

    const row = screen.getByText('Intro assignment').closest('div');
    expect(row).not.toBeNull();
    expect(within(row!.parentElement!).getByText('2h')).toBeInTheDocument();
    expect(within(row!.parentElement!).getByText('3h')).toBeInTheDocument();
  });

  it('names the learner behind an activity instead of printing their id', async () => {
    await renderPanel();
    await userEvent.click(screen.getByRole('button', { name: /Activity/ }));

    const row = screen.getByText('Intro assignment').closest('div')!;
    expect(within(row).getByText('Amelia Hart')).toBeInTheDocument();
    expect(within(row).queryByText('19')).not.toBeInTheDocument();
  });

  it('keeps what happened to an activity separate from whether it counted', async () => {
    const [activity] = impact().learnerActivities;
    const payload = impact({
      learnerActivities: [
        activity,
        {
          ...activity,
          progressId: 2,
          componentTitle: 'Elsewhere assignment',
          scopeStatus: 'out_of_scope',
        } as unknown as typeof activity,
      ],
      learnerActivityCount: 2,
    });
    await renderPanel('cohort', payload);
    await userEvent.click(screen.getByRole('button', { name: /Activity/ }));

    const inScope = screen.getByText('Intro assignment').closest('div')!;
    expect(within(inScope).getByText('achieved')).toBeInTheDocument();
    expect(within(inScope).getByText('Counted')).toBeInTheDocument();

    // The out-of-scope row still reports its own status: "Elsewhere" is a
    // separate fact now, not a replacement for it.
    const elsewhere = screen.getByText('Elsewhere assignment').closest('div')!;
    expect(within(elsewhere).getByText('achieved')).toBeInTheDocument();
    expect(within(elsewhere).getByText('Elsewhere')).toBeInTheDocument();
  });

  it('marks an activity whose module has been deleted from the catalogue', async () => {
    const [activity] = impact().learnerActivities;
    const payload = impact({
      learnerActivities: [
        { ...activity, module: 'Shift 1', moduleStatus: 'deleted', moduleCatalogueId: 'MOD-1' },
      ],
    });
    await renderPanel('cohort', payload);
    await userEvent.click(screen.getByRole('button', { name: /Activity/ }));

    const row = screen.getByText('Intro assignment').closest('div')!;
    // The name still shows — the learner's work is real — but the row says the
    // module is gone rather than sending the reader to search for it.
    expect(within(row).getByText(/Shift 1/)).toBeInTheDocument();
    expect(within(row).getByText('deleted')).toBeInTheDocument();
  });

  it('loads even though StrictMode aborts the first mount’s read', async () => {
    fetchImpact.mockReset();
    const payload = impact();
    // The real client rejects the caller's promise when its signal aborts, so
    // the discarded first pass settles as a failure. If the panel treats that
    // as "already asked", the second pass never fetches and the spinner never
    // clears.
    fetchImpact.mockImplementation((...args: unknown[]) => {
      const signal = args[3] as AbortSignal | undefined;
      return new Promise((resolve, reject) => {
        signal?.addEventListener('abort', () => {
          const aborted = new Error('Aborted');
          aborted.name = 'AbortError';
          reject(aborted);
        }, { once: true });
        setTimeout(() => resolve(payload), 0);
      });
    });
    const { ScopeAchievementPanel } = await import('../scopeAchievement');
    render(
      <StrictMode>
        <ScopeAchievementPanel scope="cohort" identifier="COHORT-1" learnerStatus="all" />
      </StrictMode>,
    );

    expect(await screen.findByText('Learners assigned')).toBeInTheDocument();
    expect(screen.queryByText(/Loading learner achievement/)).not.toBeInTheDocument();
  });

  it('offers a retry rather than an empty panel when the read fails', async () => {
    fetchImpact.mockReset();
    fetchImpact.mockRejectedValue(new Error('Scope read failed'));
    const { ScopeAchievementPanel } = await import('../scopeAchievement');
    render(<ScopeAchievementPanel scope="cohort" identifier="COHORT-1" />);

    expect(await screen.findByText('Scope read failed')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Retry/ })).toBeInTheDocument();
  });
});
