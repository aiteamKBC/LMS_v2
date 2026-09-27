/**
 * What "somebody else saved this module while you were editing it" does now.
 *
 * The general rules live in `@/lib/collaborativeMerge`. This file is the part
 * that knows what a module is: which of its fields two people can genuinely
 * both author, which belong to the server, which belong to Microsoft, and how
 * to say in a sentence what was kept when the two editors disagreed.
 *
 * It is deliberately separate from the builder page so the other curriculum
 * authoring screens can merge the same record the same way.
 */
import {
  mergePathIds,
  mergePathLeaf,
  mergeRecords,
  type MergeCollision,
} from '@/lib/collaborativeMerge';
import {
  recalculateModule,
  TEAMS_MEETING_SETTING_KEYS,
  type ModuleCatalogueItem,
  type ModuleComponent,
  type ModuleWeek,
} from '@/pages/curriculum/module-builder/moduleAuthoringData';

/**
 * Fields nobody authors: the server derives them from the content on every
 * read and on every save.
 *
 * Left out of the merge because including them manufactures disagreements. Two
 * editors who added a component each have different `lessonCount`s through no
 * decision of anyone's, and reporting that as "you both changed the lesson
 * count" would bury the one collision that is real. `recalculateModule` puts
 * every one of them back once the content is settled.
 */
const DERIVED_MODULE_FIELDS = new Set([
  'structureRevision',
  'lastUpdated',
  'createdAt',
  'weeks',
  'totalOtjh',
  'ksbCount',
  'lessonCount',
  'quizCount',
  'qualityScore',
  'assignedLearnerCount',
  'sourceModule',
  'deliveryUsages',
]);

/**
 * Values chosen as a set, merged as a set.
 *
 * A weekly schedule is days and times picked together; taking one editor's days
 * with the other's times produces a pattern neither of them chose. The holiday
 * selection is a plain list of dates with no identity to match on, so half of
 * it is not a smaller selection, it is a different one.
 */
const ATOMIC_MODULE_FIELDS = new Set([
  'weeklySchedule',
  'sessionHolidays',
  'weekStructure[*].learningOutcomes',
  'epaRequirements',
  'qualificationOutcomes',
]);

/**
 * Settings that name a Microsoft meeting rather than anything an author typed.
 *
 * The stored copy wins outright. These ids are written by the Teams attachment
 * path, not by this screen, so a workspace that has been open since before a
 * meeting was created or moved is holding history, not an opinion -- and a
 * merge that let it win would re-point a join link at a meeting that is no
 * longer the session's. Section 5's first invariant, in one rule.
 */
const TEAMS_OWNED_SETTINGS = new Set<string>(
  TEAMS_MEETING_SETTING_KEYS.map(key => `weekStructure[*].components[*].settings.${key}`),
);

export interface ModuleMergeResult {
  /** The reader's module with the other editor's work folded in. */
  module: ModuleCatalogueItem;
  /** How many of the other editor's changes were taken. */
  adopted: number;
  /** One sentence per real disagreement, already readable. */
  notices: string[];
}

/** camelCase field name -> something a person would say. */
const FIELD_LABELS: Record<string, string> = {
  title: 'title',
  name: 'name',
  summary: 'summary',
  description: 'description',
  points: 'points',
  expectedOtjh: 'expected OTJH hours',
  declaredTotalOtjh: 'declared OTJH total',
  reflectionRequired: 'reflection setting',
  reflectionQuestion: 'reflection question',
  workplaceEvidenceRequired: 'workplace evidence setting',
  tutorValidationRequired: 'tutor sign-off setting',
  coachValidationRequired: 'coach sign-off setting',
  holidayNote: 'holiday note',
  holidayNoteEnabled: 'holiday note setting',
  startDate: 'start date',
  endDate: 'end date',
  startTime: 'start time',
  endTime: 'end time',
  sessionsNumber: 'number of sessions',
  weeklySchedule: 'weekly schedule',
  sessionHolidays: 'holiday selection',
  tutor: 'tutor',
  coach: 'coach',
  status: 'status',
  ksbMappings: 'KSB mapping',
  moduleKsbMappings: 'KSB mapping',
  learningOutcomes: 'learning outcomes',
  background: 'background',
  coverImage: 'cover image',
};

