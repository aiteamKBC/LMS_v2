import { useCurriculumArchive } from './archiveView.helpers';
// ============================================================================
// The archive view, shared by the Cohorts and Groups pages.
//
// Archiving a cohort or a group has always been a soft delete: the row keeps
// its place in the database and only leaves the active list. Nothing in the app
// read that state back, so from the user's side "Archive" was a delete with no
// undo and no way to finish it either. This is the other side of it — the same
// toggle, the same banner and the same load-on-open behaviour on both pages, so
// the archive is one idea rather than two implementations that drift.
//
// What differs between the two pages is only the table: an archived cohort and
// an archived group carry different columns. That stays with each page, next to
// the live table it mirrors. The confirms live in `archive.ts` alongside the
// ones that put a record into the archive in the first place.
// ============================================================================

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppIcon } from '@/components/feature/AppIcon';
import { HERO_SECONDARY_BUTTON_CLASS } from './ui';

/**
 * The hero button that opens the archive, and says how much is in it.
 *
 * Styled for the page hero rather than the filter bar because that is where the
 * other whole-list actions are ("Add Cohort", the guided run) and a reader
 * looking for a record that is no longer in the table looks there first. The
 * count is on the button itself so an empty archive is visible without opening
 * it — until it has been opened once there is nothing to count, and the badge
 * stays off rather than claiming a zero it has not checked.
 */
export function ArchiveToggleButton({ active, count, onToggle, label = 'View archived' }: {
  active: boolean;
  count: number | null;
  onToggle: () => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={active}
      className={active
        ? 'inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-amber-300 bg-amber-100 px-4 text-[12px] font-bold text-amber-900 shadow-sm shadow-amber-900/10 transition-smooth hover:bg-amber-200'
        : HERO_SECONDARY_BUTTON_CLASS}
    >
      <AppIcon className={`${active ? 'ri-arrow-go-back-line' : 'ri-archive-line'} text-base`}></AppIcon>
      {active ? 'Back to active list' : label}
      {count !== null && (
        <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-black ${active
          ? 'bg-amber-200 text-amber-950'
          : 'bg-primary-100 text-primary-800'}`}
        >
          {count}
        </span>
      )}
    </button>
  );
}

/**
 * What the archive is, said once for the page rather than per row: these two
 * buttons do very different things and only one of them can be undone.
 */
export function ArchiveNotice({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-amber-200/70 bg-amber-50 px-4 py-3 text-[12px] font-medium leading-5 text-amber-800">
      {children}
    </div>
  );
}
