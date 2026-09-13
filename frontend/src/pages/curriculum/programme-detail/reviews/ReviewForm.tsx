// Add / Edit Review -- a large structured modal, sectioned (General, Schedule,
// Eligibility, Participants & Permissions, Form Builder) rather than a page
// route, matching how other multi-part curriculum configuration is authored in
// a dedicated surface without adding a new router path for a query-param tab.
//
// The Form Builder section models the real shape a Review's questions take:
// Section -> Field -> optional IF YES / IF NO conditional children (only on a
// "Boolean with case block" field). This mirrors the backend's
// sections[].fields[].(yesFields|noFields) payload one-for-one.
import { useEffect, useMemo, useRef, useState } from 'react';
import { AppIcon } from '@/components/feature/AppIcon';
import { showCurriculumAlert, showCurriculumConfirm } from '@/components/feature/CurriculumSweetAlert';
import { Modal } from '@/pages/users/components/Modal';
import {
  CONDITIONAL_FIELD_TYPE,
  CURRICULUM_PROGRAMME_STATUSES,
  CurriculumApiError,
  DISPLAY_ONLY_FIELD_TYPES,
  REVIEW_FIELD_TYPE_LABELS,
  REVIEW_FIELD_TYPES,
  createReviewTemplate,
  fetchReviewDetail,
  updateReviewTemplate,
  type CreateReviewInput,
  type ListItemConfiguration,
  type ReviewDetail,
  type ReviewField,
  type ReviewFieldInput,
  type ReviewFieldType,
  type ReviewNotificationFlags,
  type ReviewParticipantRole,
  type ReviewRecurrenceUnit,
  type ReviewRoleFlags,
  type ReviewSection,
  type ReviewSectionInput,
  type ReviewSummary,
  type TitleDescriptionConfiguration,
} from '@/lib/curriculumApi';
import { FormField, MultiSelectControl, SelectControl, TextAreaControl, TextControl } from '@/pages/curriculum/shared/entities/ui';

const SECTIONS = ['General', 'Schedule', 'Eligibility', 'Participants & Permissions', 'Form Builder'] as const;
type Section = typeof SECTIONS[number];

const ROLES: ReviewParticipantRole[] = ['advisor', 'employer', 'participant', 'referrer'];
const ROLE_LABEL: Record<ReviewParticipantRole, string> = {
  advisor: 'Advisor', employer: 'Employer', participant: 'Participant', referrer: 'Referrer',
};
const RECURRENCE_UNITS: ReviewRecurrenceUnit[] = ['days', 'weeks', 'months'];

// A "Post code and Address" field always collects this fixed set of lines
// together, as one answer -- there is nothing to configure, this is shown
// purely so the person building the form can see what it captures.
const POSTCODE_ADDRESS_SUBFIELDS = ['Address line 1', 'Address line 2', 'City', 'County', 'Postcode'];

function isDisplayOnly(fieldType: ReviewFieldType): boolean {
  return (DISPLAY_ONLY_FIELD_TYPES as ReviewFieldType[]).includes(fieldType);
}

// --------------------------------------------------------------- draft model
// Local editing state mirrors ReviewSectionInput/ReviewFieldInput, plus a
// stable local `key` per row (never sent to the backend) so React can track
// identity across add/remove/reorder without relying on ids that may not
// exist yet for a brand-new row.

let keySeed = 0;
function nextKey(prefix: string): string {
  keySeed += 1;
  return `${prefix}-${keySeed}-${Math.random().toString(36).slice(2)}`;
}

interface DraftField extends Omit<ReviewFieldInput, 'yesFields' | 'noFields'> {
  key: string;
  yesFields: DraftField[];
  noFields: DraftField[];
}

interface DraftSection extends Omit<ReviewSectionInput, 'fields'> {
  key: string;
  fields: DraftField[];
}

function newDraftField(): DraftField {
  return { key: nextKey('field'), title: '', fieldType: 'text', required: false, configuration: {}, yesFields: [], noFields: [] };
}

function newDraftSection(): DraftSection {
  return { key: nextKey('section'), title: '', estimatedMinutes: 0, enabled: true, fields: [] };
}

function fieldToDraft(field: ReviewField): DraftField {
  return {
    key: field.id,
    id: field.id,
    title: field.title,
    fieldType: field.fieldType,
    required: field.required,
    configuration: field.configuration || {},
    yesFields: (field.yesFields || []).map(fieldToDraft),
    noFields: (field.noFields || []).map(fieldToDraft),
  };
}

function sectionToDraft(section: ReviewSection): DraftSection {
  return {
    key: section.id,
    id: section.id,
    title: section.title,
    estimatedMinutes: section.estimatedMinutes,
    enabled: section.enabled,
    fields: section.fields.map(fieldToDraft),
  };
}

function stripDraftField(field: DraftField): ReviewFieldInput {
  const { key: _key, yesFields, noFields, ...rest } = field;
  const base: ReviewFieldInput = { ...rest };
  if (field.fieldType === CONDITIONAL_FIELD_TYPE) {
    base.yesFields = yesFields.map(stripDraftField);
    base.noFields = noFields.map(stripDraftField);
  }
  return base;
}

function stripDraftSection(section: DraftSection): ReviewSectionInput {
  const { key: _key, fields, ...rest } = section;
  return { ...rest, fields: fields.map(stripDraftField) };
}

function emptyRoleFlags(): ReviewRoleFlags {
  return { advisor: false, employer: false, participant: false, referrer: false };
}

// ------------------------------------------------------------- small pieces

