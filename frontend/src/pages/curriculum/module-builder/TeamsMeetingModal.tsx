import { LoadingSkeleton } from '@/components/feature/LoadingSkeleton';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Modal } from '@/pages/users/components/Modal';
import { cleanText } from '../shared/entities/model';
import { TeamsMeetingDialogs } from '../teams-meetings/TeamsMeetingDialogs';
import { useTeamsMeetingsWorkspace } from '../teams-meetings/useTeamsMeetingsWorkspace';
import { loadModuleStructure, type ModuleCatalogueItem } from './moduleAuthoringData';
import { WeekTeamsMeetingPanel } from './WeekTeamsMeetingForm';

// The module the calendar belongs to. Its catalogue id selects the calendar; the
// placement fields are kept for callers that already pass them.
export type TeamsMeetingModuleContext = ModuleCatalogueItem & {
  programmeName?: string;
  cohort?: string;
  group?: string;
};

const UNSAVED_WEEK_MEETING_REASON = 'This module has unsaved changes. An additional meeting is attached to a live session as it is STORED, so a week or a live session that exists only in this tab has nothing to attach to. Close this, press Save, then reopen the calendar.';

const UNSAVED_REASON = 'This module has unsaved changes. Close this window, press Save in Module Builder, then reopen Teams. Save draft only saves this meeting form.';
const SAVE_MODULE_REASON = 'This module has unsaved changes. Save the module below to continue. The people and settings entered here will be kept. Save draft only saves this meeting form.';

/**
 * A module's Teams calendar, opened from the Module Builder.
 *
 * Exactly the Teams Meetings page's dialog, for this one module: the same
 * create form, the same detail view, the same Update / Edit session dates /
 * Cancel series / Edit invitations / Edit meeting settings / sync actions, the
 * same backend calls. Both screens render `TeamsMeetingDialogs` over
 * `useTeamsMeetingsWorkspace`, so there is one implementation to keep right.
 *
 * What is genuinely this door's own:
 *
 * * Unsaved work blocks every write. The calendar is created from the module's
 *   STORED sessions and links back into them, so a session that exists only in
 *   this tab would leave Teams holding a date the module does not have.
 * * After any write, the module is read back from the server and handed to
 *   `onRestored`, so the builder shows the join links and dates the write just
 *   stored. Writes are blocked while there is unsaved work, so this never
 *   replaces anything the author typed.
 * * When the dialog and everything it opened have closed, `onClose` runs.
 */
