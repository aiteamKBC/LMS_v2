import type { AdvancedAdminAttendance, AdvancedAdminModuleProgress } from '@/api/advancedAdmin';
import type { ModuleView } from './moduleProgressModel';

function nameKey(value: string | null | undefined): string {
  return (value || '').normalize('NFKC').replace(/&amp;|&#0*38;/gi, '&')
    .replace(/\s+/g, ' ').trim().toLocaleLowerCase('en-GB');
}

/** Match only a unique saved subject/title/group name; never assign one group to several modules. */
export function attendanceByModule(modules: ModuleView[], progress: AdvancedAdminModuleProgress, rows: AdvancedAdminAttendance[]) {
  const names = new Map<string, Set<string>>();
  const currentModules = new Map(progress.modules.map(module => [module.id, module]));
  for (const module of modules) {
    const current = module.moduleId ? currentModules.get(module.moduleId) : undefined;
    for (const value of [module.subject.title, current?.title, current?.group_name]) {
      const key = nameKey(value);
      if (!key) continue;
      const ids = names.get(key) || new Set<string>();
      ids.add(module.subject.id);
      names.set(key, ids);
    }
  }
  const byModule = new Map<string, AdvancedAdminAttendance[]>();
  const unmatched: AdvancedAdminAttendance[] = [];
  for (const row of rows) {
    const matches = names.get(nameKey(row.module));
    if (matches?.size !== 1) { unmatched.push(row); continue; }
    const id = [...matches][0];
    byModule.set(id, [...(byModule.get(id) || []), row]);
  }
  for (const values of byModule.values()) values.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  unmatched.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  return { byModule, unmatched };
}
