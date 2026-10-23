import { describe, expect, it } from 'vitest';
import { attendanceLecturesForDisplay, attendanceModuleGroups } from './moduleGroups';

const title = 'G1- Ray - Project Management Professional - Jan 26';
const old = { id: 'legacy:with-dr', title: title.replace('Ray', 'Dr.Ray') };
const renamed = { id: 'legacy:without-dr', title };
const assigned = { id: 'native:G1', title };
const mspTitle = 'Managing Successful Programmes: Project Controls for Transformational Change';
const mspLegacy = { id: 'legacy:msp', title: 'Ray-Managing Successful Programmes (MSP) Jan 2026' };
const mspCurrent = { id: 'native:MSP', title: mspTitle };

describe('confirmed attendance course aliases', () => {
  it('groups the two register spellings with the assigned module without changing inputs', () => {
    const options = [old, renamed, assigned];
    const before = structuredClone(options);
    expect(attendanceModuleGroups(options)).toEqual([
      { ...assigned, moduleIds: [old.id, renamed.id, assigned.id] },
    ]);
    expect(options).toEqual(before);
  });

  it('handles punctuation, spacing and case without dropping the group or intake', () => {
    const variant = { id: 'legacy:variant', title: '  G1– DR. Ray – Project  Management Professional – Jan 26  ' };
    const others = [
      { id: 'native:G2', title: title.replace('G1', 'G2') },
      { id: 'native:feb', title: title.replace('Jan', 'Feb') },
      { id: 'native:next-year', title: title.replace('26', '27') },
      { id: 'native:other-course', title: title.replace('Management', 'Controls') },
      { id: 'native:other-tutor', title: title.replace('Ray', 'Alex') },
    ];
    const groups = attendanceModuleGroups([variant, assigned, ...others]);
    expect(groups).toHaveLength(6);
    expect(groups[0]).toEqual({ ...assigned, moduleIds: [variant.id, assigned.id] });
    expect(groups.slice(1)).toEqual(others.map(option => ({ ...option, moduleIds: [option.id] })));
  });

  it('groups historical aliases without requiring a current plan and never carries another learners IDs', () => {
    expect(attendanceModuleGroups([old, renamed])).toEqual([
      { id: old.id, title, moduleIds: [old.id, renamed.id] },
    ]);
    expect(attendanceModuleGroups([assigned])).toEqual([{ ...assigned, moduleIds: [assigned.id] }]);
    expect(attendanceModuleGroups([])).toEqual([]);
  });

  it('groups any course whose only difference is the Dr title, as requested', () => {
    const options = [{ id: 'one', title: 'Dr. Alex - Leadership' }, { id: 'two', title: 'Alex - Leadership' }];
    expect(attendanceModuleGroups(options)).toEqual([{ id: 'one', title: 'Alex - Leadership', moduleIds: ['one', 'two'] }]);
  });

  it.each(['Dr.Samira', 'Dr. Samira', 'DR Samira', 'Ｄｒ．Samira'])('groups %s across historical and native records while preserving group and intake', tutor => {
    const course = 'G3 - Samira - Leadership - Feb 27';
    const historical = { id: 'legacy:other', title: course.replace('Samira', tutor) };
    const current = { id: 'native:other', title: course };
    const otherIntake = { id: 'native:later', title: course.replace('Feb', 'Mar') };
    for (const pair of [[historical, current], [current, historical]]) {
      expect(attendanceModuleGroups([...pair, otherIntake])).toEqual([
        { ...current, moduleIds: pair.map(option => option.id) }, { ...otherIntake, moduleIds: [otherIntake.id] },
      ]);
    }
  });

  it('does not remove Dr inside words or combine identical titles without a Dr variant', () => {
    const titles = ['Drake - Leadership', 'ake - Leadership', 'HDR Planning', 'H Planning',
      'Drama - Design', 'ama - Design', 'Alex - Leadership', 'Alex - Leadership'];
    const options = titles.map((title, i) => ({ id: `module:${i}`, title }));
    expect(attendanceModuleGroups(options)).toEqual(options.map(option => ({ ...option, moduleIds: [option.id] })));
  });

  it.each([[mspLegacy, mspCurrent], [mspCurrent, mspLegacy]])('keeps the distinct MSP modules under their own names regardless of order: %j', (first, second) => {
    expect(attendanceModuleGroups([first, second])).toEqual([
      { ...first, moduleIds: [first.id] }, { ...second, moduleIds: [second.id] },
    ]);
  });

  it('preserves the original MSP spelling and keeps all intakes and courses separate', () => {
    const historical = { ...mspLegacy, title: '  Ray – Managing Successful Programmes (MSP) Jan 2026  ' };
    const others = [
      { id: 'legacy:msp-2027', title: mspLegacy.title.replace('2026', '2027') },
      { id: 'legacy:msp-feb', title: mspLegacy.title.replace('Jan', 'Feb') },
      { id: 'legacy:msp-other', title: 'Managing Successful Programmes' },
      assigned,
    ];
    expect(attendanceModuleGroups([historical, ...others])).toEqual([
      { ...historical, moduleIds: [historical.id] },
      ...others.map(option => ({ ...option, moduleIds: [option.id] })),
    ]);
    expect(attendanceModuleGroups([mspCurrent])).toEqual([{ ...mspCurrent, moduleIds: [mspCurrent.id] }]);
  });
});