export function TeamsMeetingModal({
  module,
  unsavedChanges = false,
  initialWeekId = '',
  onClose,
  onRestored,
  onSaveModule,
  moduleSaving = false,
  moduleSaveError,
}: {
  module: TeamsMeetingModuleContext;
  unsavedChanges?: boolean;
  /** Opened from one live session's editor: the additional-meeting tab starts on that week. */
  initialWeekId?: string;
  onClose: () => void;
  onRestored?: (module: ModuleCatalogueItem) => void;
  /** Uses the builder's normal save pipeline without closing this meeting form. */
  onSaveModule?: () => Promise<ModuleCatalogueItem | null>;
  moduleSaving?: boolean;
  moduleSaveError?: string | null;
}) {
  const catalogueId = cleanText(module.catalogueId);
  const onRestoredRef = useRef(onRestored);
  onRestoredRef.current = onRestored;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const saveInFlight = useRef(false);
  const [savingModule, setSavingModule] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [calendarRefreshError, setCalendarRefreshError] = useState('');
  const saving = savingModule || moduleSaving;
  const blockedReason = saving
    ? 'Saving the module. Your meeting edits are kept; wait for the save and calendar check to finish.'
    : calendarRefreshError || (unsavedChanges ? onSaveModule ? SAVE_MODULE_REASON : UNSAVED_REASON : '');

  const readBack = useCallback(async () => {
    try {
      const fresh = await loadModuleStructure(catalogueId, { skipCache: true });
      if (fresh) onRestoredRef.current?.(fresh);
    } catch {
      // The calendar change itself is saved; the builder catches up on its next
      // load. Nothing here is worth interrupting the result dialog for.
    }
  }, [catalogueId]);

  const workspace = useTeamsMeetingsWorkspace({
    scopeModuleId: catalogueId,
    initialSelectedId: catalogueId,
    blockedReason,
    onCalendarChanged: () => { void readBack(); },
  });

  const saveModuleAndContinue = async () => {
    if (!onSaveModule || saveInFlight.current || moduleSaving) return;
    saveInFlight.current = true;
    setSavingModule(true);
    setSaveFailed(false);
    setSaveError('');
    setCalendarRefreshError('');
    try {
      if (unsavedChanges && !await onSaveModule()) {
        setSaveFailed(true);
        return;
      }
      // Refresh the saved plan without re-opening the dialog or resetting its
      // invitation form. Saving the module alone never sends these Teams edits.
      if (!await workspace.loadTeamsState()) {
        setCalendarRefreshError('The module was saved, but its calendar could not be reloaded. Retry the calendar check. Your meeting edits are kept.');
      }
    } catch (error) {
      setSaveFailed(true);
      setSaveError(error instanceof Error ? error.message : 'The module could not be saved. Your meeting edits are kept. Retry saving.');
    } finally {
      saveInFlight.current = false;
      setSavingModule(false);
    }
  };

  // Something of the workspace is on screen: the dialog, an action opened from
  // it, one of its drawers or a recording/transcript preview.
  const open = Boolean(workspace.selectedId || workspace.calendarActionTarget || workspace.drawerOpen
    || workspace.preview || workspace.transcriptPreview);
  useEffect(() => {
    if (!open) onCloseRef.current();
  }, [open]);

  const loadingRow = !workspace.selected && (!workspace.loaded || !workspace.teamsLoaded || workspace.teamsLoading);
  if (workspace.selectedId && !workspace.selected) {
    return (
      <Modal title={cleanText(module.title) || 'Teams meeting'} size="max-w-3xl" onClose={onClose}>
        {loadingRow ? (
          <p className="flex items-center gap-1.5 rounded-xl border border-background-200 bg-background-100/60 p-3 text-[11px] font-semibold text-foreground-500"><LoadingSkeleton label="Loading this module&rsquo;s calendar and session dates…" variant="rows" /></p>
        ) : workspace.teamsError || workspace.error ? (
          <p role="alert" className="text-sm text-red-700">{workspace.teamsError || workspace.error}</p>
        ) : (
          <p className="text-[12px] text-foreground-600">
            This module is not in the saved curriculum yet, so it has no Teams calendar to show. Save the module, then open its calendar again.
          </p>
        )}
      </Modal>
    );
  }
  return (
    <TeamsMeetingDialogs
      workspace={workspace}
      moduleSaveAction={onSaveModule && (unsavedChanges || saving || calendarRefreshError) ? {
        saving,
        label: saving ? 'Saving module…' : unsavedChanges ? 'Save module and continue' : 'Retry calendar check',
        error: calendarRefreshError || (saveFailed ? moduleSaveError || saveError || 'The module was not fully saved. Your meeting edits are kept. Check the module validation or editing conflicts, then retry.' : ''),
        onSave: () => { void saveModuleAndContinue(); },
      } : undefined}
      /* The second door's second door. The tab above it is the module's own
         calendar, unchanged — this one books a separate meeting on a single
         week and never touches that calendar. */
      secondTab={{
        label: 'Additional week meeting',
        subtitle: 'A separate meeting on one week — its own organiser, guests and link',
        render: () => (
          <WeekTeamsMeetingPanel
            module={module}
            initialWeekId={initialWeekId}
            blockedReason={saving || calendarRefreshError ? blockedReason : unsavedChanges ? UNSAVED_WEEK_MEETING_REASON : ''}
            graphConfigured={workspace.graphConfigured}
            onCreated={() => { void readBack(); }}
          />
        ),
      }}
    />
  );
}
