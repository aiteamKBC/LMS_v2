import { describe, it, expect } from 'vitest';
import { buildKsbProgress, completedComponentIds, ksbParentCode, ksbTypeCode, progressCountsAsAchieved, recordedKsbEvidenceCodes } from './learnerJourney';
import fixture from './ksbProgress.fixture.json';

/* Real learner payload (commercial/2): 62 programme KSBs (31 K / 26 S / 5 B),
   67 components of which 10 carry authored KSB mappings, plus one legacy quiz
   attempt that lists all 31 Knowledge codes at once. */

const real = fixture as never as Parameters<typeof completedComponentIds>[0] & {
  ksbs: { code: string; type?: string; description?: string }[];
  components: never[];
};

function build() {
  return buildKsbProgress({
    ksbs: real.ksbs,
    components: real.components,
    completedComponentIds: completedComponentIds(real),
  });
}

describe('ksbParentCode', () => {
  it('rolls sub-codes up to the assessed parent KSB', () => {
    expect(ksbParentCode('K3.1')).toBe('K3');
    expect(ksbParentCode('S1.2')).toBe('S1');
    expect(ksbParentCode('B2.2')).toBe('B2');
  });
  it('leaves plain codes untouched and normalises case/space', () => {
    expect(ksbParentCode('K3')).toBe('K3');
    expect(ksbParentCode(' s11 ')).toBe('S11');
  });
});

describe('ksbTypeCode', () => {
  it('normalises full API labels to the category keys used by the UI', () => {
    expect(ksbTypeCode('Knowledge')).toBe('K');
    expect(ksbTypeCode('Skills')).toBe('S');
    expect(ksbTypeCode('Behaviours')).toBe('B');
    expect(ksbTypeCode('', 'K12')).toBe('K');
  });
});

describe('recordedKsbEvidenceCodes', () => {
  it('keeps completed activity evidence and ignores failed quiz KSBs', () => {
    const codes = recordedKsbEvidenceCodes({
      quizAttempts: [
        { passed: false, ksbs: ['K1'] },
        { passed: true, ksbs: ['K2'] },
      ],
      videoProgress: [{ componentId: 'video-1', ksbs: ['S1.2'] }],
      componentProgress: [{ componentId: 'component-1', ksbs: ['B3.1'] }],
    } as never);

    expect(Array.from(codes).sort()).toEqual(['B3', 'K2', 'S1']);
  });

  /* The rule is the outcome, not the kind. A component or video recorded as
     not passed carries a real componentId and real authored KSB codes, so a
     check that only special-cases quizzes credits it in full. Mirrors backend
     learner_api/progress_rules.py. */
  it('ignores a failed component or video even with a valid componentId', () => {
    const codes = recordedKsbEvidenceCodes({
      quizAttempts: [],
      videoProgress: [
        { kind: 'video', componentId: 'video-1', passed: false, ksbs: ['S1.2'] },
        { kind: 'video', componentId: 'video-2', ksbs: ['S4'] },
      ],
      componentProgress: [
        { kind: 'component', componentId: 'component-1', passed: false, ksbs: ['B3.1'] },
        { kind: 'component', componentId: 'component-2', passed: true, ksbs: ['K7'] },
      ],
    } as never);

    expect(Array.from(codes).sort()).toEqual(['K7', 'S4']);
  });

  it('ignores a quiz attempt with no recorded outcome', () => {
    const codes = recordedKsbEvidenceCodes({
      quizAttempts: [{ ksbs: ['K1'] }],
      videoProgress: [],
      componentProgress: [],
    } as never);

    expect(Array.from(codes)).toEqual([]);
  });
});

describe('progressCountsAsAchieved', () => {
  it('treats an ungraded completion as achieved', () => {
    expect(progressCountsAsAchieved({ kind: 'component' })).toBe(true);
    expect(progressCountsAsAchieved({ kind: 'video', passed: null })).toBe(true);
  });
  it('never counts an explicit failure, whatever the kind', () => {
    for (const kind of ['component', 'video', 'quiz', 'live_session', '']) {
      expect(progressCountsAsAchieved({ kind, passed: false })).toBe(false);
    }
  });
  it('requires an explicit pass for a graded kind', () => {
    expect(progressCountsAsAchieved({ kind: 'quiz', passed: true })).toBe(true);
    expect(progressCountsAsAchieved({ kind: 'quiz' })).toBe(false);
    expect(progressCountsAsAchieved({ kind: 'QUIZ' })).toBe(false);
  });
});

describe('completedComponentIds', () => {
  it('excludes a failed attempt so it cannot mark a component delivered', () => {
    const ids = completedComponentIds({
      videoProgress: [
        { kind: 'video', componentId: 'video-1', passed: false },
        { kind: 'video', componentId: 'video-2' },
      ],
      componentProgress: [
        { kind: 'component', componentId: 'component-1', passed: false },
        { kind: 'component', componentId: 'component-2' },
      ],
    } as never);

    expect(Array.from(ids).sort()).toEqual(['component-2', 'video-2']);
  });
});

