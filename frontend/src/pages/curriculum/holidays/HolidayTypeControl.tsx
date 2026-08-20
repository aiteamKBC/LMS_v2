import { useState } from 'react';
import { AppIcon } from '@/components/feature/AppIcon';
import { normaliseKey } from '../shared/entities/model';

// ============================================================================
// The Type picker inside the holiday drawer.
//
// A holiday type is not a record of its own anywhere: it is the `type` text on
// the holiday row in the `holidays` table, and the colour beside it is that
// row's colour. So every row below is a type the calendar actually uses (or one
// added here and not saved yet), which is what makes rename and remove mean
// something — they rewrite the holidays that carry it. The page owns those
// writes; this file only asks for them.
//
// The familiar names (Bank holiday, Christmas, ...) are therefore *suggestions*
// in the add form rather than rows in the list: a name nobody has used is not a
// type yet, and showing it as one leaves a row that cannot be edited or removed.
// ============================================================================

export interface HolidayTypeOption {
  /** Exactly the text stored in the holiday's `type` column. */
  name: string;
  color: string;
  /** How many saved holidays carry it. 0 means it was added here and is not saved yet. */
  usedBy: number;
  /** Added in this session; it becomes real when the holiday is saved. */
  draft?: boolean;
}

const DEFAULT_DRAFT_COLOR = '#6d28d9';

