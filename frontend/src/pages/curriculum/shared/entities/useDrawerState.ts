import { useCallback, useRef, useState } from 'react';
import { sameFormValues } from './model';

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
 * So the seed runs when the drawer opens on a record, and afterwards only while
 * the form is still untouched -- late-arriving data can finish filling a
 * pristine form, but it can never throw away an answer.
 *
 * Call it inside the effect: `if (!allowSeed(open, cohort?.id || 'new')) return;`
 * The returned function is stable, so it is safe in a dependency array.
 */
export function useFormSeedGuard(dirty: boolean) {
  // The record the fields currently hold, or null while the drawer is closed.
  const seededKey = useRef<string | null>(null);
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;

  return useCallback((open: boolean, recordKey: string) => {
    if (!open) {
      seededKey.current = null;
      return false;
    }
    // A different record (or a fresh open) always seeds: `dirty` at that moment
    // is measured against the *previous* record's baseline and means nothing.
    if (seededKey.current === recordKey && dirtyRef.current) return false;
    seededKey.current = recordKey;
    return true;
  }, []);
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
