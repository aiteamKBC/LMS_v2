import { describe, expect, it } from 'vitest';
import type { AdminTransfer } from '@/api/progressTransfer';
import { transferLogCsv } from './transferExport';

const request: AdminTransfer = {
  requestId: 'R1', learnerId: '7', learnerKind: 'commercial', learnerName: 'A "quoted"\nname', programme: '=SUM(1,2)',
  status: 'approved', requestedAt: '2026-10-24T23:30:00Z', approvedAt: '2026-10-26T12:00:00Z',
  modules: [{ courseRef: 'legacy:1', moduleId: 'M1', oldTitle: 'Old module', newTitle: 'Assigned module', percent: 87, hours: 2.5 }],
};

describe('transfer log export', () => {
  it.each([String.fromCharCode(0, 31) + '=1', '\t +1', '\uFEFF@SUM(1)'])('escapes formulas after whitespace or control prefixes: %j', value => {
    expect(transferLogCsv([{ ...request, programme: value }])).toContain(`"'${value}"`);
  });

  it('retains authoritative identities, dates, snapshots and quoted multiline values in spreadsheet-safe CSV', () => {
    const csv = transferLogCsv([request]);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('"A ""quoted""\nname"');
    expect(csv).toContain('"\'=SUM(1,2)"');
    expect(csv).toContain('"2026-10-24T23:30:00Z","2026-10-26T12:00:00Z"');
    expect(csv).toContain('"legacy:1","Old module","M1","Assigned module","87","2.5","No"');
    expect(request.programme).toBe('=SUM(1,2)');
  });

  it('keeps requests without modules and leaves invalid snapshot values empty', () => {
    const csv = transferLogCsv([{ ...request, requestId: 'EMPTY', modules: [] }, { ...request, modules: [{ ...request.modules[0], percent: NaN, hours: -1 }] }]);
    expect(csv).toContain('"EMPTY"');
    expect(csv).toContain('"M1","Assigned module","","","No"');
    expect(csv).not.toContain('"NaN"');
    expect(csv).not.toContain('"-1"');
  });
});
