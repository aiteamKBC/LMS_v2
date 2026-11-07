import { AppIcon } from '@/components/feature/AppIcon';
import type { ModuleConflict } from './moduleConflicts';

/**
 * The questions a save is waiting on.
 *
 * Shown above the workspace, never over it: the author can still scroll, read
 * and keep typing everywhere else while they decide. Each row is one thing two
 * people changed differently, and each has two named buttons. Until every row
 * is answered nothing is saved over the other editor -- auto-save waits, and
 * Save says why.
 */
export function ModuleConflictPanel({
  conflicts,
  onKeepMine,
  onUseTheirs,
  saveOtherFields = false,
}: {
  conflicts: ModuleConflict[];
  onKeepMine: (conflict: ModuleConflict) => void;
  onUseTheirs: (conflict: ModuleConflict) => void;
  saveOtherFields?: boolean;
}) {
  if (!conflicts.length) return null;
  return (
    <section
      data-testid="module-builder-conflicts"
      aria-labelledby="module-builder-conflicts-title"
      className="rounded-xl border border-amber-200/70 bg-amber-50 px-4 py-3 text-[12px] font-medium text-amber-900"
    >
      <h2 id="module-builder-conflicts-title" className="flex items-start gap-2 font-bold">
        <AppIcon className="ri-git-merge-line mt-0.5 shrink-0 text-base"></AppIcon>
        <span>
          {saveOtherFields ? 'Choose which version to keep for these fields. You can save other changes while these choices remain in your draft.' : conflicts.length === 1
            ? 'Someone else changed the same thing you did. Choose which version to keep before this module is saved.'
            : `Someone else changed ${conflicts.length} of the things you did. Choose which version to keep for each before this module is saved.`}
          {' '}Everything else they saved is already on this screen, and nothing of yours has been lost.
        </span>
      </h2>
      <ul className="mt-2 space-y-2">
        {conflicts.map(conflict => (
          <li
            key={conflict.key}
            data-testid="module-builder-conflict"
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-white/70 px-3 py-2"
          >
            <span className="min-w-0 flex-1">{conflict.question}</span>
            <span className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() => onKeepMine(conflict)}
                className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 font-bold text-amber-800 hover:bg-amber-100"
              >
                {conflict.kind === 'local-deleted' ? 'Keep it deleted' : 'Keep mine'}
              </button>
              <button
                type="button"
                onClick={() => onUseTheirs(conflict)}
                className="rounded-lg px-3 py-1.5 font-bold text-amber-800 hover:bg-amber-100"
              >
                {conflict.kind === 'local-deleted' ? 'Restore theirs' : conflict.kind === 'remote-deleted' ? 'Delete it' : 'Use theirs'}
              </button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
