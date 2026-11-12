/** Presentation fixtures only. These records are never persisted or sent to HR. */
export const DEMO_KSBS = [
  ...Array.from({ length: 31 }, (_, i) => `K${i + 1}`),
  ...Array.from({ length: 26 }, (_, i) => `S${i + 1}`),
  ...Array.from({ length: 5 }, (_, i) => `B${i + 1}`),
];

export const DEMO_PROGRAMME = {
  name: 'Associate Project Manager',
  reference: 'KBC · HR integration demonstration',
  plannedHours: 850,
  ksbCodes: DEMO_KSBS,
};

// An illustrative training plan, not an official allocation of the standard's KSBs.
export const DEMO_MODULES = [
  { id: 'demo-m1', name: 'Professional Practice & Foundations', plannedHours: 150, ksbCodes: DEMO_KSBS.slice(0, 12) },
  { id: 'demo-m2', name: 'Business Cases & Stakeholders', plannedHours: 200, ksbCodes: DEMO_KSBS.slice(12, 27) },
  { id: 'demo-m3', name: 'Project Planning & Delivery', plannedHours: 250, ksbCodes: DEMO_KSBS.slice(27, 45) },
  { id: 'demo-m4', name: 'Governance & Professional Portfolio', plannedHours: 250, ksbCodes: DEMO_KSBS.slice(45) },
];

export type DemoStatus = 'Completed' | 'On track' | 'At risk';
export interface DemoLearner {
  id: string;
  name: string;
  initials: string;
  email: string;
  status: DemoStatus;
  dueLabel: string;
  dueDate: string;
  actualHoursByModule: number[];
  progressByModule: number[];
  achievedKsbCodes: string[];
}

export const DEMO_LEARNERS: DemoLearner[] = [
  {
    id: 'demo-01', name: 'Demo Learner 01', initials: 'D1', email: 'learner01@example.invalid',
    status: 'Completed', dueLabel: 'Completed · 12 Nov 2026', dueDate: '2026-11-12',
    actualHoursByModule: [160, 210, 265, 265], progressByModule: [100, 100, 100, 100],
    achievedKsbCodes: [...DEMO_KSBS],
  },
  {
    id: 'demo-02', name: 'Demo Learner 02', initials: 'D2', email: 'learner02@example.invalid',
    status: 'On track', dueLabel: 'Due · 10 Dec 2026', dueDate: '2026-12-10',
    actualHoursByModule: [150, 200, 240, 220], progressByModule: [100, 100, 100, 66],
    achievedKsbCodes: DEMO_KSBS.filter(code => !['K28', 'K29', 'K30', 'K31', 'S23', 'S24', 'S25', 'S26'].includes(code)),
  },
  {
    id: 'demo-03', name: 'Demo Learner 03', initials: 'D3', email: 'learner03@example.invalid',
    status: 'At risk', dueLabel: 'Overdue · 3 days at demo date', dueDate: '2026-11-09',
    actualHoursByModule: [110, 100, 90, 60], progressByModule: [80, 50, 14, 0],
    achievedKsbCodes: DEMO_KSBS.filter(code => /^K([1-9]|10)$/.test(code) || /^S[1-7]$/.test(code) || ['B1', 'B2'].includes(code)),
  },
];

export function actualHours(learner: DemoLearner): number {
  return learner.actualHoursByModule.reduce((sum, hours) => sum + hours, 0);
}

/** Learning completion is separate from logged hours and KSB achievement. */
export function learningProgress(learner: DemoLearner): number {
  return Math.round(DEMO_MODULES.reduce((sum, module, index) => (
    sum + module.plannedHours * learner.progressByModule[index]
  ), 0) / DEMO_PROGRAMME.plannedHours);
}

export function moduleAchievement(learner: DemoLearner, moduleIndex: number): number {
  return DEMO_MODULES[moduleIndex].ksbCodes.filter(code => learner.achievedKsbCodes.includes(code)).length;
}

export function trainingDraft(learner: DemoLearner) {
  return {
    demo: true,
    sendable: false,
    reason: 'Preview only. Requires an authenticated connection and verified employee / training-type mapping.',
    employee_id: null,
    company_training_type_id: null,
    name: `${DEMO_PROGRAMME.name} · DEMO`,
    notes: [
      'SYNTHETIC DEMONSTRATION — not a real training record.',
      `Programme: ${DEMO_PROGRAMME.plannedHours}h planned / ${actualHours(learner)}h actual.`,
      `Learning completion: ${learningProgress(learner)}%. KSBs achieved: ${learner.achievedKsbCodes.length}/${DEMO_KSBS.length}.`,
      ...DEMO_MODULES.map((module, i) => (
        `${module.name}: ${module.plannedHours}h planned / ${learner.actualHoursByModule[i]}h actual; learning ${learner.progressByModule[i]}%; KSBs ${moduleAchievement(learner, i)}/${module.ksbCodes.length}.`
      )),
      'Certificate: sample only; no issued certificate or verification URL.',
    ].join('\n'),
  };
}
