import { describe, expect, it } from 'vitest';
import { replaceLiveSessionLinksInWeeks, type ModuleCatalogueItem } from '../moduleAuthoringData';

function moduleFixture(): ModuleCatalogueItem {
  const component = (id: string, type: 'live-session' | 'video', settings: Record<string, string> = {}) => ({
    id,
    moduleId: 'MOD-1',
    weekId: id.startsWith('A') ? 'WEEK-A' : 'WEEK-B',
    type,
    title: id,
    description: '',
    expectedOtjh: 1,
    points: 1,
    reflectionRequired: false,
    reflectionQuestion: '',
    workplaceEvidenceRequired: false,
    tutorValidationRequired: false,
    coachValidationRequired: true,
    ksbMappings: [],
    settings,
  });
  return {
    id: 'MOD-1', catalogueId: 'MOD-1', programmeId: 'PROG-1', programmeName: 'Programme',
    title: 'Module', description: '', status: 'draft', weeks: 2, totalOtjh: 0,
    ksbCount: 0, lessonCount: 3, quizCount: 0, qualityScore: 0, moduleKsbMappings: [],
    completionCriteria: {
      quizzesCompletedRequired: false, checkpointsCompletedRequired: false,
      averageScoreRequiredEnabled: false, averageScoreRequired: 70,
      totalScoreRequiredEnabled: false, totalScoreRequired: 100, additionalNotes: '',
    },
    advancedDetails: { intent: '', learnerBenefit: '', employerBenefit: '', sequencePurpose: '' },
    background: '', epaRequirements: [], qualificationOutcomes: [],
    weekStructure: [
      { id: 'WEEK-A', moduleId: 'MOD-1', weekNumber: 1, title: 'A', summary: '', learningOutcomes: [], components: [
        component('A-LIVE', 'live-session', { liveSessionUrl: 'https://old.example/a', teamsMeetingUrl: 'https://old.example/a', teamsLiveSessionId: 'LIVE-A' }),
        component('A-VIDEO', 'video', { videoUrl: 'https://video.example/a' }),
      ], ksbMappings: [] },
      { id: 'WEEK-B', moduleId: 'MOD-1', weekNumber: 2, title: 'B', summary: '', learningOutcomes: [], components: [
        component('B-LIVE', 'live-session', { liveSessionUrl: 'https://old.example/b', teamsMeetingUrl: 'https://old.example/b', teamsLiveSessionId: 'LIVE-B' }),
        component('B-EXTRA', 'live-session', { liveSessionUrl: 'https://old.example/extra', teamsMeetingUrl: 'https://old.example/extra', extraTeamsMeetingUrl: 'https://old.example/extra' }),
      ], ksbMappings: [] },
    ],
  };
}

describe('replaceLiveSessionLinksInWeeks', () => {
  it('updates only live sessions in selected weeks and preserves Teams identity', () => {
    const source = moduleFixture();
    const next = replaceLiveSessionLinksInWeeks(source, ['WEEK-A'], ' https://new.example/join ');

    expect(next).not.toBe(source);
    expect(next.weekStructure[0].components[0].settings).toMatchObject({
      liveSessionUrl: 'https://new.example/join',
      teamsMeetingUrl: 'https://new.example/join',
      liveSessionLinkOverride: 'https://new.example/join',
      teamsLiveSessionId: 'LIVE-A',
    });
    expect(next.weekStructure[0].components[1]).toBe(source.weekStructure[0].components[1]);
    expect(next.weekStructure[1]).toBe(source.weekStructure[1]);
  });

  it('leaves additional one-off meeting links untouched', () => {
    const source = moduleFixture();
    const next = replaceLiveSessionLinksInWeeks(source, ['WEEK-B'], 'https://new.example/join');

    expect(next.weekStructure[1].components[0].settings.liveSessionUrl).toBe('https://new.example/join');
    expect(next.weekStructure[1].components[1]).toBe(source.weekStructure[1].components[1]);
    expect(next.weekStructure[1].components[1].settings.extraTeamsMeetingUrl).toBe('https://old.example/extra');
  });
});
