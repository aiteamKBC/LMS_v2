import type { CurriculumStaffProfile } from '@/lib/curriculumApi';
import { useState } from 'react';
import { isStaffAssigned, clean } from '@/features/curriculum/programme-detail/model/presentation';
import { groupCoachNames, joinCoachNames } from '@/pages/curriculum/shared/entities/groupCoaches';
import { MultiSelectControl } from '@/pages/curriculum/shared/entities/ui';
import { AppIcon } from '@/components/feature/AppIcon';

// A staffing slot that shows the assigned person, or an explicit "needs a coach"
// affordance that assigns one in place. Reading 'Unassigned' as plain body text
// was the main complaint: it looked like data rather than a gap to fix.
//
// Only ever used for a group's coach. A group has no tutor — that is assigned per
// module, in the module form — so there is no tutor slot on a group anywhere.
export function StaffSlot({
  role,
  icon,
  name,
  options,
  onAssign,
  saving,
  multiple = false,
}: {
  role: string;
  icon: string;
  name: string;
  options: CurriculumStaffProfile[];
  onAssign?: (value: string) => void | Promise<void>;
  saving?: boolean;
  /**
   * Several may hold the slot (a group's coaches): `name` is the names joined,
   * and `onAssign` is handed the chosen set joined the same way ('' = nobody).
   */
  multiple?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string[]>([]);
  const assigned = isStaffAssigned(name);
  const canEdit = Boolean(onAssign);
  const startEditing = () => {
    setDraft(groupCoachNames(name));
    setEditing(true);
  };
  // Several holders read "First" + a "+2" badge that never truncates: a cut-off
  // "First, Sec..." hid that there were more. The full list is the hover title.
  const holders = multiple ? groupCoachNames(name) : [];
  const slotLabel = holders.length > 1 ? holders[0] : clean(name);

  if (editing && canEdit && multiple) {
    const choices = groupCoachNames([
      ...options.map(option => clean(option.name) || clean(option.email) || String(option.id)),
      ...groupCoachNames(name),
    ]);
    const unchanged = joinCoachNames(draft) === joinCoachNames(groupCoachNames(name));
    return (
      <div
        // Wider than the Coach column so names are readable; it sits over the
        // next cell only while open.
        className="relative z-10 w-64 max-w-[calc(100vw-2rem)] space-y-2 self-center rounded-xl border border-primary-200 bg-background-50 p-2.5 shadow-lg"
        onClick={event => event.stopPropagation()}
        onKeyDown={event => { if (event.key === 'Escape' && !saving) setEditing(false); }}
        role="group"
        aria-label={`Choose the ${role.toLowerCase()}es`}
      >
        <MultiSelectControl
          value={draft}
          onChange={setDraft}
          options={choices.map(choice => ({ value: choice, label: choice }))}
          searchable={choices.length > 8}
          searchPlaceholder={`Search ${role.toLowerCase()}es...`}
          emptyMessage={`No ${role.toLowerCase()}es in the staff directory yet.`}
        />
        <div className="flex items-center justify-end gap-1.5">
          <button
            type="button"
            onClick={() => setEditing(false)}
            disabled={saving}
            className="h-8 rounded-lg border border-background-200 px-2.5 text-[11px] font-bold text-foreground-600 transition-smooth hover:bg-background-100 disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={saving || unchanged}
            onClick={async () => {
              await onAssign?.(joinCoachNames(draft));
              setEditing(false);
            }}
            className="h-8 rounded-lg bg-primary-600 px-2.5 text-[11px] font-bold text-white transition-smooth hover:bg-primary-700 disabled:opacity-40"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    );
  }

  if (editing && canEdit) {
    return (
      <div className="flex min-w-0 items-center gap-1.5 self-center" onClick={event => event.stopPropagation()}>
        <select
          autoFocus
          defaultValue=""
          disabled={saving}
          aria-label={`Assign ${role}`}
          onChange={async event => {
            const value = event.target.value;
            if (!value) return;
            await onAssign?.(value);
            setEditing(false);
          }}
          className="h-8 min-w-0 flex-1 rounded-lg border border-primary-300 bg-background-50 px-2 text-[11px] font-semibold text-foreground-900 outline-none focus:ring-2 focus:ring-primary-100"
        >
          <option value="">{saving ? 'Saving...' : `Select ${role.toLowerCase()}...`}</option>
          {options.map(option => {
            const label = clean(option.name) || clean(option.email) || String(option.id);
            return <option key={String(option.id)} value={label}>{label}</option>;
          })}
        </select>
        <button
          onClick={() => setEditing(false)}
          disabled={saving}
          aria-label="Cancel"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-background-200 text-foreground-500 transition-smooth hover:bg-background-100 disabled:opacity-40"
        >
          <AppIcon className="ri-close-line text-[13px]"></AppIcon>
        </button>
      </div>
    );
  }

  return (
    <span className="group/staff flex min-w-0 items-center gap-2 self-center" onClick={event => event.stopPropagation()}>
      <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg ${assigned ? 'bg-primary-50 text-primary-600' : 'bg-amber-50 text-amber-600'}`}>
        <AppIcon className={`${icon} text-[11px]`}></AppIcon>
      </span>
      {assigned ? (
        <span className="flex min-w-0 items-center gap-1" title={clean(name)}>
          <span className="min-w-0 truncate text-[12px] font-semibold text-foreground-800">{slotLabel}</span>
          {holders.length > 1 && (
            <span className="shrink-0 rounded-full bg-primary-50 px-1.5 text-[10px] font-bold text-primary-700">
              +{holders.length - 1}
            </span>
          )}
        </span>
      ) : canEdit ? (
        <button
          onClick={startEditing}
          className="inline-flex items-center gap-1 text-[12px] font-bold text-amber-700 transition-smooth hover:text-amber-800 hover:underline"
        >
          <AppIcon className="ri-add-circle-line text-[11px]"></AppIcon> Assign {role.toLowerCase()}
        </button>
      ) : (
        <span className="text-[12px] font-semibold text-amber-700">Not assigned</span>
      )}
      {assigned && canEdit && (
        <button
          onClick={startEditing}
          aria-label={multiple ? `Change ${role.toLowerCase()}es` : `Change ${role}`}
          title={multiple ? `Change ${role.toLowerCase()}es` : `Change ${role.toLowerCase()}`}
          className="ml-auto flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-foreground-400 opacity-0 transition-smooth hover:bg-background-100 hover:text-foreground-700 focus:opacity-100 group-hover/staff:opacity-100"
        >
          <AppIcon className="ri-pencil-line text-[11px]"></AppIcon>
        </button>
      )}
    </span>
  );
}
