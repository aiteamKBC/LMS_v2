import { useRef, useState } from 'react';
import { sameFormValues } from './model';

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
