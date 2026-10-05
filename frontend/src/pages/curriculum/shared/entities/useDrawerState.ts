import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchCurriculumRevisions, recordConflict, type CurriculumRecordKind } from '@/lib/curriculumApi';
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
    /** Take the given values as saved, so `dirty` reads against them; the form is untouched. */
    markSaved: (saved: T) => { baseline.current = saved; },
    close: () => { if (!saving) setOpen(false); },
    patch: (patchValue: Partial<T>) => setForm(previous => ({ ...previous, ...patchValue })),
  };
}

/**
 * How many times a save will rebase and try again before it stops and says so.
 *
 * Three, the same as the Module Builder's. A busy record is the normal reason
 * to be here, so one attempt is too few; an unbounded chain is a screen that
 * never finishes saving and never explains why.
 */
export const RECORD_REBASE_LIMIT = 3;

export interface RecordGuard<TRecord> {
  /**
   * The stored record a refusal handed back, for the seeding effect to merge
   * in place of the one the drawer was opened with. Null the rest of the time.
   */
  stored: TRecord | null;
  /** Changes when a refusal has been taken, to drive the retry. */
  rebase: number;
  /**
   * Run a save under the guard.
   *
   * `run` is given the token to send, or '' when this record has none -- a
   * record whose revision could not be read saves unguarded, exactly as it did
   * before any of this existed, rather than being blocked.
   *
   * Answers `{ saved: true }` when it landed. `{ saved: false }` means somebody
   * else got there first: the stored record is now on `stored` for the drawer
   * to merge, and the retry follows on the next render. Anything that is not a
   * concurrency refusal is re-thrown for the drawer's own error handling.
   */
  save: <T extends { revision?: string }>(
    run: (expectedRevision: string) => Promise<T>,
  ) => Promise<{ saved: boolean; result?: T }>;
  /** True once a save has given up after RECORD_REBASE_LIMIT rebases. */
  exhausted: boolean;
}

/**
 * Server-enforced concurrency for one record in a drawer.
 *
 * The drawer reads a token when it opens, sends it with every save, and is
 * refused rather than allowed to overwrite somebody who saved first. On a
 * refusal the stored record arrives with it, the drawer's existing field merge
 * folds this reader's outstanding changes into it, and the save runs again
 * against the new token.
 *
 * Nothing here depends on the live-update poll. Polling still decides how soon
 * a colleague's change *appears*; it no longer decides whether it survives.
 */
export function useRecordGuard<TRecord>(
  kind: CurriculumRecordKind,
  recordId: string | undefined,
  open: boolean,
): RecordGuard<TRecord> {
  const revisionRef = useRef('');
  const attemptsRef = useRef(0);
  const [stored, setStored] = useState<TRecord | null>(null);
  const [rebase, setRebase] = useState(0);
  const [exhausted, setExhausted] = useState(false);

  useEffect(() => {
    revisionRef.current = '';
    attemptsRef.current = 0;
    setStored(null);
    setExhausted(false);
    if (!open || !recordId) return undefined;
    const controller = new AbortController();
    // Wrapped rather than chained off the call: a token that cannot be read is
    // never a reason to stop somebody saving, and that has to hold however the
    // read fails -- including before it returns a promise at all. The drawer
    // then falls back to the unguarded write it has always done, and to the
    // poll-and-merge that was its only protection before any of this.
    (async () => {
      try {
        const revisions = await fetchCurriculumRevisions({ [kind]: [recordId] }, controller.signal);
        revisionRef.current = revisions[kind]?.[recordId] || '';
      } catch {
        revisionRef.current = '';
      }
    })();
    return () => controller.abort();
  }, [kind, open, recordId]);

  const save = useCallback(async <T extends { revision?: string }>(
    run: (expectedRevision: string) => Promise<T>,
  ): Promise<{ saved: boolean; result?: T }> => {
    try {
      const result = await run(revisionRef.current);
      revisionRef.current = result?.revision || '';
      attemptsRef.current = 0;
      setStored(null);
      return { saved: true, result };
    } catch (error) {
      const conflict = recordConflict<TRecord>(error, kind);
      if (!conflict) throw error;
      // Move onto the version that actually exists, whether or not a retry
      // follows: the next save must be measured against the record as stored.
      revisionRef.current = conflict.currentRevision;
      if (!conflict.record || attemptsRef.current >= RECORD_REBASE_LIMIT) {
        // Nothing to rebase onto, or this record is being written faster than
        // one person can answer. The edits are still in the form either way.
        attemptsRef.current = 0;
        setExhausted(true);
        throw error;
      }
      attemptsRef.current += 1;
      setStored(conflict.record);
      setRebase(count => count + 1);
      return { saved: false };
    }
  }, [kind]);

  return { stored, rebase, save, exhausted };
}

/**
 * Run `save` again once a refusal has been merged into the form.
 *
 * A ref rather than the function itself, because the retry has to send what the
 * merge produced -- and that only exists after the render the merge caused.
 * Declare this after the drawer's seeding effect so it runs after it in the
 * same commit.
 */
export function useRecordRebaseRetry(
  rebase: number,
  save: { current: (() => void | Promise<unknown>) | undefined },
) {
  useEffect(() => {
    if (!rebase) return undefined;
    // One turn later, and that is the whole point. The seeding effect merges by
    // calling the form's setters, so at the moment this runs the merged values
    // are scheduled but not yet rendered -- and `save.current` is still the
    // function that was refused, closed over the values that lost. Waiting for
    // that render is what makes the retry send the merge instead of repeating
    // the save the server has already turned down.
    const turn = setTimeout(() => { void save.current?.(); }, 0);
    return () => clearTimeout(turn);
    // `save` is a ref, deliberately not a dependency: this runs when a rebase
    // lands, never when the save function happens to be rebuilt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rebase]);
}