describe('buildKsbProgress against the real learner payload', () => {
  const progress = build();
  const by = (code: string) => progress.find((k) => k.code === code)!;

  it('covers every programme KSB exactly once', () => {
    expect(progress).toHaveLength(62);
    expect(new Set(progress.map((k) => k.code)).size).toBe(62);
  });

  it('marks the 49 KSBs with no mapped component as not-started, never 0%-of-nothing', () => {
    const unmapped = progress.filter((k) => k.contributors.length === 0);
    expect(unmapped).toHaveLength(49);
    for (const k of unmapped) {
      expect(k.status).toBe('not-started');
      expect(k.availableWeight).toBe(0);
      expect(k.contributors).toHaveLength(0);
      expect(Number.isFinite(k.pct)).toBe(true);   // no NaN from /0
      expect(k.pct).toBe(0);
    }
  });

  it('derives the expected weights for the 13 mapped KSBs', () => {
    // Verified independently against curriculum.ksb_mappings.
    const expected: Record<string, [earned: number, available: number]> = {
      K1: [0, 220], K2: [0, 120], K3: [95, 145], K4: [0, 50], K8: [0, 50],
      S1: [30, 80], S2: [50, 50], S5: [0, 50], S11: [0, 30],
      B2: [50, 70], B3: [50, 70], B4: [0, 40], B5: [0, 40],
    };
    const mapped = progress.filter((k) => k.contributors.length > 0);
    expect(mapped.map((k) => k.code).sort()).toEqual(Object.keys(expected).sort());
    for (const [code, [earned, available]] of Object.entries(expected)) {
      expect(`${code}:${by(code).earnedWeight}/${by(code).availableWeight}`).toBe(`${code}:${earned}/${available}`);
    }
  });

  it('ignores the legacy bulk quiz attempt that lists all 31 Knowledge codes', () => {
    // That record carries no authored weight, so it must not evidence anything.
    // Only K3 has earned weight among Knowledge — from real component completions.
    const earnedK = progress.filter((k) => k.type === 'K' && k.earnedWeight > 0).map((k) => k.code);
    expect(earnedK).toEqual(['K3']);
    // The old binary view reported 31/31 Knowledge = 100%. Prove that is gone.
    expect(progress.filter((k) => k.type === 'K' && k.status === 'complete')).toHaveLength(0);
  });

  it('computes percentages against available weight, clamped to 0..100', () => {
    expect(by('S2').pct).toBe(100);        // 50/50  -> fully evidenced
    expect(by('K3').pct).toBe(66);         // 95/145
    expect(by('B2').pct).toBe(71);         // 50/70
    expect(by('S1').pct).toBe(38);         // 30/80
    for (const k of progress) {
      expect(k.pct).toBeGreaterThanOrEqual(0);
      expect(k.pct).toBeLessThanOrEqual(100);
    }
  });

  it('assigns status from earned vs available weight', () => {
    expect(by('S2').status).toBe('complete');       // all contributing activities done
    expect(by('K3').status).toBe('in-progress');    // some done
    expect(by('K1').status).toBe('not-started');    // mapped but nothing done
    expect(by('S3').status).toBe('not-started');    // no component maps it yet
  });

  it('keeps remainingWeight consistent and never negative', () => {
    for (const k of progress) {
      expect(k.remainingWeight).toBe(Math.max(0, k.availableWeight - k.earnedWeight));
      expect(k.remainingWeight).toBeGreaterThanOrEqual(0);
    }
    expect(by('K3').remainingWeight).toBe(50);
  });

  it('names the activities that fulfil a KSB, with done state and weight', () => {
    const k3 = by('K3');
    expect(k3.totalCount).toBeGreaterThan(0);
    expect(k3.doneCount).toBeGreaterThan(0);
    expect(k3.doneCount).toBeLessThan(k3.totalCount);
    // Contributor weights must reconcile exactly with the totals shown.
    expect(k3.contributors.reduce((s, c) => s + c.weight, 0)).toBe(k3.availableWeight);
    expect(k3.contributors.filter((c) => c.done).reduce((s, c) => s + c.weight, 0)).toBe(k3.earnedWeight);
    for (const c of k3.contributors) {
      expect(c.componentId).toBeTruthy();
      expect(c.title).toBeTruthy();
      expect(c.weight).toBeGreaterThan(0);
    }
  });

  it('counts a component completed more than once only once', () => {
    const dup = { ...real, componentProgress: [
      ...(real as { componentProgress?: { componentId: string }[] }).componentProgress || [],
      // same podcast completed a second time
      { componentId: 'COMP-20260721161358049897' },
    ] } as Parameters<typeof completedComponentIds>[0];
    const again = buildKsbProgress({
      ksbs: real.ksbs, components: real.components,
      completedComponentIds: completedComponentIds(dup),
    });
    expect(again.find((k) => k.code === 'K3')!.earnedWeight).toBe(by('K3').earnedWeight);
  });

  it('never lets earned weight exceed available weight', () => {
    for (const k of progress) expect(k.earnedWeight).toBeLessThanOrEqual(k.availableWeight);
  });

  it('preserves recorded KSB evidence when curriculum component ids have drifted', () => {
    const [recorded] = buildKsbProgress({
      ksbs: [{ code: 'K1' }],
      components: [{ componentId: 'new-component', ksbMappings: [{ code: 'K1', weight: 40 }] }],
      completedComponentIds: ['old-component'],
      evidencedKsbCodes: ['K1'],
    });

    expect(recorded.status).toBe('complete');
    expect(recorded.earnedWeight).toBe(40);
    expect(recorded.availableWeight).toBe(40);
    expect(recorded.pct).toBe(100);
  });
});
