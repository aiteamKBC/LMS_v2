import { expect, it } from 'vitest';
import { applyModuleComponentUpdate, applyLiveSessionLinkToComponents, createLocalModuleDraft, createEmptyComponent } from '../moduleAuthoringData';

function fixture() {
  const module = createLocalModuleDraft({ programme: 'Synthetic', title: 'Course', catalogueId: 'MOD-TEST',
    description: '', weeks: 2, status: 'draft' });
  module.weekStructure.forEach((week, index) => {
    const component = createEmptyComponent(week.id, 'live-session', 1);
    component.settings = { ...component.settings, sessionDate: index ? '2026-10-30' : '2026-10-23',
      liveSessionUrl: 'https://teams.microsoft.com/original', teamsMeetingUrl: 'https://teams.microsoft.com/original',
      teamsLiveSessionId: 'OLD-LIVE', teamsOccurrenceId: 'OCC-' + index, teamsEventId: 'EVENT-' + index,
      teamsCalendarBinding: 'matched', recordingSeriesId: 'HISTORY', sessionPurpose: 'Original outline' };
    week.components = [component];
  });
  return module;
}

it('typing one manual link changes only its component and keeps its planned date and explicit historical recording', () => {
  const source = fixture();
  const selected = source.weekStructure[0].components[0];
  const other = source.weekStructure[1].components[0];
  const result = applyModuleComponentUpdate(source, selected.id, { settings: {
    ...selected.settings, liveSessionUrl: 'https://teams.microsoft.com/new',
  } });
  const settings = result.weekStructure[0].components[0].settings;
  expect(settings.liveSessionUrl).toBe('https://teams.microsoft.com/new');
  expect(settings.teamsOccurrenceId).toBeUndefined();
  expect(settings.teamsLiveSessionId).toBeUndefined();
  expect(settings.teamsCalendarBinding).toBe('unverified');
  expect(settings.sessionDate).toBe('2026-10-23');
  expect(settings.recordingSeriesId).toBe('HISTORY');
  expect(result.weekStructure[1].components[0]).toBe(other);
  expect(source.weekStructure[0].components[0]).toBe(selected);
});

it('editing the outline with an unchanged URL never copies the first occurrence over the second', () => {
  const source = fixture();
  const selected = source.weekStructure[0].components[0];
  const result = applyModuleComponentUpdate(source, selected.id, { settings: {
    ...selected.settings, sessionPurpose: 'Revised outline',
  } });
  expect(result.weekStructure[0].components[0].settings.teamsOccurrenceId).toBe('OCC-0');
  expect(result.weekStructure[1].components[0]).toBe(source.weekStructure[1].components[0]);
  expect(result.weekStructure[1].components[0].settings.teamsOccurrenceId).toBe('OCC-1');
});

it('the post-save link patch cannot put an unrelated provider identity back into the workspace', () => {
  const source = fixture();
  const selected = source.weekStructure[0].components[0];
  const result = applyLiveSessionLinkToComponents(source, [selected.id], 'https://teams.microsoft.com/manual');
  expect(result.weekStructure[0].components[0].settings.teamsEventId).toBeUndefined();
  expect(result.weekStructure[1].components[0]).toBe(source.weekStructure[1].components[0]);
});

it('clearing one manual link clears its provider identity without clearing its planned date or another week', () => {
  const source = fixture();
  const selected = source.weekStructure[0].components[0];
  const result = applyModuleComponentUpdate(source, selected.id, { settings: { ...selected.settings, liveSessionUrl: '' } });
  const settings = result.weekStructure[0].components[0].settings;
  expect(settings.liveSessionUrl).toBe('');
  expect(settings.teamsMeetingUrl).toBe('');
  expect(settings.teamsOccurrenceId).toBeUndefined();
  expect(settings.sessionDate).toBe('2026-10-23');
  expect(result.weekStructure[1].components[0]).toBe(source.weekStructure[1].components[0]);
});
