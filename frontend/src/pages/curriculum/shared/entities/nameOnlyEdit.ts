import { sameFormValues } from './model';

/** A rename must not submit defaults or derived delivery fields as edits. */
export function isNameOnlyEdit(
  current: Record<string, unknown>,
  baseline: Record<string, unknown>,
): boolean {
  return current.name !== baseline.name
    && sameFormValues({ ...current, name: '' }, { ...baseline, name: '' });
}
