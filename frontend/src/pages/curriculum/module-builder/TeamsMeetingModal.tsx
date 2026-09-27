import { useCallback, useEffect, useRef } from 'react';
import { AppIcon } from '@/components/feature/AppIcon';
import { Modal } from '@/pages/users/components/Modal';
import { cleanText } from '../shared/entities/model';
import { TeamsMeetingDialogs } from '../teams-meetings/TeamsMeetingDialogs';
import { useTeamsMeetingsWorkspace } from '../teams-meetings/useTeamsMeetingsWorkspace';
import { loadModuleStructure, type ModuleCatalogueItem } from './moduleAuthoringData';

// The module the calendar belongs to. Its catalogue id selects the calendar; the
// placement fields are kept for callers that already pass them.
export type TeamsMeetingModuleContext = ModuleCatalogueItem & {
  programmeName?: string;
  cohort?: string;
  group?: string;
};

const UNSAVED_REASON = 'This module has unsaved changes. The Teams calendar is built from the module’s saved sessions and writes its join links back into them, so nothing here can be sent until the module is saved. Close this, press Save, then reopen the calendar. Viewing and syncing still work.';

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
  onClose,
  onRestored,
}: {
  module: TeamsMeetingModuleContext;
  unsavedChanges?: boolean;
  onClose: () => void;
  onRestored?: (module: ModuleCatalogueItem) => void;
}) {
  const catalogueId = cleanText(module.catalogueId);
  const onRestoredRef = useRef(onRestored);
  onRestoredRef.current = onRestored;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

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
    blockedReason: unsavedChanges ? UNSAVED_REASON : '',
    onCalendarChanged: () => { void readBack(); },
  });

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
          <p className="flex items-center gap-1.5 rounded-xl border border-background-200 bg-background-100/60 p-3 text-[11px] font-semibold text-foreground-500">
            <AppIcon className="ri-loader-4-line animate-spin"></AppIcon>
            Loading this module&rsquo;s calendar and session dates…
          </p>
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
  return <TeamsMeetingDialogs workspace={workspace} />;
}
