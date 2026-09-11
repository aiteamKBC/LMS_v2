/**
 * The apprenticeship journey names the learner's own modules.
 *
 * The track used to label every node "Module 1", "Module 2"… from its array
 * position, so a learner could not tell which of their 34 modules a node stood
 * for, and every learner's journey looked identical. The names are in the data
 * the page already holds -- the card below the track was reading them -- so
 * only the label was throwing them away.
 *
 * Also pins the two progress figures apart. They measure different things and
 * legitimately disagree: `overallPct` is how much CONTENT is done, while the
 * page's module counter is how many modules are FINISHED. A module at 99%
 * contributes ~99 to the first and 0 to the second, which is exactly why both
 * were confusing under one "Overall progress" heading.
 */
import { describe, expect, it } from 'vitest';
import { buildStations } from '@/components/feature/RealLearningJourneyView';
import type { JourneyModule } from '@/utils/learnerJourney';

// A video component is "trackable" only with a real id and a URL, and is
// complete only when its id is in the learner's completed set -- not a flag on
// the component. Mirroring that here keeps the test honest about the contract.
function componentOf(componentId: string) {
  return {
    componentId,
    title: componentId,
    expectedOtjh: 1,
    isQuiz: false,
    quizMeta: null,
    moduleId: 'MOD-1',
    weekId: 'WEEK-1',
    type: 'video',
    videoUrl: 'https://example.test/video.mp4',
  } as unknown as JourneyModule['weeks'][number]['components'][number];
}

/** Stands in for the learner record `buildStations` reads completions from. */
function realWith(completedIds: string[]) {
  // completedComponentIds reads videoProgress/componentProgress, so a
  // completion has to arrive the way the real payload delivers it.
  return {
    videoProgress: completedIds.map(id => ({ componentId: id, kind: 'video', passed: true })),
    componentProgress: [],
  } as never;
}

let seq = 0;
function moduleOf(name: string, done: number, total: number): { module: JourneyModule; completed: string[] } {
  const ids = Array.from({ length: total }, () => `COMP-${++seq}`);
  return {
    module: {
      module: name,
      weeks: [{ week: 'Week 1', otjh: 0, moduleId: 'MOD-1', weekId: 'WEEK-1', components: ids.map(componentOf) }],
    } as unknown as JourneyModule,
    completed: ids.slice(0, done),
  };
}

/** Build a journey plus the completed-id list that goes with it. */
function journeyOf(...mods: { module: JourneyModule; completed: string[] }[]) {
  return { journey: mods.map(m => m.module), real: realWith(mods.flatMap(m => m.completed)) };
}

describe('journey stations carry the real module names', () => {
  it('keeps each module title rather than its position', () => {
    const { journey, real } = journeyOf(
      moduleOf('Strategic Financial Management - Level 7', 0, 2),
      moduleOf('ITIL 4 Foundation Certification Training', 0, 2),
    );

    const { stations } = buildStations(journey, real);

    expect(stations.map(s => s.module.module)).toEqual([
      'Strategic Financial Management - Level 7',
      'ITIL 4 Foundation Certification Training',
    ]);
  });

  it('gives every station an index that still orders the track', () => {
    // The index is still needed for ordering and for the fallback label on a
    // module whose title is somehow blank.
    const { journey, real } = journeyOf(moduleOf('A', 0, 1), moduleOf('B', 0, 1), moduleOf('C', 0, 1));

    const { stations } = buildStations(journey, real);

    expect(stations.map(s => s.index)).toEqual([0, 1, 2]);
  });
});

describe('the two progress measures are distinct', () => {
  it('counts content, not modules, in overallPct', () => {
    // 9 of 10 components done across two modules, but NEITHER module finished.
    const { journey, real } = journeyOf(moduleOf('One', 5, 5), moduleOf('Two', 4, 5));

    const { stations, overallPct } = buildStations(journey, real);
    const completedModules = stations.filter(s => s.status === 'completed').length;

    expect(overallPct).toBe(90);
    // Module-count progress is far lower on the same data -- which is the
    // disagreement the banner now labels instead of hiding.
    expect(completedModules).toBe(1);
    expect(Math.round((completedModules / stations.length) * 100)).toBe(50);
  });

  it('marks a module complete only when all its content is done', () => {
    const { journey, real } = journeyOf(moduleOf('Nearly there', 99, 100));

    const { stations } = buildStations(journey, real);

    expect(stations[0].pct).toBe(99);
    expect(stations[0].status).not.toBe('completed');
  });

  it('reports a module with nothing trackable as null rather than zero', () => {
    const { journey, real } = journeyOf(moduleOf('Empty', 0, 0));

    const { stations } = buildStations(journey, real);

    expect(stations[0].pct).toBeNull();
  });
});
