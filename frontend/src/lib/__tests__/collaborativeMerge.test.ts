import { describe, expect, it } from 'vitest';
import { mergeRecords } from '../collaborativeMerge';

/**
 * The rules two people editing one record depend on.
 *
 * Every case here is a thing that used to lose somebody's work: the second
 * saver being refused, or the screen quietly replacing what was typed. What
 * decides each one is the base -- the copy both editors started from -- which
 * is the only way to tell "they changed this" apart from "I changed this".
 */
describe('mergeRecords', () => {
  it('takes a field only the other editor changed', () => {
    const base = { title: 'Week one', summary: 'Intro' };
    const local = { title: 'Week one', summary: 'Intro' };
    const remote = { title: 'Week one, renamed', summary: 'Intro' };

    const { value, collisions, adopted } = mergeRecords(base, local, remote);

    expect(value.title).toBe('Week one, renamed');
    expect(collisions).toEqual([]);
    expect(adopted).toBe(1);
  });

  it('keeps a field only this editor changed', () => {
    const base = { title: 'Week one', summary: 'Intro' };
    const local = { title: 'My unsaved week', summary: 'Intro' };
    // Their save carried the pre-edit title because that is what they had, not
    // because they decided anything about it.
    const remote = { title: 'Week one', summary: 'Their new summary' };

    const { value, collisions } = mergeRecords(base, local, remote);

    expect(value).toEqual({ title: 'My unsaved week', summary: 'Their new summary' });
    expect(collisions).toEqual([]);
  });

  it('keeps this editor and reports it when both changed the same field', () => {
    const base = { title: 'Week one' };
    const local = { title: 'My unsaved week' };
    const remote = { title: 'Their week' };

    const { value, collisions } = mergeRecords(base, local, remote);

    expect(value.title).toBe('My unsaved week');
    expect(collisions).toEqual([{ path: 'title', local: 'My unsaved week', remote: 'Their week', kind: 'value' }]);
  });

  it('says nothing when both editors made the same change', () => {
    const { collisions, adopted } = mergeRecords({ points: 5 }, { points: 30 }, { points: 30 });
    expect(collisions).toEqual([]);
    expect(adopted).toBe(0);
  });

  it('ends up with both weeks when the two editors add one each', () => {
    const base = { weeks: [{ id: 'w1', title: 'One' }] };
    const local = { weeks: [{ id: 'w1', title: 'One' }, { id: 'mine', title: 'Mine' }] };
    const remote = { weeks: [{ id: 'w1', title: 'One' }, { id: 'theirs', title: 'Theirs' }] };

    const { value, collisions } = mergeRecords(base, local, remote);

    expect(value.weeks.map(week => week.id)).toEqual(['w1', 'mine', 'theirs']);
    expect(collisions).toEqual([]);
  });

  it('merges two edits to different fields of the same component', () => {
    const base = { weeks: [{ id: 'w1', components: [{ id: 'c1', title: 'Reading', points: 5 }] }] };
    const local = { weeks: [{ id: 'w1', components: [{ id: 'c1', title: 'Reading task', points: 5 }] }] };
    const remote = { weeks: [{ id: 'w1', components: [{ id: 'c1', title: 'Reading', points: 30 }] }] };

    const { value, collisions } = mergeRecords(base, local, remote);

    expect(value.weeks[0].components[0]).toEqual({ id: 'c1', title: 'Reading task', points: 30 });
    expect(collisions).toEqual([]);
  });

  it('honours a delete the other editor made to something untouched here', () => {
    const base = { weeks: [{ id: 'w1', title: 'One' }, { id: 'w2', title: 'Two' }] };
    const local = { weeks: [{ id: 'w1', title: 'Mine now' }, { id: 'w2', title: 'Two' }] };
    const remote = { weeks: [{ id: 'w1', title: 'One' }] };

    const { value, collisions } = mergeRecords(base, local, remote);

    expect(value.weeks.map(week => week.id)).toEqual(['w1']);
    expect(value.weeks[0].title).toBe('Mine now');
    expect(collisions).toEqual([]);
  });

  it('keeps work the other editor deleted underneath it, and says so', () => {
    const base = { weeks: [{ id: 'w1', title: 'One' }] };
    const local = { weeks: [{ id: 'w1', title: 'Half an hour of my work' }] };
    const remote = { weeks: [] as { id: string; title: string }[] };

    const { value, collisions } = mergeRecords(base, local, remote);

    expect(value.weeks).toHaveLength(1);
    expect(collisions[0].kind).toBe('remote-deleted');
  });

  it('never lets a stale copy re-assert a meeting id', () => {
    // The workspace was opened before the meeting was created, so its copy of
    // the Teams ids is history rather than an opinion. Their copy wins even
    // though this editor changed the same settings object.
    const base = { settings: { title: 'Session', teamsEventId: '' } };
    const local = { settings: { title: 'Kick-off session', teamsEventId: '' } };
    const remote = { settings: { title: 'Session', teamsEventId: 'AAMk-event' } };

    const { value, collisions } = mergeRecords(base, local, remote, {
      preferRemote: path => path === 'settings.teamsEventId',
    });

    expect(value.settings).toEqual({ title: 'Kick-off session', teamsEventId: 'AAMk-event' });
    expect(collisions).toEqual([]);
  });

  it('treats a value chosen as a set as one value', () => {
    const base = { schedule: { days: ['Mon'], startTime: '09:00' } };
    const local = { schedule: { days: ['Tue'], startTime: '09:00' } };
    const remote = { schedule: { days: ['Mon'], startTime: '14:00' } };

    const { value, collisions } = mergeRecords(base, local, remote, { atomic: path => path === 'schedule' });

    // Tuesdays at 14:00 is a slot neither of them chose, so it is not offered.
    expect(value.schedule).toEqual({ days: ['Tue'], startTime: '09:00' });
    expect(collisions).toHaveLength(1);
  });

  it('leaves derived fields to be recalculated rather than fought over', () => {
    const base = { lessonCount: 1, title: 'M' };
    const local = { lessonCount: 2, title: 'M' };
    const remote = { lessonCount: 3, title: 'M2' };

    const { value, collisions } = mergeRecords(base, local, remote, { ignore: path => path === 'lessonCount' });

    expect(value.lessonCount).toBe(2);
    expect(value.title).toBe('M2');
    expect(collisions).toEqual([]);
  });

  it('takes everything when this editor has changed nothing at all', () => {
    const base = { weeks: [{ id: 'w1', title: 'One' }] };
    const remote = { weeks: [{ id: 'w1', title: 'One, theirs' }, { id: 'w2', title: 'Two' }] };

    const { value, collisions } = mergeRecords(base, base, remote);

    expect(value).toEqual(remote);
    expect(collisions).toEqual([]);
  });
});
