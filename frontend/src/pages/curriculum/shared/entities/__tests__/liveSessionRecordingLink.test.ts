import { describe, expect, it } from 'vitest';
import type { ModuleComponent, ModuleWeek } from '@/pages/curriculum/module-builder/moduleAuthoringData';
import { cloneComponentToWeek, copyWeekToModule, duplicateWeekInModule, type ModuleCatalogueItem } from '@/pages/curriculum/module-builder/moduleAuthoringData';
import { componentTypes, validateComponentAuthoring } from '@/pages/curriculum/module-builder/componentAuthoringModel';
import { weekPaletteTypes } from '@/pages/curriculum/week-builder/weekTemplateData';
import {
  describeRecordingLink,
  keepRecordingsWithTheirSession,
  linkedLiveSessionOf,
  linkedRecordingsByPlace,
  linkedRecordingsOf,
  moveComponentToWeek,
  movingPartnersOf,
  recordingLinkId,
  recordingLinkTarget,
  relinkCopiedComponents,
  removeComponentFromWeek,
  withLinkedRecordings,
  withRecordingLink,
} from '../liveSessionRecordingLink';

function component(id: string, type: ModuleComponent['type'], weekId = 'W1', settings: ModuleComponent['settings'] = {}): ModuleComponent {
  return {
    id, weekId, type, title: id, description: '', expectedOtjh: 0, points: 0,
    reflectionRequired: false, reflectionQuestion: '', workplaceEvidenceRequired: false,
    tutorValidationRequired: false, coachValidationRequired: true, ksbMappings: [], settings,
  };
}

const live = (id: string, weekId = 'W1', settings: ModuleComponent['settings'] = {}) => component(id, 'live-session', weekId, settings);
const recording = (id: string, link: string, weekId = 'W1', linkModule = '') => component(id, 'recording-placeholder', weekId, {
  linkedLiveSessionComponentId: link, linkedLiveSessionModuleId: linkModule,
});
const week = (id: string, components: ModuleComponent[]): ModuleWeek => ({
  id, moduleId: 'M', weekNumber: Number(id.slice(1)), title: id, summary: '', learningOutcomes: [], ksbMappings: [], components,
});

