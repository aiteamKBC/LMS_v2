import { useCallback, useMemo, useRef, useState } from 'react';
import { sameFormValues } from './model';

/**
 * What a drawer should do with the record values it has just computed.
 *
 * `false` is "nothing to do". `'seed'` fills the fields outright. `'merge'`
 * means the reader is part-way through editing this same record and somebody
 * else has saved it: the two copies are folded together field by field rather
 * than one of them being thrown away.
 */
export type FormSeedVerdict = false | 'seed' | 'merge';

/**
 * Guards a drawer's "seed the fields from the record" effect.
 *
 * Those effects have to depend on the entity collections they resolve a parent
 * chain out of (programmes, cohorts, groups), and those arrays get a new
 * identity on every background refresh -- the silent reload after a save, the
 * second pass of `useCurriculumEntities` when staff and holidays land, or the
 * Module Builder fetching its picker scope after the drawer is already open. Re-
 * running the seed then overwrote whatever the user had chosen, which is the
 * drawer "resetting itself" mid-edit.
 *
 * So the seed runs outright when the drawer opens on a record or while the form
 * is still untouched -- late-arriving data can finish filling a pristine form.
 * On a touched form it no longer stops: it merges, which is what lets two
 * people have the same cohort, group or module open at once. The rule that made
 * the old refusal safe is kept exactly, and is now applied per field rather
 * than per form -- an answer the reader gave is never thrown away.
 *
 * Call it inside the effect:
 * `const verdict = allowSeed(open, cohort?.id || 'new'); if (!verdict) return;`
 * The returned function is stable, so it is safe in a dependency array.
 */
export function useFormSeedGuard(dirty: boolean) {
  // The record the fields currently hold, or null while the drawer is closed.
  const seededKey = useRef<string | null>(null);
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;

  return useCallback((open: boolean, recordKey: string): FormSeedVerdict => {
    if (!open) {
      seededKey.current = null;
      return false;
    }
    // A different record (or a fresh open) always seeds outright: `dirty` at
    // that moment is measured against the *previous* record's baseline and
    // means nothing.
    const merging = seededKey.current === recordKey && dirtyRef.current;
    seededKey.current = recordKey;
    return merging ? 'merge' : 'seed';
  }, []);
}

/** One field this reader and somebody else both changed, said in English. */
export interface FormMergeNotice {
  field: string;
  text: string;
}

/**
 * Field-by-field co-editing for a drawer whose values live in separate pieces
 * of state.
 *
 * `take` is called once per field in the seeding effect, in place of handing
 * the record's value straight to the setter. On a plain seed it gives back the
 * record's value unchanged. On a merge it applies the same three rules the
 * module builder merges whole structures with:
 *
 * - the reader has not touched this field -> take the stored value, so their
 *   colleague's change appears in front of them;
 * - only the reader changed it -> keep theirs, because the other save carried
 *   the old value rather than an opinion about it;
 * - both changed it -> keep the reader's and say so. Their answer is never
 *   replaced by one they did not give.
 *
 * `baseline` is the values the form was last agreed with the record on -- the
 * same ref the drawer measures `dirty` against -- and this advances it as it
 * goes, so the next merge is measured against the record as it is stored now.
 */
export function useFormFieldMerge(
  baseline: { current: Record<string, unknown> },
  /**
   * The values the fields hold right now.
   *
   * A ref rather than the values themselves, and deliberately so: the seeding
   * effect must not re-run on every keystroke, which it would have to if the
   * field values were in its dependencies. This is read at the moment the
   * effect runs, which is the moment that matters.
   */
  live: { current: Record<string, unknown> },
  labels: Record<string, string> = {},
) {
  const [notices, setNotices] = useState<FormMergeNotice[]>([]);
  // Collected during the effect and published once, so a merge touching six
  // fields is one render and one banner rather than six of each.
  const pending = useRef<FormMergeNotice[]>([]);
  const labelsRef = useRef(labels);
  labelsRef.current = labels;

  const take = useCallback(<T,>(verdict: FormSeedVerdict, field: string, stored: T): T => {
    const current = live.current[field] as T;
    const advance = (value: T) => {
      baseline.current = { ...baseline.current, [field]: stored };
      return value;
    };
    if (verdict !== 'merge') return advance(stored);
    // Already agreed -- possibly because the reader typed their way to the same
    // answer. The baseline still moves, or the next merge would measure against
    // a value neither of them holds any more.
    if (sameFormValues({ value: stored }, { value: current })) return advance(current);
    const base = baseline.current[field] as T | undefined;
    const readerChanged = !sameFormValues({ value: base }, { value: current });
    const storedChanged = !sameFormValues({ value: base }, { value: stored });
    if (!readerChanged) return advance(stored);
    if (!storedChanged) return advance(current);
    const label = labelsRef.current[field] || field.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
    pending.current = [
      ...pending.current.filter(notice => notice.field !== field),
      { field, text: `You and someone else both changed the ${label}. Yours is kept.` },
    ];
    return advance(current);
  }, [baseline, live]);

  /**
   * Move the baseline onto the stored values for fields that were decided as
   * part of a group rather than one at a time.
   *
   * A composite -- a delivery slot, whose days and times only mean anything
   * together -- is merged once, and its members are then set from whichever
   * version won. Those members must still be measured against what is *stored*,
   * so passing the winning value back through `take` would be wrong twice over:
   * it would merge the same decision a second time, and it would leave the
   * baseline holding this reader's own value, which reads as "not dirty" and
   * lets the next refresh re-seed the drawer over their work.
   */
  const sync = useCallback((verdict: FormSeedVerdict, stored: Record<string, unknown>) => {
    if (!verdict) return;
    baseline.current = { ...baseline.current, ...stored };
  }, [baseline]);

  /** Call once at the end of the seeding effect. */
  const publish = useCallback(() => {
    const collected = pending.current;
    if (!collected.length) return;
    pending.current = [];
    setNotices(existing => [
      ...existing.filter(notice => !collected.some(item => item.field === notice.field)),
      ...collected,
    ]);
  }, []);

  const dismiss = useCallback(() => setNotices([]), []);

  return useMemo(() => ({ take, sync, publish, dismiss, notices }), [dismiss, notices, publish, sync, take]);
}

/**
 * Drawer state for a create/edit form: whether it is open, the form values, a
 * saving flag and the last save error. Lives apart from `ui.tsx` so that file
 * stays components-only (React Fast Refresh needs that split).
 */
export function useDrawerState<T>(initial: T) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<T>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // What the form held when it opened, so `dirty` below can spot unsaved edits.
  const baseline = useRef<T>(initial);

  const openWith = (next: T) => {
    baseline.current = next;
    setForm(next);
    setError(null);
    setSaving(false);
    setOpen(true);
  };

  return {
    open,
    form,
    saving,
    error,
    /** The open form carries edits that a save has not taken yet. */
    dirty: open && !sameFormValues(form as Record<string, unknown>, baseline.current as Record<string, unknown>),
    setForm,
    setSaving,
    setError,
    openWith,
    close: () => { if (!saving) setOpen(false); },
    patch: (patchValue: Partial<T>) => setForm(previous => ({ ...previous, ...patchValue })),
  };
}
