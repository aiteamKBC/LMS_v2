import { describe, expect, it } from 'vitest';
import { programmeColor, programmeColorText } from '../programmeColors';

describe('Programme colour inheritance', () => {
  it('assigns MBA green and ME4 pink despite their previous saved colours', () => {
    expect(programmeColor({ id: 'MBA-ID', name: 'MBA', color: '#db2777' })).toBe('#15803d');
    expect(programmeColor({ id: 'ME-ID', name: 'Marketing Executive Level 4', color: '#15803d' })).toBe('#db2777');
    for (const name of ['ME4', 'ME L4', '  marketing executive LEVEL 4  ', 'Marketing-Executive-L4']) {
      expect(programmeColor({ name })).toBe('#db2777');
    }
    expect(programmeColor({ name: 'Marketing Executive', level: 'Level 4' })).toBe('#db2777');
    expect(programmeColor({ name: 'Marketing Executive', level: '6', color: '#123456' })).toBe('#123456');
  });

  it('gives the other five named programmes distinct colours outside the MBA/ME4 pair', () => {
    const programmes = [
      { name: 'MBA', expected: '#15803d' },
      { name: 'Marketing Executive Level 4', expected: '#db2777' },
      { name: 'Marketing Manager Level 6', expected: '#2563eb' },
      { name: 'Project Controls Professional Level 6', expected: '#c2410c' },
      { name: 'Associate Project Manager Level 4', expected: '#7c3aed' },
      { name: 'OTHM LEVEL 7 DIPLOMA IN PROJECT MANAGEMENT - Al Fanar', expected: '#0f766e' },
      { name: 'Final Test', expected: '#b45309' },
    ];
    const colors = programmes.map(({ name, expected }) => {
      const record = Object.freeze({ name, color: '#6941c6' });
      expect(programmeColor(record)).toBe(expected);
      expect(record.color).toBe('#6941c6');
      return programmeColor(record);
    });
    expect(new Set(colors).size).toBe(7);
  });

  it('does not match unrelated programme names that merely contain an abbreviation', () => {
    for (const name of ['MBA Analytics', 'ME4 Advanced', 'Marketing Executive Level 6', 'Final Test Two']) {
      expect(programmeColor({ name, color: '#123456' })).toBe('#123456');
    }
  });

  it('keeps seven saved programme colours distinct without changing their records', () => {
    const colors = ['#6d28d9', '#2563eb', '#0f766e', '#16a34a', '#ea580c', '#dc2626', '#be123c'];
    const programmes = colors.map((color, index) => Object.freeze({ id: `P${index + 1}`, color }));
    expect(programmes.map(programmeColor)).toEqual(colors);
    expect(new Set(programmes.map(programmeColor)).size).toBe(7);
  });

  it('normalises persisted hex colours and uses stable identity when no colour is set', () => {
    expect(programmeColor({ color: 'Ab12Ef' })).toBe('#ab12ef');
    expect(programmeColor({ color: '#3aF' })).toBe('#33aaff');
    expect(programmeColor({ id: 'wrapper', sourceId: 'P1' })).toBe(programmeColor({ id: 'P1' }));
    const colours = Array.from({ length: 7 }, (_, index) => programmeColor({ id: `P${index + 1}` }));
    expect(new Set(colours).size).toBe(7);
    expect(programmeColor({ id: 'P1', name: 'Renamed' })).toBe(colours[0]);
    expect(programmeColor({ id: 'P1', color: 'invalid' })).toBe(colours[0]);
    expect(programmeColor(null)).toBe('#64748b');
  });

  it('keeps text readable for both light and dark programme colours', () => {
    expect(programmeColorText('#ffffff')).toBe('#172033');
    expect(programmeColorText('#ffff00')).toBe('#172033');
    expect(programmeColorText('#17152a')).toBe('#ffffff');
  });
});