describe('live session recording link', () => {
  it('is offered in both "Add component" pickers', () => {
    expect(componentTypes.map(item => item.type)).toContain('recording-placeholder');
    expect(weekPaletteTypes.map(item => item.type)).toContain('recording-placeholder');
  });

  it('adds a linked recording right after each new live session, and leaves a picked recording unlinked', () => {
    let n = 0;
    const added = withLinkedRecordings([live('LS'), component('R', 'recording-placeholder')], () => component(`blank-${++n}`, 'recording-placeholder'));
    expect(added.map(item => item.id)).toEqual(['LS', 'blank-1', 'R']);
    expect(recordingLinkId(added[1])).toBe('LS');
    expect(recordingLinkId(added[2])).toBe('');
  });

  it('resolves a link to any week of the module, and never a link into another module', () => {
    const everything = [live('LS', 'W1'), recording('REC', 'LS', 'W5')];
    expect(linkedLiveSessionOf(everything, everything[1])?.id).toBe('LS');
    const elsewhere = recording('X', 'LS', 'W5', 'MOD-B');
    expect(linkedLiveSessionOf(everything, elsewhere)).toBeNull();
    expect(recordingLinkTarget(elsewhere, 'M')).toEqual({ componentId: 'LS', moduleId: 'MOD-B' });
    expect(recordingLinkTarget(recording('Y', 'LS', 'W5', 'M'), 'M')).toEqual({ componentId: 'LS', moduleId: '' });
  });

  it('describes the link on the rail', () => {
    const weeks = [{ id: 'W1', label: 'Week 1', components: [live('LS')] }, { id: 'W5', label: 'Week 5', components: [recording('REC', 'LS', 'W5')] }];
    const context = { moduleId: 'M', weeks, otherModules: [{ id: 'MOD-B', label: 'Module B · Group 2' }] };
    expect(describeRecordingLink(weeks[1].components[0], context, 'W5')).toBe('Linked to LS · Week 1');
    expect(describeRecordingLink(weeks[0].components[0], context, 'W1')).toBe('Recording linked');
    expect(describeRecordingLink(recording('X', 'LS-B', 'W5', 'MOD-B'), context, 'W5')).toBe('Linked to a session in Module B · Group 2');
    expect(describeRecordingLink(recording('Z', 'GONE', 'W5'), context, 'W5')).toBe('Linked session missing');
    expect(describeRecordingLink(recording('U', '', 'W5'), context, 'W5')).toBe('Not linked');
  });

  it('moves a same-week pair together, from either side', () => {
    const weeks = [week('W1', [live('LS'), component('R', 'reading'), recording('REC', 'LS')]), week('W2', [])];
    for (const id of ['LS', 'REC']) {
      const moved = moveComponentToWeek(weeks, id, 'W2');
      expect(moved[0].components.map(item => item.id)).toEqual(['R']);
      expect(moved[1].components.map(item => [item.id, item.weekId])).toEqual([['LS', 'W2'], ['REC', 'W2']]);
    }
  });

  const placement = (weeks: ModuleWeek[]) => Object.fromEntries(weeks.map(item => [item.id, item.components.map(c => `${c.id}@${c.weekId}`)]));

  it('moves a linked pair in different weeks together, from either side, and keeps it linked', () => {
    const weeks = [week('W2', [live('LS', 'W2')]), week('W5', [component('R', 'reading', 'W5'), recording('REC', 'LS', 'W5')]), week('W7', []), week('W9', [])];
    const bySession = moveComponentToWeek(weeks, 'LS', 'W7');
    expect(placement(bySession)).toEqual({ W2: [], W5: ['R@W5'], W7: ['LS@W7', 'REC@W7'], W9: [] });
    expect(recordingLinkId(bySession[2].components[1])).toBe('LS');
    const byRecording = moveComponentToWeek(bySession, 'REC', 'W9');
    expect(placement(byRecording)).toEqual({ W2: [], W5: ['R@W5'], W7: [], W9: ['LS@W9', 'REC@W9'] });
    // From the original split as well: the recording drags the session along.
    expect(placement(moveComponentToWeek(weeks, 'REC', 'W9')).W9).toEqual(['LS@W9', 'REC@W9']);
  });

  it('moves unlinked components alone, and never infers a link from sharing a week', () => {
    const weeks = [week('W2', [live('LS', 'W2'), recording('LOOSE', '', 'W2')]), week('W5', [recording('REC', '', 'W5')]), week('W7', [])];
    expect(placement(moveComponentToWeek(weeks, 'LS', 'W7'))).toEqual({ W2: ['LOOSE@W2'], W5: ['REC@W5'], W7: ['LS@W7'] });
    expect(placement(moveComponentToWeek(weeks, 'REC', 'W7'))).toEqual({ W2: ['LS@W2', 'LOOSE@W2'], W5: [], W7: ['REC@W7'] });
  });

  it('stops moving together once unlinked, and moves together again once relinked', () => {
    const linked = [week('W2', [live('LS', 'W2')]), week('W5', [recording('REC', 'LS', 'W5')]), week('W7', [])];
    const unlinked = linked.map(item => ({ ...item, components: item.components.map(c => (c.id === 'REC' ? withRecordingLink(c, '') : c)) }));
    expect(placement(moveComponentToWeek(unlinked, 'LS', 'W7'))).toEqual({ W2: [], W5: ['REC@W5'], W7: ['LS@W7'] });
    const relinked = unlinked.map(item => ({ ...item, components: item.components.map(c => (c.id === 'REC' ? withRecordingLink(c, 'LS') : c)) }));
    expect(placement(moveComponentToWeek(relinked, 'LS', 'W7')).W7).toEqual(['LS@W7', 'REC@W7']);
  });

  it('takes every recording linked to the session, and joins a session already in the target week', () => {
    const weeks = [
      week('W1', [live('LS'), component('Q', 'quiz')]),
      week('W3', [recording('REC-A', 'LS', 'W3')]),
      week('W4', [recording('REC-B', 'LS', 'W4'), live('OTHER', 'W4')]),
    ];
    expect(placement(moveComponentToWeek(weeks, 'REC-B', 'W3'))).toEqual({ W1: ['Q@W1'], W3: ['LS@W3', 'REC-A@W3', 'REC-B@W3'], W4: ['OTHER@W4'] });
    expect(placement(moveComponentToWeek(weeks, 'REC-A', 'W1'))).toEqual({ W1: ['LS@W1', 'REC-A@W1', 'REC-B@W1', 'Q@W1'], W3: [], W4: ['OTHER@W4'] });
  });

  it('never moves anything in another module, and treats its own module id as this module', () => {
    const weeks = [week('W1', [live('LS')]), week('W2', [recording('FAR', 'LS', 'W2', 'MOD-B'), recording('OWN', 'LS', 'W2', 'M')]), week('W3', [])];
    expect(placement(moveComponentToWeek(weeks, 'FAR', 'W3', 'M'))).toEqual({ W1: ['LS@W1'], W2: ['OWN@W2'], W3: ['FAR@W3'] });
    expect(placement(moveComponentToWeek(weeks, 'OWN', 'W3', 'M'))).toEqual({ W1: [], W2: ['FAR@W2'], W3: ['LS@W3', 'OWN@W3'] });
    expect(recordingLinkTarget(moveComponentToWeek(weeks, 'FAR', 'W3', 'M')[2].components[0], 'M')).toEqual({ componentId: 'LS', moduleId: 'MOD-B' });
  });

  it('names what a move takes along, and splits a session’s recordings by week for delete', () => {
    const weeks = [{ id: 'W2', label: 'Week 2', components: [live('LS', 'W2'), recording('NEAR', 'LS', 'W2')] }, { id: 'W5', label: 'Week 5', components: [recording('REC', 'LS', 'W5')] }];
    const context = { moduleId: 'M', weeks };
    expect(movingPartnersOf(weeks[1].components[0], context).map(item => [item.component.id, item.week.label])).toEqual([['LS', 'Week 2'], ['NEAR', 'Week 2']]);
    expect(movingPartnersOf(recording('U', '', 'W5'), context)).toEqual([]);
    const { sameWeek, otherWeeks } = linkedRecordingsByPlace(context, weeks[0].components[0], 'W2');
    expect(sameWeek.map(item => item.id)).toEqual(['NEAR']);
    expect(otherWeeks.map(item => [item.recording.id, item.week.label])).toEqual([['REC', 'Week 5']]);
  });

  it('keeps a same-week recording straight after its session when the session is dragged', () => {
    const reordered = [component('R', 'reading'), recording('REC', 'LS'), component('Q', 'quiz'), live('LS')];
    expect(keepRecordingsWithTheirSession(reordered).map(item => item.id)).toEqual(['R', 'Q', 'LS', 'REC']);
  });

  it('deletes both, or keeps the recording unlinked', () => {
    const components = [live('LS'), recording('REC', 'LS'), component('R', 'reading')];
    expect(removeComponentFromWeek(components, 'LS', true).map(item => item.id)).toEqual(['R']);
    const kept = removeComponentFromWeek(components, 'LS', false);
    expect(kept.map(item => item.id)).toEqual(['REC', 'R']);
    expect(recordingLinkId(kept[0])).toBe('');
  });

  it('re-points copied links; keeps outside links only inside the same module', () => {
    const sources = [live('LS'), recording('REC', 'LS'), recording('OTHER-WEEK', 'LS-W9'), recording('ELSEWHERE', 'LS-B', 'W1', 'MOD-B')];
    const copies = sources.map(item => ({ ...item, id: `copy-${item.id}` }));
    const same = relinkCopiedComponents(sources, copies, { sameModule: true });
    expect(same.map(item => recordingLinkTarget(item))).toEqual([
      null, { componentId: 'copy-LS', moduleId: '' }, { componentId: 'LS-W9', moduleId: '' }, { componentId: 'LS-B', moduleId: 'MOD-B' },
    ]);
    const other = relinkCopiedComponents(sources, copies);
    expect(other.map(item => recordingLinkId(item))).toEqual(['', 'copy-LS', '', '']);
  });

  it('keeps links in a duplicated week, a copied single recording, and inside a week copied to another module', () => {
    const source = week('W1', [live('LS'), recording('REC', 'LS'), recording('FAR', 'LS-W9')]);
    const module = { id: 'M', weekStructure: [source] } as unknown as ModuleCatalogueItem;
    const twin = duplicateWeekInModule(module, 'W1').weekStructure[1];
    expect(recordingLinkId(twin.components[1])).toBe(twin.components[0].id);
    expect(recordingLinkId(twin.components[2])).toBe('LS-W9');
    expect(recordingLinkId(cloneComponentToWeek(source.components[2], 'W2', 'M'))).toBe('LS-W9');
    const copy = copyWeekToModule(source, 'M2', 1);
    expect(recordingLinkId(copy.components[1])).toBe(copy.components[0].id);
    expect(recordingLinkId(copy.components[2])).toBe('');
  });

  it('sets and clears a link with its module', () => {
    const linked = withRecordingLink(recording('REC', ''), 'LS-B', 'MOD-B');
    expect(linked.settings).toMatchObject({ linkedLiveSessionComponentId: 'LS-B', linkedLiveSessionModuleId: 'MOD-B' });
    expect(withRecordingLink(linked, '', 'MOD-B').settings).toMatchObject({ linkedLiveSessionComponentId: '', linkedLiveSessionModuleId: '' });
    expect(linkedRecordingsOf([live('LS'), linked], live('LS'))).toEqual([]);
  });

  it('accepts both link settings and needs no URL once linked', () => {
    const linked = { ...recording('REC', 'LS-B', 'W1', 'MOD-B'), settings: { contentStatus: 'Ready for QA', version: '0.1', linkedLiveSessionComponentId: 'LS-B', linkedLiveSessionModuleId: 'MOD-B', recordingUrl: '' } };
    expect(validateComponentAuthoring(linked).filter(issue => /Unsupported setting/.test(issue.message))).toEqual([]);
  });
});
