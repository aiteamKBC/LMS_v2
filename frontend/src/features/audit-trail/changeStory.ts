import type { CurriculumAuditEvent } from '@/lib/curriculumApi';

/**
 * One saved change, said as a sentence a person can read.
 *
 * The event already carries everything needed to explain itself -- the action,
 * the handler that caused it, who the actor was, and the page the write came
 * from. What it did not have was a place where those are put together, so every
 * surface rendered the raw parts side by side and left the reader to join them
 * up: an "ARCHIVED" badge next to a record name, `deleted_at` moving from empty
 * to a timestamp, and `Page: /curriculum/module-builder`.
 *
 * Two honesty rules hold here:
 *
 * * A cause is stated only when the handler code has a known meaning. An
 *   unmapped code stays out of the sentence rather than being paraphrased; the
 *   raw handler is still on the event for anyone auditing it.
 * * A change no person made says so. `actorType` is recorded, so a cascade, a
 *   sweep or a scheduled job is never allowed to read as somebody's edit.
 */
export interface ChangeStory {
  /**
   * The action as the word the sentence opens with: `Deleted`, `First recorded`.
   *
   * Kept separate so the view can hang `actionMeaning` on it as a tooltip. Some
   * actions -- `recorded` above all -- are routinely misread, and the
   * explanation has to be reachable on the row itself, not only inside a
   * details panel the row may have nothing to put in.
   */
  verb: string;
  /** `the week` / `a week` -- what the verb acted on, before the record's name. */
  subject: string;
  /**
   * False when the save recorded no name, so the view renders no link and
   * `subject` already reads as a whole ("Deleted a week").
   *
   * The name is deliberately not folded into the sentence: it is the row's
   * link, and a link whose accessible name is a whole sentence is one a reader
   * cannot scan for and a screen reader cannot announce usefully.
   */
  named: boolean;
  /** `as part of a cleanup sweep`, or empty when the handler has no meaning. */
  cause: string;
  /** Why nobody is named, when nobody made this change directly. */
  systemNote: string;
  /** The page's name. Empty when the write had no page -- never a raw path. */
  page: string;
  /** Tone for the action, so the same colour means the same thing everywhere. */
  tone: ChangeTone;
}

export type ChangeTone = 'created' | 'edited' | 'removed' | 'restored' | 'neutral';

/**
 * How each action opens its sentence. Past tense and transitive, so the record
 * name can follow directly. Anything absent falls back to the server's own
 * `actionLabel`, which is already a word rather than an event name.
 */
const ACTION_VERBS: Record<string, string> = {
  created: 'Created',
  updated: 'Edited',
  archived: 'Archived',
  restored: 'Restored',
  deleted: 'Deleted',
  moved: 'Moved',
  reordered: 'Reordered',
  recorded: 'First seen',
  file_uploaded: 'Uploaded a file to',
  file_replaced: 'Replaced the file on',
  file_removed: 'Removed the file from',
  recalculated: 'Recalculated',
  imported: 'Imported',
};

const ACTION_TONES: Record<string, ChangeTone> = {
  created: 'created',
  updated: 'edited',
  archived: 'removed',
  deleted: 'removed',
  file_removed: 'removed',
  restored: 'restored',
};

export function changeTone(action: string): ChangeTone {
  return ACTION_TONES[action] || 'neutral';
}

/**
 * What an action means, for the reader who wants to know before they act on it.
 * Archived and deleted are the pair worth keeping apart: one is reversible and
 * one is not, and the badge alone has never said which.
 */
export function actionMeaning(change: CurriculumAuditEvent): string {
  switch (change.action) {
    case 'recorded':
      return 'This is the first timestamp at which the audit could see this record. It identifies when the record was present, but it does not prove that it was created at that moment or preserve the field values entered then.';
    case 'created':
      return 'This record was created. The details below are what it was created with.';
    case 'updated':
      return 'A saved change was made to this record.';
    case 'archived':
      return 'This record was archived. It is withdrawn from use and can still be restored.';
    case 'restored':
      return 'This record was brought back out of the archive.';
    case 'deleted':
      return 'This record was permanently removed. The details below are the last copy of what it held.';
    case 'moved':
      return 'This record was moved to a different parent.';
    case 'reordered':
      return 'This record changed position. Nothing else about it changed.';
    case 'recalculated':
      return 'The system recalculated this record. Nobody retyped it.';
    default:
      return `${change.actionLabel || change.action} activity was recorded for this record.`;
  }
}

export function changeStory(change: CurriculumAuditEvent): ChangeStory {
  const verb = ACTION_VERBS[change.action] || change.actionLabel || change.action;
  const cause = change.causeLabel ? `as part of ${change.causeLabel}` : '';
  const kind = (change.entityLabel || 'record').toLowerCase();
  const named = Boolean(change.title?.trim());

  // Named only when the actor really was not a person. `triggeredBy` is the
  // person whose save set a cascade going -- they caused it, which is not the
  // same as having made it, so the sentence keeps that distinction.
  let systemNote = '';
  if (change.actorType === 'system') {
    const trigger = change.triggeredByName?.trim() || change.triggeredByEmail?.trim();
    systemNote = trigger
      ? `Nobody made this change directly. The system made it while carrying out ${trigger}’s save.`
      : 'Nobody made this change directly. The system made it.';
  } else if (change.actorType === 'job') {
    systemNote = 'A scheduled job made this change. No person was involved.';
  } else if (change.actorType === 'integration') {
    systemNote = 'An integration made this change, not a person using the LMS.';
  }

  return {
    verb,
    subject: named ? `the ${kind}` : `a ${kind}`,
    named,
    cause,
    systemNote,
    page: change.pageLabel?.trim() || '',
    tone: changeTone(change.action),
  };
}

/**
 * The snapshot's fields worth showing, in a stable order.
 *
 * A create and a delete carry the stored record instead of a diff, and until now
 * the UI said "No field details recorded" over the top of it. Internal plumbing
 * is dropped: a reader wants the week's number and title, not its foreign keys
 * or its own id, and the untouched `snapshot` stays on the event for anyone who
 * needs the rest.
 */
const SNAPSHOT_HIDDEN = new Set([
  'id', 'uuid', 'created_at', 'updated_at', 'deleted_at', 'deleted_by',
  'deleted_via_parent', 'revision_no', 'aptem_id', 'settings_json',
]);

export function snapshotEntries(snapshot: Record<string, unknown> | null | undefined): Array<[string, unknown]> {
  if (!snapshot) return [];
  return Object.entries(snapshot)
    .filter(([key, value]) => (
      !key.startsWith('_')
      && !SNAPSHOT_HIDDEN.has(key)
      && value !== null
      && value !== undefined
      && value !== ''
    ));
}