function CheckboxRow({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (value: boolean) => void; hint?: string }) {
  return (
    <label className="flex items-start gap-2.5 rounded-lg border border-background-200 bg-background-50 px-3 py-2.5 transition-smooth hover:bg-background-100">
      <input
        type="checkbox"
        checked={checked}
        onChange={event => onChange(event.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 rounded border-background-300 text-primary-600 focus:ring-primary-300"
      />
      <span>
        <span className="block text-[12px] font-semibold text-foreground-900">{label}</span>
        {hint && <span className="block text-[11px] text-foreground-400">{hint}</span>}
      </span>
    </label>
  );
}

function RoleFlagGrid({ label, hint, value, onChange }: { label: string; hint?: string; value: ReviewRoleFlags; onChange: (value: ReviewRoleFlags) => void }) {
  return (
    <FormField label={label} hint={hint} as="group">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {ROLES.map(role => (
          <CheckboxRow
            key={role}
            label={ROLE_LABEL[role]}
            checked={value[role]}
            onChange={checked => onChange({ ...value, [role]: checked })}
          />
        ))}
      </div>
    </FormField>
  );
}

function OptionListEditor({ options, onChange }: { options: string[]; onChange: (options: string[]) => void }) {
  const [draft, setDraft] = useState('');
  const addOption = () => {
    const value = draft.trim();
    if (!value || options.includes(value)) { setDraft(''); return; }
    onChange([...options, value]);
    setDraft('');
  };
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {options.map((option, index) => (
          <span key={`${option}-${index}`} className="inline-flex items-center gap-1.5 rounded-full border border-background-200 bg-background-100 px-2.5 py-1 text-[11px] font-semibold text-foreground-700">
            {option}
            <button
              type="button"
              aria-label={`Remove option ${option}`}
              onClick={() => onChange(options.filter((_, i) => i !== index))}
              className="text-foreground-400 hover:text-red-600"
            >
              <AppIcon className="ri-close-line text-xs"></AppIcon>
            </button>
          </span>
        ))}
        {options.length === 0 && <span className="text-[11px] text-foreground-400">No options added yet.</span>}
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          value={draft}
          onChange={event => setDraft(event.target.value)}
          onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); addOption(); } }}
          placeholder="Add an option"
          aria-label="New list option"
          className="h-9 w-full rounded-lg border border-background-200 bg-background-50 px-3 text-[12px] text-foreground-900 outline-none focus:border-primary-300"
        />
        <button type="button" onClick={addOption} className="inline-flex h-9 shrink-0 items-center gap-1 rounded-lg border border-background-200 bg-background-50 px-3 text-[11px] font-bold text-foreground-700 hover:bg-background-100">
          <AppIcon className="ri-add-line"></AppIcon>
          Add
        </button>
      </div>
    </div>
  );
}

// --------------------------------------------------------------- field row

// A field's own depth counts from 0 at the top of a section. Once a field
// sits at MAX_FIELD_NESTING_DEPTH it cannot itself become a case block --
// its children would land past the backend's recursion cap (reviews.py's
// MAX_FIELD_NESTING_DEPTH) -- so the type option is disabled before that
// ever reaches a save-time error.
const MAX_FIELD_NESTING_DEPTH = 8;

