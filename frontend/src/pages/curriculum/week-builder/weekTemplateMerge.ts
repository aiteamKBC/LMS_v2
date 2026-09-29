/**
 * What "somebody else saved this week template while you were editing it" does.
 *
 * The general rules live in `@/lib/collaborativeMerge`. This is the part that
 * knows what a week template is: which of its fields the server derives, and
 * how to say in a sentence what was kept when the two editors disagreed.
 *
 * Kept out of the page so it can be exercised directly. The rules below are
 * what decide whether somebody's afternoon survives, and they are not worth
 * testing through three thousand lines of editor.
 */
import {
  mergePathIds,
  mergePathLeaf,
  mergeRecords,
  type MergeCollision,
} from '@/lib/collaborativeMerge';
import { recalcWeekTemplate, type WeekTemplate } from './weekTemplateData';

/**
 * Values nobody authors: the server works them out from the components on
 * every read, and this editor re-derives them itself.
 *
 * Left out of the merge because including them manufactures disagreements.
 * Two editors who added a component each hold different `componentCount`s
 * through no decision of anyone's, and a component's `points` are not an
 * opinion at all -- they mirror the Engagement rule for its type, and the two
 * screens resolve that rule at different moments. Reporting either as "you both
 * changed this" buries the one disagreement that is real.
 */
const DERIVED_TEMPLATE_FIELDS = [
  // The concurrency token. It describes which version a copy was read at, not
  // anything anybody authored, and it moves on every write -- so weighing it
  // would report a disagreement on every single merge. The caller sets it from
  // the stored template afterwards, because that is the version the next save
  // has to be checked against.
  'revision',
  'totalOtjh',
  'points',
  'componentCount',
  'updatedAt',
  'lastUpdated',
  'createdAt',
  'author',
  'components[*].points',
  'components[*].moduleId',
  'components[*].weekId',
];

export interface WeekTemplateMergeResult {
  /** The reader's template with the other editor's work folded in. */
  template: WeekTemplate;
  /** How many of the other editor's changes were taken. */
  adopted: number;
  /** One sentence per real disagreement, already readable. */
  notices: string[];
}

/** The component a path points at, for naming it on screen. */
function componentTitle(template: WeekTemplate, path: string): string {
  const [componentId] = mergePathIds(path);
  if (!componentId) return '';
  const component = template.components.find(item => item.id === componentId);
  const title = component?.title?.trim();
  return title ? ` in "${title}"` : '';
}

function noticeFor(template: WeekTemplate, collision: MergeCollision): string {
  const where = componentTitle(template, collision.path);
  if (collision.kind === 'remote-deleted') {
    return `Someone else deleted a component you were editing${where}. Yours is still here and will be saved.`;
  }
  if (collision.kind === 'local-deleted') {
    return `Someone else edited a component after you deleted it${where}. It stays deleted.`;
  }
  if (collision.kind === 'reorder') {
    return 'You and someone else both reordered the components. Your order is kept.';
  }
  return `You and someone else both changed the ${mergePathLeaf(collision.path)}${where}. Yours is kept.`;
}

/**
 * Fold the stored template into the one on screen.
 *
 * `base` is the template as it was last read from or written to the server --
 * never the copy on screen, which is what tells a field the reader changed
 * apart from a field their colleague changed.
 */
export function mergeWeekTemplates(
  base: WeekTemplate,
  local: WeekTemplate,
  remote: WeekTemplate,
): WeekTemplateMergeResult {
  const { value, collisions, adopted } = mergeRecords(base, local, remote, {
    ignore: path => DERIVED_TEMPLATE_FIELDS.includes(path),
  });
  const template = recalcWeekTemplate(value);
  return { template, adopted, notices: collisions.map(collision => noticeFor(template, collision)) };
}