function humanField(path: string): string {
  const leaf = mergePathLeaf(path);
  if (FIELD_LABELS[leaf]) return FIELD_LABELS[leaf];
  if (!leaf) return 'content';
  // A settings key, or a field nobody has named yet. `liveSessionUrl` reads as
  // "live session url", which is a sentence a person can act on; the raw key is
  // not.
  return leaf
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .toLowerCase();
}

/** "Week 3" / the component's own title, for whichever ids the path names. */
function locate(module: ModuleCatalogueItem, path: string): string {
  const [weekId, componentId] = mergePathIds(path);
  if (!weekId) return '';
  const week = module.weekStructure.find(item => item.id === weekId);
  const weekLabel = week ? `Week ${week.weekNumber}` : '';
  if (!componentId) return weekLabel;
  const component = week?.components.find(item => item.id === componentId);
  const componentLabel = component?.title?.trim();
  if (!componentLabel) return weekLabel;
  return weekLabel ? `${componentLabel}, in ${weekLabel}` : componentLabel;
}

/**
 * One collision, as a sentence.
 *
 * Always says three things, because a reader who is told less cannot act: what
 * was in disagreement, that their version is the one still on screen, and --
 * where it is short enough to be useful -- what the other editor had.
 */
function noticeFor(module: ModuleCatalogueItem, collision: MergeCollision): string {
  const where = locate(module, collision.path);
  const at = where ? ` in ${where}` : '';
  if (collision.kind === 'remote-deleted') {
    return `Someone else deleted${at ? ` ${where}` : ' something you are editing'} while you were working on it. Your version is still here and will be saved.`;
  }
  if (collision.kind === 'local-deleted') {
    return `Someone else edited${at ? ` ${where}` : ' something'} after you deleted it. It stays deleted.`;
  }
  if (collision.kind === 'reorder') {
    // No combination of two orders is either of them, so there is nothing to
    // merge here -- only something to say.
    return where
      ? `You and someone else both reordered the components in ${where}. Your order is kept.`
      : 'You and someone else both reordered the weeks. Your order is kept.';
  }
  const field = humanField(collision.path);
  const theirs = shortValue(collision.remote);
  return theirs
    ? `You and someone else both changed the ${field}${at}. Yours is kept; theirs was "${theirs}".`
    : `You and someone else both changed the ${field}${at}. Yours is kept.`;
}

/** Their value, when it is short enough to quote. Nothing for an object or an essay. */
function shortValue(value: unknown): string {
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value !== 'string') return '';
  const text = value.trim();
  if (!text || text.length > 60) return '';
  return text;
}

/**
 * Fold the stored module into the one on screen.
 *
 * `base` is the module as it was last read from or written to the server --
 * never the copy on screen. It is what tells a field the reader changed apart
 * from a field the other editor changed, and passing the screen's own copy
 * would make every difference read as theirs and silently drop the reader's
 * work.
 */
export function mergeModuleStructures(
  base: ModuleCatalogueItem | null,
  local: ModuleCatalogueItem,
  remote: ModuleCatalogueItem,
): ModuleMergeResult {
  const { value, collisions, adopted } = mergeRecords(base, local, remote, {
    ignore: path => DERIVED_MODULE_FIELDS.has(mergePathLeaf(path)) && !path.includes('['),
    atomic: path => ATOMIC_MODULE_FIELDS.has(path),
    preferRemote: path => TEAMS_OWNED_SETTINGS.has(path),
  });
  // Weeks keep their own numbering, and the counts, totals and quality score are
  // derived from whatever the merge settled on rather than from either side's
  // copy of them.
  const module = recalculateModule(renumberWeeks(value));
  return {
    module,
    adopted,
    notices: collisions.map(collision => noticeFor(module, collision)),
  };
}

/**
 * Put the week numbers back in order after a merge.
 *
 * Two people adding a week each produces two weeks claiming the same number.
 * The rail reads by number, so leaving them would show a module that runs
 * 1, 2, 3, 3 — the order the merge settled on is the truth, and the numbers
 * follow it.
 */
function renumberWeeks(module: ModuleCatalogueItem): ModuleCatalogueItem {
  let changed = false;
  const weekStructure = module.weekStructure.map((week: ModuleWeek, index: number) => {
    const weekNumber = index + 1;
    const components = week.components.map((component: ModuleComponent) => (
      component.weekId === week.id ? component : { ...component, weekId: week.id }
    ));
    if (week.weekNumber === weekNumber && components.every((component, at) => component === week.components[at])) return week;
    changed = true;
    return { ...week, weekNumber, components };
  });
  return changed ? { ...module, weekStructure } : module;
}
