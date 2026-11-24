import type { ModuleCatalogueItem } from '@/pages/curriculum/module-builder/moduleAuthoringData';
import { AppIcon } from '@/components/feature/AppIcon';
import {
  type WorkspaceSaveStatus,
  WORKSPACE_SAVE_STATUS,
  ARCHIVED_PROGRAMME_BUILDER_NOTICE,
} from '@/features/curriculum/module-authoring/model/saveState';
import { IconButton } from '@/features/curriculum/module-authoring/components/EditorPrimitives';


// Only the two states worth taking space for: a save in flight, and one that
// failed. A finished save says so in the footer and nowhere else.
export function SaveStatusPanel({ saving, confirming, unconfirmed, elapsedSeconds, error, module }: {
  saving: boolean;
  confirming: boolean;
  unconfirmed: boolean;
  elapsedSeconds: number;
  error: string | null;
  module: ModuleCatalogueItem;
}) {
  const componentCount = module.weekStructure.reduce((total, week) => total + week.components.length, 0);
  const tone = error && !unconfirmed ? 'red' : 'amber';
  const icon = error ? 'ri-error-warning-line' : 'ri-loader-4-line animate-spin';
  const title = confirming ? 'Checking saved changes' : unconfirmed ? 'Save not confirmed'
    : error ? 'Save failed' : elapsedSeconds > 8 ? 'Still saving module structure' : 'Saving module structure';
  const message = (confirming ? 'Checking whether your changes reached the LMS. Video copying continues separately.' : error)
    || `${module.weekStructure.length} weeks and ${componentCount} components are being written to the curriculum database. ${elapsedSeconds ? `${elapsedSeconds}s elapsed.` : ''}`;
  const classes = {
    amber: 'border-amber-200 bg-amber-50 text-amber-800',
    red: 'border-red-200 bg-red-50 text-red-800',
  }[tone];
  const barClass = { amber: 'bg-amber-500', red: 'bg-red-500' }[tone];

  return (
    <div className={`overflow-hidden rounded-xl border ${classes}`}>
      <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/70">
            <AppIcon className={`${icon} text-base`}></AppIcon>
          </span>
          <div className="min-w-0">
            <p className="text-[12px] font-heading font-bold">{title}</p>
            <p className="mt-0.5 text-[11px] font-semibold opacity-85">{message}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 text-[10px] font-bold uppercase">
          <span className="rounded-full bg-white/70 px-2.5 py-1">{module.weekStructure.length} weeks</span>
          <span className="rounded-full bg-white/70 px-2.5 py-1">{componentCount} components</span>
        </div>
      </div>
      {saving && (
        <div className="h-1.5 bg-white/60">
          <div className={`h-full w-2/3 animate-pulse rounded-r-full ${barClass}`} />
        </div>
      )}
    </div>
  );
}


export function WorkspaceActionFooter({ saving, saved, status, autoSave, onToggleAutoSave, locked = false, onEditModule, onDelete, onSave }: {
  saving: boolean;
  saved: boolean;
  /** What the workspace has done with the edits — the sentence in the footer. */
  status: WorkspaceSaveStatus;
  /** The workspace sends edits itself; off means Save is the only way out. */
  autoSave: boolean;
  onToggleAutoSave: () => void;
  /** The programme is archived, so the structure is read-only and Save is off. */
  locked?: boolean;
  /** Name, placement, dates and tutor — the shared module form. */
  onEditModule: () => void;
  /** Completion criteria, advanced details and module-level KSBs. */
  onModuleSettings: () => void;
  onDelete: () => void;
  onSave: () => void;
}) {
  const saveButtonIcon = saving ? 'ri-loader-4-line animate-spin' : saved ? 'ri-check-line' : 'ri-save-3-line';
  // "Save now" while the workspace is saving itself, because the button is then
  // for not waiting out the quiet period. With auto save off it is the only way
  // the module is written at all, so it says the plain thing.
  const saveButtonLabel = saving ? 'Saving module changes...' : saved ? 'Module saved' : autoSave ? 'Save module now' : 'Save module changes';
  // One sentence for the whole save pipeline. "Saved" is shown only for a write
  // the backend has confirmed — `saved` comes from the stored snapshot, which
  // moves on a successful reply and nothing else.
  const { text: stateText, tone: stateTone, icon: stateIcon } = WORKSPACE_SAVE_STATUS[status];

  return (
    <div className="sticky bottom-0 z-20 -mx-3 mt-2 border-t border-background-200/80 bg-background-50/95 px-3 py-3 shadow-[0_-12px_30px_rgba(15,23,42,0.08)] backdrop-blur sm:-mx-5 sm:px-5 lg:-mx-6 lg:px-6">
      <div className="mx-auto flex w-full max-w-[1840px] flex-wrap items-center justify-between gap-3 pr-0 lg:pr-44">
        <div className={`flex items-center gap-2 text-[12px] font-semibold ${stateTone}`}>
          <AppIcon className={stateIcon}></AppIcon>
          <span data-testid="module-builder-save-state">{stateText}</span>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={onToggleAutoSave}
            data-testid="module-builder-auto-save-toggle"
            aria-pressed={autoSave}
            disabled={locked}
            title={locked
              ? ARCHIVED_PROGRAMME_BUILDER_NOTICE
              : autoSave
                ? 'Auto save is on. Edits are saved a moment after you stop typing.'
                : 'Auto save is off. Your edits are kept here until you press Save module changes.'}
            className={`inline-flex h-10 items-center justify-center gap-1.5 rounded-lg border px-3 text-[12px] font-semibold transition-smooth disabled:cursor-not-allowed disabled:opacity-70 whitespace-nowrap ${autoSave
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
              : 'border-background-200 bg-background-50 text-foreground-600 hover:bg-background-100'}`}
          >
            <AppIcon className={autoSave ? 'ri-toggle-fill' : 'ri-toggle-line'}></AppIcon>
            Auto save{autoSave ? ' on' : ' off'}
          </button>
          <IconButton label="Edit module" icon="ri-edit-line" onClick={onEditModule} />
          <IconButton label="Archive module" icon="ri-archive-line" tone="danger" onClick={onDelete} />
          <button
            onClick={onSave}
            data-testid="module-builder-save"
            disabled={saving || locked}
            title={locked ? ARCHIVED_PROGRAMME_BUILDER_NOTICE : undefined}
            className={`inline-flex h-10 min-w-[120px] items-center justify-center gap-1.5 rounded-lg px-4 text-[12px] font-semibold text-white shadow-sm transition-smooth disabled:cursor-not-allowed disabled:opacity-70 whitespace-nowrap ${saved ? 'bg-emerald-500 hover:bg-emerald-600' : 'bg-primary-500 hover:bg-primary-600'}`}
          >
            <AppIcon className={saveButtonIcon}></AppIcon>{saveButtonLabel}
          </button>
        </div>
      </div>
    </div>
  );
}


export function ArchivedProgrammeBuilderNotice({ programmeName }: { programmeName?: string }) {
  return (
    <div role="status" className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] font-semibold text-amber-900">
      <div className="flex items-start gap-2">
        <AppIcon className="ri-archive-line mt-0.5 text-base"></AppIcon>
        <div className="min-w-0">
          <p>{ARCHIVED_PROGRAMME_BUILDER_NOTICE}</p>
          <p className="mt-1 font-medium text-amber-800">
            {programmeName ? `${programmeName} is archived. ` : ''}
            Everything below stays exactly as it was authored — it is read-only until the module has a live
            programme to belong to.
          </p>
        </div>
      </div>
    </div>
  );
}
