type ModuleOption = { id: string; title: string };
export type AttendanceModuleGroup = ModuleOption & { moduleIds: string[] };

function normalizedModuleTitle(title: string): string {
  return title.normalize('NFKC').replace(/[\u2010-\u2015]/g, '-').replace(/\s+/g, ' ').trim();
}

/** These assigned learning resources do not have an attendance requirement. */
export function isLearningOnlyModule(title: string): boolean {
  const normalized = normalizedModuleTitle(title);
  return /(?:^|[-:]\s*)ksbs$/i.test(normalized)
    || /^safeguarding(?: for (?:learners|admins|training providers))?$/i.test(normalized);
}

/** Preserve the source register; only the attendance page excludes these modules. */
export function attendanceLecturesForDisplay<T extends { moduleId: string; module: string }>(
  lectures: readonly T[], modules: readonly ModuleOption[],
): T[] {
  const excluded = new Set(modules.filter(module => isLearningOnlyModule(module.title)).map(module => module.id));
  return lectures.filter(lecture => !excluded.has(lecture.moduleId) && !isLearningOnlyModule(lecture.module));
}

function attendanceModuleName(title: string) {
  const normalized = normalizedModuleTitle(title);
  // Match dashboard_overview.py: remove the honorific, keeping every other word.
  const withoutDr = normalized.replace(/(^|[\s(:-])dr(?:\.\s*|\s+)(?=\p{L})/giu, '$1').trim();
  return { title: withoutDr, key: withoutDr.replace(/\s*-\s*/g, '-').toLowerCase(), hasDr: withoutDr !== normalized };
}

/** Group the selector only; original lecture identities still drive every action. */
export function attendanceModuleGroups(options: readonly ModuleOption[]): AttendanceModuleGroup[] {
  const groups = new Map<string, AttendanceModuleGroup>();
  const names = options.map(option => attendanceModuleName(option.title));
  const aliasKeys = new Set(names.filter(name => name.hasDr && name.key).map(name => name.key));
  for (const option of options) {
    if (isLearningOnlyModule(option.title)) continue;
    const name = attendanceModuleName(option.title);
    const alias = aliasKeys.has(name.key);
    const key = alias ? `alias:${name.key}` : `module:${option.id}`;
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, { ...option, title: alias ? name.title : option.title, moduleIds: [option.id] });
      continue;
    }
    if (!existing.moduleIds.includes(option.id)) existing.moduleIds.push(option.id);
    // Prefer the assigned module so the current-module default stays selected.
    if (option.id.startsWith('native:') && !existing.id.startsWith('native:')) {
      existing.id = option.id;
      existing.title = alias ? name.title : option.title;
    }
  }
  return [...groups.values()];
}
