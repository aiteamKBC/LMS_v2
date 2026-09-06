import { describe, expect, it } from 'vitest';

import { DEMO_PROGRAMMES, demoProgrammeFor, materialForModuleId } from '../demoProgrammeMaterials';

describe('inspection demo programme materials', () => {
  it('keeps one canonical programme per demo account', () => {
    expect(DEMO_PROGRAMMES.map((programme) => programme.programmeName)).toEqual([
      'Marketing Executive Level 4',
      'Marketing Manager Level 6',
      'Project Controls Professional Level 6',
    ]);
  });

  it('shows exactly the requested material counts while retaining PCP merged modules', () => {
    expect(DEMO_PROGRAMMES.map((programme) => programme.materials.length)).toEqual([3, 4, 5]);
    expect(DEMO_PROGRAMMES.find((programme) => programme.accountLabel === 'PCP')
      ?.materials.map((material) => material.moduleIds.length)).toEqual([1, 2, 1, 2, 2]);
    const me = DEMO_PROGRAMMES.find((programme) => programme.accountLabel === 'ME')!;
    expect(materialForModuleId(me, 'MOD-2026082273BF1B44335F')?.name).toBe('Marketing Technology');
  });

  it('resolves the dedicated emails and all learners on the three programmes', () => {
    expect(demoProgrammeFor('LEARNER-PCP@LEARNER.LOCAL')?.accountLabel).toBe('PCP');
    expect(demoProgrammeFor('student@example.com', 'ME')?.accountLabel).toBe('ME');
    expect(demoProgrammeFor('student@example.com', 'Marketing Manager')?.accountLabel).toBe('MM');
    expect(demoProgrammeFor('student@example.com', 'Level 6 Project Controls Professional')?.accountLabel).toBe('PCP');
    expect(demoProgrammeFor('eng.mohamedelmasry68@gmail.com', 'MBA')).toBeNull();
  });
});
