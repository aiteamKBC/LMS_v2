type ModuleOption = { id: string; title: string };
export type AttendanceModuleGroup = ModuleOption & { moduleIds: string[] };

const G1_RAY_TITLE = 'G1- Ray - Project Management Professional - Jan 26';

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

function confirmedAlias(title: string): string | null {
  const normalized = normalizedModuleTitle(title);
  // These register names are confirmed aliases of the G1 course.
  // Keep the group and intake: G2, other dates and other courses stay separate.
  return /^g1\s*-\s*(?:dr\.?\s*)?ray\s*-\s*project management professional\s*-\s*jan 26$/i.test(normalized)
    ? G1_RAY_TITLE : null;
}

/** Group the selector only; original lecture identities still drive every action. */
export function attendanceModuleGroups(options: readonly ModuleOption[]): AttendanceModuleGroup[] {
  const groups = new Map<string, AttendanceModuleGroup>();
  for (const option of options) {
    if (isLearningOnlyModule(option.title)) continue;
    const alias = confirmedAlias(option.title);
    const key = alias ? `alias:${alias}` : `module:${option.id}`;
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, { ...option, title: alias || option.title, moduleIds: [option.id] });
      continue;
    }
    if (!existing.moduleIds.includes(option.id)) existing.moduleIds.push(option.id);
    // Prefer the assigned module so the current-module default stays selected.
    if (option.id.startsWith('native:') && !existing.id.startsWith('native:')) existing.id = option.id;
  }
  return [...groups.values()];
}