function FieldRow({ field, path, index, total, depth, errors, onChange, onRemove, onMove }: {
  field: DraftField;
  /** Dotted/bracketed location matching the backend's error keys, e.g. sections[0].fields[1]. */
  path: string;
  index: number;
  total: number;
  /** 0 for a section's direct fields; +1 for every IF YES/IF NO level in. */
  depth: number;
  errors: Record<string, string>;
  onChange: (field: DraftField) => void;
  onRemove: () => void;
  onMove: (direction: -1 | 1) => void;
}) {
  const [branchesExpanded, setBranchesExpanded] = useState(true);
  const titleError = errors[`${path}.title`];
  const optionsError = errors[`${path}.configuration.options`];
  const displayOnly = isDisplayOnly(field.fieldType);
  const isCaseBlock = field.fieldType === CONDITIONAL_FIELD_TYPE;
  const atMaxDepth = depth >= MAX_FIELD_NESTING_DEPTH;
  const description = (field.configuration as TitleDescriptionConfiguration | undefined)?.description || '';
  const options = (field.configuration as ListItemConfiguration | undefined)?.options || [];
  const branchFieldCount = countFields(field.yesFields) + countFields(field.noFields);

  const handleTypeChange = (nextType: ReviewFieldType) => {
    const losingChildren = field.fieldType === CONDITIONAL_FIELD_TYPE && nextType !== CONDITIONAL_FIELD_TYPE && (field.yesFields.length > 0 || field.noFields.length > 0);
    const apply = () => onChange({
      ...field,
      fieldType: nextType,
      // An action button's "title" is the text on the button itself -- default
      // it to "Take snapshot" so switching to this type doesn't leave an
      // untitled, invisible button; leave any title the user already typed alone.
      title: nextType === 'action_button' && !field.title.trim() ? 'Take snapshot' : field.title,
      configuration: {},
      yesFields: nextType === CONDITIONAL_FIELD_TYPE ? field.yesFields : [],
      noFields: nextType === CONDITIONAL_FIELD_TYPE ? field.noFields : [],
    });
    if (!losingChildren) { apply(); return; }
    void showCurriculumConfirm({
      title: 'Change field type?',
      text: 'Changing this field type will remove its conditional fields.',
      icon: 'warning',
      confirmButtonText: 'Change type',
      onConfirm: apply,
    });
  };

  const typeOptions = REVIEW_FIELD_TYPES.map(type => ({
    value: type,
    label: REVIEW_FIELD_TYPE_LABELS[type],
    disabled: type === CONDITIONAL_FIELD_TYPE && atMaxDepth && field.fieldType !== CONDITIONAL_FIELD_TYPE,
    description: type === CONDITIONAL_FIELD_TYPE && atMaxDepth && field.fieldType !== CONDITIONAL_FIELD_TYPE
      ? `Nesting is already ${MAX_FIELD_NESTING_DEPTH} levels deep here`
      : undefined,
  }));

  const handleRemove = () => {
    void showCurriculumConfirm({
      title: `Delete "${field.title || 'this field'}"?`,
      text: branchFieldCount > 0
        ? `This also removes ${branchFieldCount} field${branchFieldCount === 1 ? '' : 's'} nested under its IF YES / IF NO branches.`
        : 'This question will be removed from the section.',
      icon: 'warning',
      confirmButtonText: 'Delete field',
      onConfirm: onRemove,
    });
  };

  return (
    <div className={`rounded-xl border p-3 transition-smooth ${isCaseBlock ? 'border-primary-200 bg-primary-50/40' : 'border-background-200 bg-background-50'}`}>
      {depth > 0 && (
        <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-foreground-400">
          Nested level {depth}{atMaxDepth ? ` of ${MAX_FIELD_NESTING_DEPTH} (deepest allowed)` : ''}
        </p>
      )}
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex flex-col gap-1 pt-6">
          <button type="button" aria-label={`Move field ${index + 1} up`} disabled={index === 0} onClick={() => onMove(-1)} className="flex h-6 w-6 items-center justify-center rounded border border-background-200 bg-white text-foreground-500 disabled:cursor-not-allowed disabled:opacity-40 hover:bg-background-100">
            <AppIcon className="ri-arrow-up-s-line text-sm"></AppIcon>
          </button>
          <button type="button" aria-label={`Move field ${index + 1} down`} disabled={index === total - 1} onClick={() => onMove(1)} className="flex h-6 w-6 items-center justify-center rounded border border-background-200 bg-white text-foreground-500 disabled:cursor-not-allowed disabled:opacity-40 hover:bg-background-100">
            <AppIcon className="ri-arrow-down-s-line text-sm"></AppIcon>
          </button>
        </div>
        <div className="min-w-[200px] flex-1">
          <FormField label={field.fieldType === 'action_button' ? 'Button label' : 'Title'} error={titleError}>
            <TextControl value={field.title} onChange={title => onChange({ ...field, title })} placeholder={field.fieldType === 'action_button' ? 'e.g. Take snapshot' : 'Question title'} />
          </FormField>
        </div>
        <div className="w-48">
          <FormField label="Field type">
            <SelectControl
              value={field.fieldType}
              onChange={value => handleTypeChange(value as ReviewFieldType)}
              options={typeOptions}
            />
          </FormField>
        </div>
        {!displayOnly && (
          <div className="pt-6">
            <label className="flex h-10 items-center gap-1.5 rounded-lg border border-background-200 bg-white px-3 text-[12px] font-semibold text-foreground-700">
              <input
                type="checkbox"
                checked={field.required}
                onChange={event => onChange({ ...field, required: event.target.checked })}
                className="h-4 w-4 rounded border-background-300 text-primary-600 focus:ring-primary-300"
              />
              Required
            </label>
          </div>
        )}
        {isCaseBlock && (
          <div className="pt-6">
            <button
              type="button"
              onClick={() => setBranchesExpanded(prev => !prev)}
              aria-expanded={branchesExpanded}
              title={branchesExpanded ? 'Collapse IF YES / IF NO' : 'Expand IF YES / IF NO'}
              className="flex h-10 items-center gap-1 rounded-lg border border-primary-200 bg-white px-2.5 text-[11px] font-bold text-primary-700 hover:bg-primary-50"
            >
              <AppIcon className={branchesExpanded ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'}></AppIcon>
              {branchFieldCount > 0 ? `${branchFieldCount}` : ''}
            </button>
          </div>
        )}
        <div className="pt-6">
          <button type="button" onClick={handleRemove} aria-label={`Delete field: ${field.title || 'untitled'}`} title="Delete field" className="flex h-10 w-10 items-center justify-center rounded-lg border border-red-100 bg-red-50 text-red-600 hover:bg-red-100">
            <AppIcon className="ri-delete-bin-line text-sm"></AppIcon>
          </button>
        </div>
      </div>

      {field.fieldType === 'list_item' && (
        <div className="mt-3">
          <FormField label="List options" error={optionsError} hint="Shown to the person answering, in this order.">
            <OptionListEditor
              options={options}
              onChange={nextOptions => onChange({ ...field, configuration: { ...field.configuration, options: nextOptions } })}
            />
          </FormField>
        </div>
      )}

      {field.fieldType === 'title_description' && (
        <div className="mt-3">
          <FormField label="Description" hint="Shown under the title as instructional text -- this block does not collect an answer.">
            <TextAreaControl value={description} onChange={value => onChange({ ...field, configuration: { ...field.configuration, description: value } })} rows={2} placeholder="Optional description" />
          </FormField>
        </div>
      )}

      {field.fieldType === 'postcode_address' && (
        <div className="mt-3">
          <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-foreground-400">Collects</p>
          <div className="grid gap-2 rounded-lg border border-dashed border-background-300 bg-white p-3 sm:grid-cols-2">
            {POSTCODE_ADDRESS_SUBFIELDS.map(sub => (
              <div key={sub} className="flex h-9 items-center rounded-lg border border-background-200 bg-background-50 px-3 text-[12px] text-foreground-400">
                {sub}
              </div>
            ))}
          </div>
          <p className="mt-1.5 text-[11px] text-foreground-400">These lines are fixed and answered together as one address -- nothing to configure here.</p>
        </div>
      )}

      {field.fieldType === 'action_button' && (
        <div className="mt-3">
          <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-foreground-400">Preview</p>
          <div className="flex items-center gap-2 rounded-lg border border-dashed border-background-300 bg-white p-3">
            <button type="button" disabled className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-primary-600 px-3 text-[12px] font-bold text-white opacity-90">
              <AppIcon className="ri-camera-line"></AppIcon>
              {field.title.trim() || 'Take snapshot'}
            </button>
            <p className="text-[11px] text-foreground-400">Shown wherever this field sits in the section -- this block does not collect an answer.</p>
          </div>
        </div>
      )}

      {isCaseBlock && branchesExpanded && (
        // Side-by-side only at the top level -- a grid compounds at every
        // nested level (each branch's own two branches would keep halving
        // width), so anything nested stacks full-width instead.
        <div className={depth === 0 ? 'mt-3 grid gap-3 sm:grid-cols-2' : 'mt-3 space-y-3'}>
          <ConditionalBranch
            branch="yes"
            path={`${path}.yesFields`}
            fields={field.yesFields}
            depth={depth + 1}
            errors={errors}
            onChange={yesFields => onChange({ ...field, yesFields })}
          />
          <ConditionalBranch
            branch="no"
            path={`${path}.noFields`}
            fields={field.noFields}
            depth={depth + 1}
            errors={errors}
            onChange={noFields => onChange({ ...field, noFields })}
          />
        </div>
      )}

      {isCaseBlock && !branchesExpanded && branchFieldCount > 0 && (
        <p className="mt-2 text-[11px] font-semibold text-foreground-400">
          IF YES / IF NO collapsed -- {branchFieldCount} field{branchFieldCount === 1 ? '' : 's'} hidden.
        </p>
      )}
    </div>
  );
}

const BRANCH_STYLE = {
  yes: {
    label: 'IF YES',
    icon: 'ri-checkbox-circle-line',
    container: 'border-green-200 bg-green-50/50',
    heading: 'text-green-700',
    addButton: 'border-green-200 bg-white text-green-700 hover:bg-green-50',
  },
  no: {
    label: 'IF NO',
    icon: 'ri-close-circle-line',
    container: 'border-amber-200 bg-amber-50/50',
    heading: 'text-amber-700',
    addButton: 'border-amber-200 bg-white text-amber-700 hover:bg-amber-50',
  },
} as const;

function ConditionalBranch({ branch, path, fields, depth, errors, onChange }: {
  branch: 'yes' | 'no';
  path: string;
  fields: DraftField[];
  depth: number;
  errors: Record<string, string>;
  onChange: (fields: DraftField[]) => void;
}) {
  const style = BRANCH_STYLE[branch];
  return (
    <div className={`space-y-2 rounded-lg border p-2.5 ${style.container}`}>
      <p className={`flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider ${style.heading}`}>
        <AppIcon className={`${style.icon} text-sm`}></AppIcon>
        {style.label}
      </p>
      <div className="space-y-2">
        {fields.map((child, index) => (
          <FieldRow
            key={child.key}
            field={child}
            path={`${path}[${index}]`}
            index={index}
            total={fields.length}
            depth={depth}
            errors={errors}
            onChange={updated => onChange(fields.map(f => (f.key === updated.key ? updated : f)))}
            onRemove={() => onChange(fields.filter(f => f.key !== child.key))}
            onMove={direction => {
              const target = index + direction;
              if (target < 0 || target >= fields.length) return;
              const next = [...fields];
              [next[index], next[target]] = [next[target], next[index]];
              onChange(next);
            }}
          />
        ))}
      </div>
      <button
        type="button"
        onClick={() => onChange([...fields, newDraftField()])}
        className={`inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5 text-[11px] font-bold ${style.addButton}`}
      >
        <AppIcon className="ri-add-line"></AppIcon>
        Add field for {branch === 'yes' ? 'YES' : 'NO'}
      </button>
    </div>
  );
}

// ----------------------------------------------------------------- section

function countFields(fields: DraftField[]): number {
  return fields.reduce((total, field) => total + 1 + countFields(field.yesFields) + countFields(field.noFields), 0);
}

function SectionCard({ section, index, total, errors, onChange, onRemove, onMove }: {
  section: DraftSection;
  index: number;
  total: number;
  errors: Record<string, string>;
  onChange: (section: DraftSection) => void;
  onRemove: () => void;
  onMove: (direction: -1 | 1) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const path = `sections[${index}]`;
  const titleError = errors[`${path}.title`];
  const minutesError = errors[`${path}.estimatedMinutes`];
  const fieldCount = countFields(section.fields);

  const handleRemove = () => {
    if (fieldCount === 0) { onRemove(); return; }
    void showCurriculumConfirm({
      title: `Delete section "${section.title || 'Untitled section'}"?`,
      text: `This removes ${fieldCount} field${fieldCount === 1 ? '' : 's'} configured in this section.`,
      icon: 'warning',
      confirmButtonText: 'Delete section',
      onConfirm: onRemove,
    });
  };

  return (
    <div className="rounded-xl border border-background-200 bg-white">
      <div className="flex flex-wrap items-start gap-3 p-3">
        <button
          type="button"
          onClick={() => setExpanded(prev => !prev)}
          aria-expanded={expanded}
          aria-label={expanded ? `Collapse section ${index + 1}` : `Expand section ${index + 1}`}
          className="mt-6 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-background-200 bg-background-50 text-foreground-500 hover:bg-background-100"
        >
          <AppIcon className={expanded ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'}></AppIcon>
        </button>
        <span className="mt-7 shrink-0 text-[11px] font-bold text-foreground-400">[{index + 1}]</span>
        <div className="min-w-[220px] flex-1">
          <FormField label="Section title" error={titleError}>
            <TextControl value={section.title} onChange={title => onChange({ ...section, title })} placeholder="e.g. Meeting & Close" />
          </FormField>
        </div>
        <div className="w-40">
          <FormField label="Estimated time (min)" error={minutesError}>
            <TextControl value={String(section.estimatedMinutes)} onChange={value => onChange({ ...section, estimatedMinutes: Number(value) || 0 })} type="number" min={0} inputMode="numeric" />
          </FormField>
        </div>
        <div className="flex gap-1 pt-6">
          <button type="button" aria-label={`Move section ${index + 1} up`} disabled={index === 0} onClick={() => onMove(-1)} className="flex h-10 w-9 items-center justify-center rounded-lg border border-background-200 bg-white text-foreground-500 disabled:cursor-not-allowed disabled:opacity-40 hover:bg-background-100">
            <AppIcon className="ri-arrow-up-s-line"></AppIcon>
          </button>
          <button type="button" aria-label={`Move section ${index + 1} down`} disabled={index === total - 1} onClick={() => onMove(1)} className="flex h-10 w-9 items-center justify-center rounded-lg border border-background-200 bg-white text-foreground-500 disabled:cursor-not-allowed disabled:opacity-40 hover:bg-background-100">
            <AppIcon className="ri-arrow-down-s-line"></AppIcon>
          </button>
          <button type="button" onClick={handleRemove} aria-label={`Delete section: ${section.title || 'untitled'}`} title="Delete section" className="flex h-10 w-9 items-center justify-center rounded-lg border border-red-100 bg-red-50 text-red-600 hover:bg-red-100">
            <AppIcon className="ri-delete-bin-line"></AppIcon>
          </button>
        </div>
      </div>

      {expanded && (
        <div className="space-y-3 border-t border-background-100 p-3">
          <p className="text-[11px] font-semibold text-foreground-400">{fieldCount} field{fieldCount === 1 ? '' : 's'} in this section</p>
          {section.fields.length === 0 && (
            <p className="rounded-lg border border-dashed border-background-300 bg-background-50 px-4 py-6 text-center text-[12px] text-foreground-400">
              No fields yet. Add the first one below.
            </p>
          )}
          <div className="space-y-3">
            {section.fields.map((field, fieldIndex) => (
              <FieldRow
                key={field.key}
                field={field}
                path={`${path}.fields[${fieldIndex}]`}
                index={fieldIndex}
                total={section.fields.length}
                depth={0}
                errors={errors}
                onChange={updated => onChange({ ...section, fields: section.fields.map(f => (f.key === updated.key ? updated : f)) })}
                onRemove={() => onChange({ ...section, fields: section.fields.filter(f => f.key !== field.key) })}
                onMove={direction => {
                  const target = fieldIndex + direction;
                  if (target < 0 || target >= section.fields.length) return;
                  const next = [...section.fields];
                  [next[fieldIndex], next[target]] = [next[target], next[fieldIndex]];
                  onChange({ ...section, fields: next });
                }}
              />
            ))}
          </div>
          <button
            type="button"
            onClick={() => onChange({ ...section, fields: [...section.fields, newDraftField()] })}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-primary-200 bg-primary-50 px-3 text-[12px] font-bold text-primary-700 hover:bg-primary-100"
          >
            <AppIcon className="ri-add-line"></AppIcon>
            Add field
          </button>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------- validation
// Mirrors reviews.py's validate_review_payload / validate_section_payload /
// validate_field_payload key-for-key, so a client-caught error and a
// server-caught error land on the same field.

function validateField(field: DraftField, path: string, errors: Record<string, string>, depth = 0) {
  if (!field.title.trim()) errors[`${path}.title`] = "Title can't be empty.";
  if (field.fieldType === 'list_item') {
    const options = (field.configuration as ListItemConfiguration | undefined)?.options || [];
    if (!options.length) errors[`${path}.configuration.options`] = 'List item fields need at least one option.';
  }
  if (field.fieldType === CONDITIONAL_FIELD_TYPE) {
    if (depth >= MAX_FIELD_NESTING_DEPTH) {
      errors[`${path}.fieldType`] = `"Boolean with case block" fields cannot nest more than ${MAX_FIELD_NESTING_DEPTH} levels deep.`;
      return;
    }
    field.yesFields.forEach((child, index) => validateField(child, `${path}.yesFields[${index}]`, errors, depth + 1));
    field.noFields.forEach((child, index) => validateField(child, `${path}.noFields[${index}]`, errors, depth + 1));
  }
}

function validateSections(sections: DraftSection[]): Record<string, string> {
  const errors: Record<string, string> = {};
  sections.forEach((section, sectionIndex) => {
    const sectionPath = `sections[${sectionIndex}]`;
    if (!section.title.trim()) errors[`${sectionPath}.title`] = "Section title can't be empty.";
    if (section.estimatedMinutes < 0) errors[`${sectionPath}.estimatedMinutes`] = 'Estimated time must be zero or a positive number of minutes.';
    section.fields.forEach((field, fieldIndex) => validateField(field, `${sectionPath}.fields[${fieldIndex}]`, errors));
  });
  return errors;
}

// --------------------------------------------------------------- the modal

export function ReviewFormModal({ programmeId, review, defaultStartDate, onClose, onSaved }: {
  programmeId: string;
  review: ReviewSummary | null;
  /** Earliest cohort start date on this programme -- prefills the first occurrence date for a new review. */
  defaultStartDate?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = Boolean(review);
  const [section, setSection] = useState<Section>('General');
  // Wizard gating: a new review starts locked to step 1 and unlocks the next
  // step only once the current one validates. Editing an existing review
  // trusts the already-saved data and starts fully unlocked.
  const [maxStepReached, setMaxStepReached] = useState(() => (isEdit ? SECTIONS.length - 1 : 0));
  const [loading, setLoading] = useState(isEdit);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [name, setName] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [interval, setInterval_] = useState('1');
  const [unit, setUnit] = useState<ReviewRecurrenceUnit>('weeks');
  const [scheduleAnchorDate, setScheduleAnchorDate] = useState(() => defaultStartDate || new Date().toISOString().slice(0, 10));
  // Blank means unlimited -- the review keeps recurring indefinitely.
  const [occurrenceCount, setOccurrenceCount] = useState('');
  const [statuses, setStatuses] = useState<string[]>([]);
  const [signatures, setSignatures] = useState<ReviewRoleFlags>(emptyRoleFlags());
  const [visibleTo, setVisibleTo] = useState<ReviewRoleFlags>({ advisor: true, employer: true, participant: true, referrer: true });
  const [recordTimeSpent, setRecordTimeSpent] = useState(false);
  const [expectedOtjh, setExpectedOtjh] = useState('0');
  const [countsTowardsOtjh, setCountsTowardsOtjh] = useState(false);
  const [allowEditingPriorDays, setAllowEditingPriorDays] = useState('0');
  const [notifications, setNotifications] = useState<ReviewNotificationFlags>({ employer: false, participant: false });
  const [incompleteMarker, setIncompleteMarker] = useState('');
  const [sections, setSections] = useState<DraftSection[]>([]);

  useEffect(() => {
    if (!review) return;
    let cancelled = false;
    setLoading(true);
    setLoadError('');
    fetchReviewDetail(review.id)
      .then((detail: ReviewDetail) => {
        if (cancelled) return;
        setName(detail.name);
        setEnabled(detail.enabled);
        setInterval_(String(detail.recurrence.interval));
        setUnit(detail.recurrence.unit);
        if (detail.scheduleAnchorDate) setScheduleAnchorDate(detail.scheduleAnchorDate);
        setOccurrenceCount(detail.occurrenceCount != null ? String(detail.occurrenceCount) : '');
        setStatuses(detail.applicableStatuses);
        setSignatures(detail.signatures);
        setVisibleTo(detail.visibleTo);
        setRecordTimeSpent(detail.recordTimeSpent);
        setExpectedOtjh(String(detail.expectedOtjh));
        setCountsTowardsOtjh(detail.countsTowardsOtjh);
        setAllowEditingPriorDays(String(detail.allowEditingPriorDays));
        setNotifications(detail.notifications);
        setIncompleteMarker(detail.incompleteMarker);
        setSections(detail.sections.map(sectionToDraft));
      })
      .catch(err => { if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Unable to load this review.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [review]);

  const statusOptions = useMemo(() => CURRICULUM_PROGRAMME_STATUSES.map(status => ({ value: status, label: status })), []);
  const totalFieldCount = useMemo(() => sections.reduce((total, s) => total + countFields(s.fields), 0), [sections]);

  const buildPayload = (): CreateReviewInput => ({
    name: name.trim(),
    enabled,
    recurrence: { interval: Number(interval) || 0, unit },
    scheduleAnchorDate,
    occurrenceCount: occurrenceCount.trim() ? Number(occurrenceCount) : null,
    applicableStatuses: statuses,
    signatures,
    visibleTo,
    recordTimeSpent,
    expectedOtjh: Number(expectedOtjh) || 0,
    countsTowardsOtjh,
    allowEditingPriorDays: Number(allowEditingPriorDays) || 0,
    notifications,
    incompleteMarker: incompleteMarker.trim(),
    sections: sections.map(stripDraftSection),
  });

  // What the modal opened with (or the defaults for a brand-new review), so
  // closing it can tell an untouched form from one with real edits to lose.
  // Set during render rather than an effect -- a known-safe one-time ref
  // write (https://react.dev/reference/react/useState#storing-information-from-previous-renders)
  // -- so it lands before the very first paint instead of one tick after,
  // which would otherwise let a close-while-loading race read a stale null.
  const baseline = useRef<string | null>(null);
  const currentPayloadJson = JSON.stringify(buildPayload());
  if (baseline.current === null && !loading && !loadError) baseline.current = currentPayloadJson;
  const dirty = baseline.current !== null && baseline.current !== currentPayloadJson;

  const handleClose = () => {
    if (!dirty) { onClose(); return; }
    void showCurriculumConfirm({
      title: 'Discard this review\'s changes?',
      text: 'Closing now loses everything you changed since opening this form.',
      icon: 'warning',
      confirmButtonText: 'Discard changes',
      onConfirm: onClose,
    });
  };

  const clientErrors = (): Record<string, string> => {
    const next: Record<string, string> = {};
    if (!name.trim()) next.name = 'Review name is required.';
    const intervalNumber = Number(interval);
    if (!Number.isFinite(intervalNumber) || intervalNumber <= 0) next.recurrenceInterval = 'Repeat interval must be a positive number.';
    if (!scheduleAnchorDate || Number.isNaN(new Date(scheduleAnchorDate).getTime())) next.scheduleAnchorDate = 'First occurrence date must be a valid date.';
    if (occurrenceCount.trim()) {
      const occurrenceCountNumber = Number(occurrenceCount);
      if (!Number.isFinite(occurrenceCountNumber) || !Number.isInteger(occurrenceCountNumber) || occurrenceCountNumber <= 0) {
        next.occurrenceCount = 'Number of occurrences must be a positive whole number.';
      }
    }
    const expectedOtjhNumber = Number(expectedOtjh);
    if (!Number.isFinite(expectedOtjhNumber) || expectedOtjhNumber < 0) next.expectedOtjh = 'Expected OTJH must be zero or a positive number.';
    Object.assign(next, validateSections(sections));
    return next;
  };

  // Recomputed on every render off current form state so the wizard's step
  // indicators, Next button and the final submit button all agree on what's
  // still invalid without a second, separately-maintained source of truth.
  const liveErrors = clientErrors();
  const allValid = Object.keys(liveErrors).length === 0;

  const stepErrorKeys = (s: Section): string[] => {
    switch (s) {
      case 'General': return ['name'];
      case 'Schedule': return ['recurrenceInterval', 'recurrenceUnit', 'scheduleAnchorDate', 'occurrenceCount'];
      case 'Eligibility': return ['applicableStatuses'];
      case 'Participants & Permissions': return ['allowEditingPriorDays', 'expectedOtjh'];
      case 'Form Builder': return [];
      default: return [];
    }
  };

  const stepHasError = (s: Section, errs: Record<string, string>): boolean => {
    if (s === 'Form Builder') return Object.keys(errs).some(key => key.startsWith('sections'));
    return stepErrorKeys(s).some(key => Boolean(errs[key]));
  };

  const currentIndex = SECTIONS.indexOf(section);
  const isLastStep = currentIndex === SECTIONS.length - 1;
  const currentStepInvalid = stepHasError(section, liveErrors);

  const goToStep = (target: Section) => {
    const targetIndex = SECTIONS.indexOf(target);
    if (targetIndex <= maxStepReached) setSection(target);
  };

  const goBack = () => setSection(SECTIONS[Math.max(currentIndex - 1, 0)]);

  const goNext = () => {
    if (currentStepInvalid) {
      setErrors(prev => ({ ...prev, ...liveErrors }));
      return;
    }
    const nextIndex = Math.min(currentIndex + 1, SECTIONS.length - 1);
    setSection(SECTIONS[nextIndex]);
    setMaxStepReached(prev => Math.max(prev, nextIndex));
  };

  const handleSave = async () => {
    const validation = clientErrors();
    if (Object.keys(validation).length) {
      setErrors(validation);
      if (validation.name || validation.recurrenceInterval || validation.scheduleAnchorDate) {
        setSection(validation.name ? 'General' : 'Schedule');
      } else {
        setSection('Form Builder');
      }
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      const payload = buildPayload();
      if (review) {
        await updateReviewTemplate(review.id, payload);
      } else {
        await createReviewTemplate(programmeId, payload);
      }
      onSaved();
    } catch (err) {
      if (err instanceof CurriculumApiError && err.data && typeof err.data === 'object' && 'fields' in (err.data as Record<string, unknown>)) {
        const serverFields = (err.data as { fields?: Record<string, string> }).fields;
        if (serverFields && typeof serverFields === 'object') setErrors(serverFields);
      }
      await showCurriculumAlert({ icon: 'error', title: 'Could not save this review', text: err instanceof Error ? err.message : 'Please try again.', confirmButtonText: 'OK' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={isEdit ? `Edit "${review?.name}"` : 'Add New Review'}
      onClose={handleClose}
      size="max-w-5xl"
      footer={(
        <div className="flex w-full items-center justify-between gap-2">
          <button type="button" onClick={handleClose} className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-background-200 bg-background-50 px-4 text-[12px] font-bold text-foreground-700 hover:bg-background-100">
            Cancel
          </button>
          <div className="flex items-center gap-2">
            {currentIndex > 0 && (
              <button type="button" onClick={goBack} className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-background-200 bg-background-50 px-4 text-[12px] font-bold text-foreground-700 hover:bg-background-100">
                <AppIcon className="ri-arrow-left-line text-sm"></AppIcon>
                Back
              </button>
            )}
            {!isLastStep && (
              <button
                type="button"
                onClick={goNext}
                className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-primary-600 px-4 text-[12px] font-bold text-white transition-smooth hover:bg-primary-700"
              >
                Next
                <AppIcon className="ri-arrow-right-line text-sm"></AppIcon>
              </button>
            )}
            {isLastStep && (
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={saving || loading || !allValid}
                title={!allValid ? 'Complete every step before you can save this review.' : undefined}
                className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-primary-600 px-4 text-[12px] font-bold text-white transition-smooth hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving && <AppIcon className="ri-loader-4-line animate-spin"></AppIcon>}
                {isEdit ? 'Save changes' : 'Create review'}
              </button>
            )}
          </div>
        </div>
      )}
    >
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-[12px] font-semibold text-foreground-400">
          <AppIcon className="ri-loader-4-line animate-spin"></AppIcon>
          Loading review...
        </div>
      ) : loadError ? (
        <div className="py-10 text-center text-[12px] font-semibold text-red-600">{loadError}</div>
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap gap-1.5 border-b border-background-200 pb-3" role="tablist" aria-label="Review sections">
            {SECTIONS.map((sectionName, index) => {
              const isCurrent = section === sectionName;
              const unlocked = index <= maxStepReached;
              const completed = index < maxStepReached && !stepHasError(sectionName, liveErrors);
              return (
                <button
                  key={sectionName}
                  type="button"
                  role="tab"
                  aria-selected={isCurrent}
                  disabled={!unlocked}
                  onClick={() => goToStep(sectionName)}
                  title={!unlocked ? 'Complete the previous step first.' : undefined}
                  className={`inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-[11px] font-bold transition-smooth ${
                    isCurrent
                      ? 'bg-primary-600 text-white'
                      : unlocked
                        ? 'bg-background-100 text-foreground-600 hover:bg-background-200'
                        : 'cursor-not-allowed bg-background-50 text-foreground-300'
                  }`}
                >
                  {completed && <AppIcon className="ri-check-line text-xs"></AppIcon>}
                  {!unlocked && <AppIcon className="ri-lock-line text-xs"></AppIcon>}
                  {sectionName}
                  {sectionName === 'Form Builder' && totalFieldCount > 0 ? ` (${totalFieldCount})` : ''}
                </button>
              );
            })}
          </div>

          {section === 'General' && (
            <div className="space-y-4">
              <FormField label="Review name" required error={errors.name}>
                <TextControl value={name} onChange={setName} placeholder="e.g. Progress Review" />
              </FormField>
              <CheckboxRow label="Enabled" hint="A disabled review is kept configured but never applies to anyone." checked={enabled} onChange={setEnabled} />
            </div>
          )}

          {section === 'Schedule' && (
            <div className="space-y-4">
              <p className="text-[11px] font-bold uppercase tracking-wider text-foreground-400">Repeat every</p>
              <div className="flex gap-2">
                <div className="w-28">
                  <FormField label="Repeat interval" required error={errors.recurrenceInterval}>
                    <TextControl value={interval} onChange={setInterval_} type="number" min={1} inputMode="numeric" />
                  </FormField>
                </div>
                <div className="w-40">
                  <FormField label="Repeat unit" required error={errors.recurrenceUnit}>
                    <SelectControl value={unit} onChange={value => setUnit(value as ReviewRecurrenceUnit)} options={RECURRENCE_UNITS.map(u => ({ value: u, label: u.charAt(0).toUpperCase() + u.slice(1) }))} />
                  </FormField>
                </div>
              </div>
              <div className="w-40">
                <FormField label="Number of occurrences" error={errors.occurrenceCount} hint="Leave blank for the review to keep recurring indefinitely.">
                  <TextControl value={occurrenceCount} onChange={setOccurrenceCount} type="number" min={1} inputMode="numeric" placeholder="Unlimited" />
                </FormField>
              </div>
            </div>
          )}

          {section === 'Eligibility' && (
            <FormField label="Programme statuses" hint="Leave empty to apply this review to every status." as="group" error={errors.applicableStatuses}>
              <MultiSelectControl value={statuses} onChange={setStatuses} options={statusOptions} selectAllLabel="statuses" />
            </FormField>
          )}

          {section === 'Participants & Permissions' && (
            <div className="space-y-5">
              <RoleFlagGrid label="Signatures required from" value={signatures} onChange={setSignatures} />
              <RoleFlagGrid label="Visible to" value={visibleTo} onChange={setVisibleTo} />
              <CheckboxRow label="Record time spent" checked={recordTimeSpent} onChange={setRecordTimeSpent} />
              <div className="flex flex-wrap items-end gap-4">
                <div className="w-32">
                  <FormField label="Expected OTJH (hours)" error={errors.expectedOtjh}>
                    <TextControl value={expectedOtjh} onChange={setExpectedOtjh} type="number" min={0} step="0.5" inputMode="decimal" />
                  </FormField>
                </div>
                <div className="flex-1 min-w-[220px]">
                  <CheckboxRow
                    label="Counts towards learner's total OTJH"
                    hint="When completed, adds the hours above to the learner's OTJH total."
                    checked={countsTowardsOtjh}
                    onChange={setCountsTowardsOtjh}
                  />
                </div>
              </div>
              <FormField label="Allow editing prior to review (days)" error={errors.allowEditingPriorDays}>
                <div className="w-32">
                  <TextControl value={allowEditingPriorDays} onChange={setAllowEditingPriorDays} type="number" min={0} inputMode="numeric" />
                </div>
              </FormField>
              <FormField label="Notify when available for editing" as="group">
                <div className="grid grid-cols-2 gap-2 sm:w-64">
                  <CheckboxRow label="Employer" checked={notifications.employer} onChange={value => setNotifications({ ...notifications, employer: value })} />
                  <CheckboxRow label="Participant" checked={notifications.participant} onChange={value => setNotifications({ ...notifications, participant: value })} />
                </div>
              </FormField>
              <FormField label="Marker when not completed" hint={'Shown against the review while it is outstanding, e.g. "Overdue".'}>
                <TextControl value={incompleteMarker} onChange={setIncompleteMarker} placeholder="Optional" />
              </FormField>
            </div>
          )}

          {section === 'Form Builder' && (
            <div className="space-y-3">
              {errors.sections && <InlineFieldsError message={errors.sections} />}
              {sections.length === 0 && (
                <p className="rounded-lg border border-dashed border-background-300 bg-background-50 px-4 py-6 text-center text-[12px] text-foreground-400">
                  No sections yet. Add the first one below -- a Review is organised into one or more sections of questions.
                </p>
              )}
              <div className="space-y-3">
                {sections.map((sectionDraft, index) => (
                  <SectionCard
                    key={sectionDraft.key}
                    section={sectionDraft}
                    index={index}
                    total={sections.length}
                    errors={errors}
                    onChange={updated => setSections(prev => prev.map(s => (s.key === updated.key ? updated : s)))}
                    onRemove={() => setSections(prev => prev.filter(s => s.key !== sectionDraft.key))}
                    onMove={direction => setSections(prev => {
                      const next = [...prev];
                      const target = index + direction;
                      if (target < 0 || target >= next.length) return prev;
                      [next[index], next[target]] = [next[target], next[index]];
                      return next;
                    })}
                  />
                ))}
              </div>
              <button
                type="button"
                onClick={() => setSections(prev => [...prev, newDraftSection()])}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-primary-200 bg-primary-50 px-3 text-[12px] font-bold text-primary-700 hover:bg-primary-100"
              >
                <AppIcon className="ri-add-line"></AppIcon>
                Add section
              </button>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function InlineFieldsError({ message }: { message: string }) {
  return <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11px] font-semibold text-red-700">{message}</p>;
}