export function HolidayTypeControl({
  types,
  suggestions,
  value,
  disabled,
  onSelect,
  onCreate,
  onRename,
  onDelete,
}: {
  types: HolidayTypeOption[];
  /** Ready-made names for the add form, already filtered to the unused ones. */
  suggestions: Array<{ name: string; color: string }>;
  /** The selected type, as stored on the holiday. */
  value: string;
  disabled?: boolean;
  onSelect: (type: HolidayTypeOption) => void;
  onCreate: (name: string, color: string) => void;
  onRename: (type: HolidayTypeOption, name: string, color: string) => void;
  onDelete: (type: HolidayTypeOption) => void;
}) {
  // '' closed, 'new' adding a type, otherwise the name of the type being edited.
  const [editing, setEditing] = useState('');
  const [draftName, setDraftName] = useState('');
  const [draftColor, setDraftColor] = useState(DEFAULT_DRAFT_COLOR);
  const [formError, setFormError] = useState('');

  const formOpen = Boolean(editing);
  const editingType = editing && editing !== 'new'
    ? types.find(type => normaliseKey(type.name) === normaliseKey(editing))
    : undefined;

  const closeForm = () => {
    setEditing('');
    setDraftName('');
    setFormError('');
    setDraftColor(DEFAULT_DRAFT_COLOR);
  };

  const openNewForm = () => {
    setEditing('new');
    setDraftName('');
    setDraftColor(DEFAULT_DRAFT_COLOR);
    setFormError('');
  };

  const openEditForm = (type: HolidayTypeOption) => {
    setEditing(type.name);
    setDraftName(type.name);
    setDraftColor(type.color || DEFAULT_DRAFT_COLOR);
    setFormError('');
  };

  const submitForm = () => {
    const name = draftName.trim();
    if (!name) { setFormError('Give the type a name.'); return; }
    // A second type spelled the same way would be indistinguishable in the list
    // and in the filter, so the name has to be free — unless it is this type's
    // own name, which a colour-only edit keeps.
    const clash = types.some(type => normaliseKey(type.name) === normaliseKey(name)
      && normaliseKey(type.name) !== normaliseKey(editingType?.name || ''));
    if (clash) { setFormError(`"${name}" is already in the list.`); return; }
    if (editingType) onRename(editingType, name, draftColor);
    else onCreate(name, draftColor);
    closeForm();
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-bold uppercase tracking-wider text-foreground-400">Type</span>
        <button
          type="button"
          onClick={formOpen ? closeForm : openNewForm}
          disabled={disabled}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-background-200 bg-background-50 px-2.5 text-[11px] font-bold text-foreground-700 transition-smooth hover:bg-background-100 disabled:opacity-50"
        >
          <AppIcon className={formOpen ? 'ri-close-line text-sm' : 'ri-add-line text-sm'}></AppIcon>
          {formOpen ? 'Close' : 'New type'}
        </button>
      </div>

      {formOpen && (
        <div className="space-y-2.5 rounded-xl border border-background-200 bg-background-100/60 p-3">
          <p className="text-[10px] font-bold uppercase tracking-wider text-foreground-400">
            {editingType ? `Editing “${editingType.name}”` : 'New type'}
          </p>
          <input
            value={draftName}
            onChange={event => { setDraftName(event.target.value); setFormError(''); }}
            placeholder="e.g. Exam week"
            autoFocus
            className="h-10 w-full rounded-lg border border-background-200 bg-background-50 px-3 text-[13px] text-foreground-900 transition-smooth placeholder:text-foreground-300 focus:border-primary-300 focus:outline-none"
          />
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={/^#[0-9a-f]{6}$/i.test(draftColor) ? draftColor : DEFAULT_DRAFT_COLOR}
              onChange={event => setDraftColor(event.target.value)}
              aria-label="Type colour"
              className="h-10 w-14 shrink-0 cursor-pointer rounded-lg border border-background-200 bg-background-50 p-1"
            />
            <span
              className="min-w-0 flex-1 truncate rounded-lg border px-3 py-2.5 text-[12px] font-bold"
              style={{ borderColor: draftColor, color: draftColor, backgroundColor: `${draftColor}14` }}
            >
              {draftName.trim() || 'Type preview'}
            </span>
          </div>

          {!editingType && suggestions.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-foreground-400">Or start from</span>
              {suggestions.map(suggestion => (
                <button
                  key={suggestion.name}
                  type="button"
                  onClick={() => {
                    setDraftName(suggestion.name);
                    setDraftColor(suggestion.color);
                    setFormError('');
                  }}
                  className="inline-flex items-center gap-1.5 rounded-full border border-background-200 bg-background-50 px-2.5 py-1 text-[11px] font-semibold text-foreground-600 transition-smooth hover:bg-background-100"
                >
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: suggestion.color }} />
                  {suggestion.name}
                </button>
              ))}
            </div>
          )}

          {formError && <p className="text-[11px] font-semibold text-red-600">{formError}</p>}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={submitForm}
              disabled={disabled}
              className="inline-flex h-9 flex-1 items-center justify-center rounded-lg bg-primary-600 px-3 text-[12px] font-bold text-white transition-smooth hover:bg-primary-700 disabled:opacity-60"
            >
              {editingType ? 'Save type' : 'Add type'}
            </button>
            <button
              type="button"
              onClick={closeForm}
              className="inline-flex h-9 items-center justify-center rounded-lg border border-background-200 bg-background-50 px-3 text-[12px] font-bold text-foreground-600 transition-smooth hover:bg-background-100"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {types.length === 0 ? (
        <p className="rounded-lg border border-dashed border-background-300 bg-background-100/60 px-3 py-3 text-[12px] text-foreground-500">
          No types yet. Add one to label this holiday — every holiday that uses it will show its colour.
        </p>
      ) : (
        <div className="max-h-56 space-y-1.5 overflow-y-auto">
          {types.map(type => {
            const selected = normaliseKey(type.name) === normaliseKey(value);
            return (
              <div
                key={normaliseKey(type.name)}
                className={`flex items-center gap-1 rounded-lg border px-2.5 py-1.5 transition-smooth ${
                  selected ? 'border-primary-300 bg-primary-50' : 'border-background-200 bg-background-50 hover:bg-background-100'
                }`}
              >
                <button
                  type="button"
                  onClick={() => onSelect(type)}
                  disabled={disabled}
                  aria-pressed={selected}
                  className="flex min-w-0 flex-1 items-center gap-2 py-1 text-left disabled:opacity-60"
                >
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: type.color || DEFAULT_DRAFT_COLOR }} />
                  <span className={`truncate text-[12px] font-semibold ${selected ? 'text-primary-800' : 'text-foreground-800'}`}>
                    {type.name}
                  </span>
                  {type.usedBy > 0 ? (
                    <span className="shrink-0 rounded-full bg-background-200/70 px-1.5 text-[10px] font-bold text-foreground-500">
                      {type.usedBy}
                    </span>
                  ) : (
                    <span className="shrink-0 text-[10px] font-bold uppercase text-amber-600">unsaved</span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => openEditForm(type)}
                  disabled={disabled}
                  aria-label={`Edit type ${type.name}`}
                  title={`Rename or recolour ${type.name}`}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-foreground-400 transition-smooth hover:bg-background-200 hover:text-foreground-700 disabled:opacity-50"
                >
                  <AppIcon className="ri-pencil-line text-sm"></AppIcon>
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(type)}
                  disabled={disabled}
                  aria-label={`Delete type ${type.name}`}
                  title={`Remove ${type.name}`}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-foreground-400 transition-smooth hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                >
                  <AppIcon className="ri-delete-bin-line text-sm"></AppIcon>
                </button>
                {selected && <AppIcon className="ri-check-line shrink-0 text-primary-600"></AppIcon>}
              </div>
            );
          })}
        </div>
      )}

      <p className="text-[11px] text-foreground-400">
        {value
          ? 'The type’s colour is used for this holiday wherever it appears.'
          : 'Pick a type, or add one of your own. A holiday can be saved without one.'}
      </p>
    </div>
  );
}
