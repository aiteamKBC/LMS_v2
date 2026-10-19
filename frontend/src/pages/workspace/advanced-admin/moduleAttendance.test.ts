import { expect, it } from 'vitest';
import type { AdvancedAdminAttendance, AdvancedAdminModuleProgress } from '@/api/advancedAdmin';
import { attendanceByModule } from './moduleAttendance';
import type { ModuleView } from './moduleProgressModel';

it('matches KBC register rows to one module by saved group/title and leaves shared groups unassigned', () => {
  const modules = [
    { subject: { id: 'legacy:1', title: 'Marketing & Planning' }, moduleId: 'a' },
    { subject: { id: 'current:b', title: 'Machine Learning' }, moduleId: 'b' },
  ] as ModuleView[];
  const progress = { modules: [
    { id: 'a', title: 'Marketing & Planning', group_name: 'G1' },
    { id: 'b', title: 'Machine Learning', group_name: 'G1' },
  ] } as AdvancedAdminModuleProgress;
  const rows = [
    { sessionId: 'one', module: 'Marketing &amp; Planning', title: 'Lecture one', date: '2026-10-01', status: 'present' },
    { sessionId: 'two', module: 'G1', title: 'Shared group lecture', date: '2026-10-02', status: 'absent' },
  ] as AdvancedAdminAttendance[];
  const result = attendanceByModule(modules, progress, rows);
  expect(result.byModule.get('legacy:1')).toEqual([rows[0]]);
  expect(result.byModule.get('current:b')).toBeUndefined();
  expect(result.unmatched).toEqual([rows[1]]);
});
