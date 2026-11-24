


/**
 * Auto save starts off, every time, on every module.
 *
 * Deliberately not remembered. A save on this endpoint replaces the whole
 * module -- every week, every component, every KSB mapping -- so the workspace
 * writing on its own is something the reader turns on for the module in front
 * of them, not a setting that follows them into the next one without being
 * asked for again.
 */

/**
 * What the workspace has done with the reader's edits.
 *
 * Kept as one value rather than a pair of booleans because the states are
 * genuinely exclusive and two of them are refusals -- a footer that reads
 * "Unsaved changes" after a save was turned down says nothing about why, and
 * "Saved" must never appear for a write the backend has not confirmed.
 */
export type WorkspaceSaveStatus = 'saved' | 'pending' | 'manual' | 'saving' | 'saving-more' | 'checking' | 'unconfirmed' | 'failed' | 'conflict' | 'locked';


export const WORKSPACE_SAVE_STATUS: Record<WorkspaceSaveStatus, { text: string; tone: string; icon: string }> = {
  saved: { text: 'All changes saved', tone: 'text-emerald-700', icon: 'ri-checkbox-circle-line' },
  pending: { text: 'Unsaved changes', tone: 'text-foreground-600', icon: 'ri-edit-line' },
  // Auto save is off, so nothing is coming to collect these edits. The sentence
  // has to name the thing the reader must do, not just report the state.
  manual: { text: 'Unsaved changes - press Save', tone: 'text-amber-700', icon: 'ri-edit-line' },
  saving: { text: 'Saving module structure...', tone: 'text-amber-700', icon: 'ri-loader-4-line animate-spin' },
  // The reader kept typing while a save was in flight. Those keystrokes are not
  // in the request that is running, and saying "Saving..." on its own would
  // claim they were.
  'saving-more': { text: 'Saving... later edits still pending', tone: 'text-amber-700', icon: 'ri-loader-4-line animate-spin' },
  failed: { text: 'Save failed - your changes are still here', tone: 'text-rose-700', icon: 'ri-error-warning-line' },
  checking: { text: 'Checking saved changes...', tone: 'text-amber-700', icon: 'ri-loader-4-line animate-spin' },
  unconfirmed: { text: 'Save not confirmed - your changes are still here', tone: 'text-amber-700', icon: 'ri-time-line' },
  // Reached only when a refused save could not be merged because the stored
  // version would not read. An ordinary conflict never gets this far: it is
  // merged and re-sent, and the footer goes back to saying "Saving...".
  conflict: { text: 'Not saved - the saved version could not be read', tone: 'text-rose-700', icon: 'ri-git-branch-line' },
  locked: { text: 'Read-only - archived programme', tone: 'text-amber-700', icon: 'ri-lock-line' },
};


/** A save the backend turned down. `conflict` is never worth retrying as-is. */
export type WorkspaceSaveFailure = { kind: 'error' | 'conflict' | 'unconfirmed'; message: string };


/**
 * What the Builder says, and the backend's refusal says, about an archived
 * programme. One sentence pair so the two never drift apart.
 */
export const ARCHIVED_PROGRAMME_BUILDER_NOTICE = 'This module belongs to an archived programme. Restore the programme, or move the module to a live programme, before editing its structure.';

/** Derive the existing status priority without scheduling or performing a save. */
export function workspaceSaveStatus({ workingModuleProgrammeArchived, saving, confirmingSave, savingSnapshot, workingModuleSnapshot, saveFailure, hasUnsavedWorkingModuleChanges, autoSaveEnabled }: {
  workingModuleProgrammeArchived: boolean;
  saving: boolean;
  confirmingSave: boolean;
  savingSnapshot: string;
  workingModuleSnapshot: string;
  saveFailure: WorkspaceSaveFailure | null;
  hasUnsavedWorkingModuleChanges: boolean;
  autoSaveEnabled: boolean;
}): WorkspaceSaveStatus {
  return workingModuleProgrammeArchived
    ? 'locked'
    : saving
      ? (confirmingSave ? 'checking' : savingSnapshot && workingModuleSnapshot !== savingSnapshot ? 'saving-more' : 'saving')
      : saveFailure?.kind === 'conflict'
        ? 'conflict'
        : saveFailure?.kind === 'unconfirmed'
          ? 'unconfirmed'
        : saveFailure
          ? 'failed'
          : !hasUnsavedWorkingModuleChanges
            ? 'saved'
            : autoSaveEnabled ? 'pending' : 'manual';
}
