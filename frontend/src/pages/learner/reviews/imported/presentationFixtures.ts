/** Synthetic examples for component tests and isolated visual verification. */
export const progressExample = [
  { completedCount: 107, current: 99, max: 169, progressType: 2, requiredCount: 0, target: 117, targetCount: 117, totalCount: 169, title: 'Learning plan progress' },
  { current: 86.6357, max: 100, minTarget: 88.6248, progressType: 4, submitted: 86.6357, target: 88.6248, title: 'Example apprenticeship standard' },
  { completedTime: 57394, current: 57394, forecastTime: 78094, minimumRequiredTime: 50249.67, plannedHours: 867, progressType: 6, title: 'Off-the-job hours progress' },
  { current: 43.85, currentDate: '2026-09-17T16:41:45', expectedEndDate: '2028-04-17T00:00:00', plannedEndDate: '2027-10-17T00:00:00', startDate: '2024-10-18T00:00:00', progressType: 7 },
];

export const skillsExample = {
  competency: { id: 999, name: 'Example professional standard', isAssessed: true, readOnly: true, maxCharacteristicLevel: 5 },
  characteristics: [
    { id: 123, competenceId: 999, name: 'Plan and communicate work', notes: 'Clear progress this term.', actions: ['Practise presenting'],
      assessedLevel: { characteristicId: 123, characteristicsLevelId: 456, level: 3, shortDescription: 'Works with guidance', color: 'red' },
      assessments: [{ assessmentType: 'Self', completedDate: '2026-07-13T13:40:00', characteristicsLevelId: 456 }],
      levels: [{ level: 1, shortDescription: 'Beginning' }, { level: 3, shortDescription: 'Works with guidance' }] },
    { id: 124, name: 'Manage uncertainty', assessedLevel: null, assessments: [], levels: [], notes: null, actions: [] },
  ],
};