describe('modules without attendance', () => {
  it('excludes KSB and Safeguarding modules from every programme and both sources without changing the input', () => {
    const titles = ['Associate project manager-L4-KSBs', 'Market Research  Executive Level 4-KSBs',
      'Marketing Executive L4 : KSBs', 'Marketing Manager Level 6-KSBs', 'Project Controls  Professional  L6 : KSBs',
      'Safeguarding For Learners', 'Safeguarding for Admins', 'Safeguarding for Training Providers'];
    const options = titles.flatMap((title, index) => ['legacy', 'native'].map(source => ({ id: `${source}:${index}`, title })));
    const before = structuredClone(options);
    expect(attendanceModuleGroups([...options, assigned, mspCurrent])).toEqual([
      { ...assigned, moduleIds: [assigned.id] }, { ...mspCurrent, moduleIds: [mspCurrent.id] },
    ]);
    expect(options).toEqual(before);
  });

  it('handles spacing and case while retaining distinct teaching modules that mention those topics', () => {
    const options = [
      { id: 'ksb', title: '  Project Controls Professional L6 – ksbs  ' },
      { id: 'safeguarding', title: '  SAFEGUARDING   FOR LEARNERS  ' },
      { id: 'workshop', title: 'Safeguarding workshop' },
      { id: 'teaching', title: 'KSBs in project management' },
      { id: 'ksb-workshop', title: 'Workshop on KSBs' },
    ];
    expect(attendanceModuleGroups(options)).toEqual(options.slice(2).map(option => ({ ...option, moduleIds: [option.id] })));
  });

  it('excludes their historical rows by module name or known ID, preserving the original register', () => {
    const rows = [
      { id: 'past-ksb', moduleId: 'legacy:ksb', module: 'Marketing Executive L4 : KSBs', status: 'completed', durationMinutes: 120 },
      { id: 'known-safeguarding', moduleId: 'native:safe', module: '', status: 'absent', durationMinutes: 60 },
      { id: 'teaching', moduleId: 'native:G1', module: title, status: 'completed', durationMinutes: 120 },
      { id: 'unmapped', moduleId: '', module: '', status: 'unmarked', durationMinutes: null },
    ];
    const before = structuredClone(rows);
    const displayed = attendanceLecturesForDisplay(rows, [{ id: 'native:safe', title: 'Safeguarding For Learners' }]);
    expect(displayed).toEqual(rows.slice(2));
    expect(rows).toEqual(before);
    expect(displayed[0]).toBe(rows[2]);
  });
});
