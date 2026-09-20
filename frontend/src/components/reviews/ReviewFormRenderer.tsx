import { AppIcon } from '@/components/feature/AppIcon';
import { cn } from '@/lib/cn';
import { flattenReviewFields, type ReviewFieldDefinition, type ReviewSectionDefinition } from '@/api/reviewInstances';
import type { ReactNode } from 'react';

/**
 * Renders whatever sections/fields a Curriculum Review template defines --
 * the ONE reusable form renderer every Coach Review (Monthly Coaching
 * Meeting, Progress Review, and any Review Curriculum creates later) opens
 * through. It must never hard-code a question list: everything it draws
 * comes from the `sections` prop, which is the Review instance's frozen
 * definition snapshot (see review_instance_form_definition on the backend).
 *
 * Visual language matches the existing hand-built Coach completion forms
 * (accordion sections, AppIcon, the same button-group answer controls) so a
 * Curriculum-driven Review looks native inside Coach rather than like a
 * second design system.
 */

export interface ReviewFieldErrorSet {
  /** field ids that are visible, required, and currently unanswered. */
  missingFieldIds: Set<string>;
}

interface ReviewFormRendererProps {
  sections: ReviewSectionDefinition[];
  answers: Record<string, unknown>;
  onAnswerChange: (fieldId: string, value: unknown) => void;
  errors?: ReviewFieldErrorSet;
  readOnly?: boolean;
  openSectionId: string;
  onOpenSectionChange: (sectionId: string) => void;
  renderFieldAddon?: (field: ReviewFieldDefinition) => ReactNode;
  renderFieldInput?: (
    field: ReviewFieldDefinition,
    context: {
      value: unknown;
      onChange: (value: unknown) => void;
      readOnly: boolean;
      invalid: boolean;
    },
  ) => ReactNode | undefined;
}

function fieldAnswered(field: ReviewFieldDefinition, answers: Record<string, unknown>) {
  const value = answers[field.id];
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function sectionRequiredFields(section: ReviewSectionDefinition) {
  return section.fields.filter((field) => field.required);
}

export function ReviewFormRenderer({
  sections, answers, onAnswerChange, errors, readOnly, openSectionId, onOpenSectionChange, renderFieldAddon, renderFieldInput,
}: ReviewFormRendererProps) {
  const enabledSections = sections
    .filter((section) => section.enabled)
    .slice()
    .sort((a, b) => a.displayOrder - b.displayOrder);

  return (
    <>
      {enabledSections.map((section, sectionIndex) => {
        const open = openSectionId === section.id;
        const requiredFields = sectionRequiredFields(section);
        const complete = requiredFields.every((field) => fieldAnswered(field, answers));
        return (
          <section key={section.id} className={cn('overflow-hidden rounded-2xl border bg-background-50 transition-all', open ? 'border-primary-300 shadow-sm' : 'border-background-200')}>
            <button type="button" onClick={() => onOpenSectionChange(open ? '' : section.id)} className="flex w-full items-center gap-3 p-4 text-left sm:px-5">
              <span className={cn('relative flex h-10 w-10 shrink-0 items-center justify-center rounded-lg', open ? 'bg-primary-600 text-white' : 'bg-primary-50 text-primary-700')}>
                <AppIcon className="ri-file-list-3-line"></AppIcon>
                <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-white bg-primary-900 px-1 text-[12px] font-bold text-white">{sectionIndex + 1}</span>
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[12px] font-bold uppercase tracking-[0.12em] text-foreground-400">Section {sectionIndex + 1} of {enabledSections.length}</span>
                <span className="mt-0.5 block text-sm font-bold text-foreground-900">{section.title}</span>
                {section.estimatedMinutes ? <span className="mt-1 hidden text-[12px] text-foreground-400 sm:block">{section.estimatedMinutes} minutes</span> : null}
              </span>
              {complete ? <AppIcon className="ri-checkbox-circle-fill text-lg text-emerald-500"></AppIcon> : null}
              <span className={cn('flex h-8 w-8 items-center justify-center rounded-full bg-background-100 text-foreground-500 transition-transform', open && 'rotate-180')}>
                <AppIcon className="ri-arrow-down-s-line"></AppIcon>
              </span>
            </button>

            {open ? (
              <div className="space-y-3 border-t border-primary-100 bg-white p-4 sm:p-5">
                {section.fields
                  .slice()
                  .sort((a, b) => a.displayOrder - b.displayOrder)
                  .map((field, fieldIndex) => (
                    <ReviewFieldControl
                      key={field.id}
                      field={field}
                      index={fieldIndex}
                      answers={answers}
                      onAnswerChange={onAnswerChange}
                      errors={errors}
                      readOnly={readOnly}
                      renderFieldAddon={renderFieldAddon}
                      renderFieldInput={renderFieldInput}
                    />
                  ))}
              </div>
            ) : null}
          </section>
        );
      })}
    </>
  );
}

function ReviewFieldControl({
  field, index, answers, onAnswerChange, errors, readOnly, renderFieldAddon, renderFieldInput,
}: {
  field: ReviewFieldDefinition;
  index: number;
  answers: Record<string, unknown>;
  onAnswerChange: (fieldId: string, value: unknown) => void;
  errors?: ReviewFieldErrorSet;
  readOnly?: boolean;
  renderFieldAddon?: (field: ReviewFieldDefinition) => ReactNode;
  renderFieldInput?: ReviewFormRendererProps['renderFieldInput'];
}) {
  const value = answers[field.id];
  const invalid = Boolean(errors?.missingFieldIds.has(field.id));
  const isMeetingSummary = field.configuration?.semanticKey === 'meeting_summary';

  if (field.fieldType === 'title_description') {
    const description = String(field.configuration?.description || '');
    return (
      <div className="rounded-lg border border-background-200 bg-background-100/70 px-4 py-3">
        <div className="flex items-start gap-3">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary-100 text-[12px] font-bold text-primary-700">{index + 1}</span>
          <div>
            <p className="text-xs font-bold text-foreground-800">{field.title}</p>
            {description ? <p className="mt-1 text-[12px] leading-4 text-foreground-400">{description}</p> : null}
          </div>
        </div>
      </div>
    );
  }

  if (field.fieldType === 'action_button') {
    return (
      <div className="rounded-2xl border border-background-200 bg-background-50 p-4">
        <button type="button" disabled={readOnly} className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary-600 px-4 text-xs font-bold text-white shadow-sm transition hover:bg-primary-700 disabled:opacity-60">
          <AppIcon className="ri-flashlight-line"></AppIcon>{field.title}
        </button>
      </div>
    );
  }

  return (
    <div className={cn('rounded-2xl border bg-background-50 p-4 transition focus-within:border-primary-300 focus-within:shadow-sm', invalid ? 'border-red-300' : 'border-background-200')}>
      <label className="mb-2 block text-xs font-bold text-foreground-800">
        <span className="mr-2 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary-100 px-1 text-[12px] text-primary-700">{index + 1}</span>
        {isMeetingSummary ? 'Meeting Summary' : field.title}
        {field.required ? <span className="ml-1 text-red-500">*</span> : null}
      </label>

      {renderFieldAddon?.(field)}
      {renderFieldInput?.(field, {
        value,
        onChange: (next) => onAnswerChange(field.id, next),
        readOnly: Boolean(readOnly),
        invalid,
      }) ?? (
        <ReviewFieldInput field={field} value={value} onChange={(next) => onAnswerChange(field.id, next)} readOnly={readOnly} />
      )}

      {field.fieldType === 'boolean_case_block' ? (
        <div className="mt-3 space-y-3 border-l-2 border-primary-100 pl-4">
          {value === 'yes' ? (field.yesFields || []).map((child, childIndex) => (
            <ReviewFieldControl key={child.id} field={child} index={childIndex} answers={answers} onAnswerChange={onAnswerChange} errors={errors} readOnly={readOnly} renderFieldAddon={renderFieldAddon} renderFieldInput={renderFieldInput} />
          )) : null}
          {value === 'no' ? (field.noFields || []).map((child, childIndex) => (
            <ReviewFieldControl key={child.id} field={child} index={childIndex} answers={answers} onAnswerChange={onAnswerChange} errors={errors} readOnly={readOnly} renderFieldAddon={renderFieldAddon} renderFieldInput={renderFieldInput} />
          )) : null}
        </div>
      ) : null}
    </div>
  );
}

function ReviewFieldInput({
  field, value, onChange, readOnly,
}: {
  field: ReviewFieldDefinition;
  value: unknown;
  onChange: (value: unknown) => void;
  readOnly?: boolean;
}) {
  const stringValue = typeof value === 'string' ? value : '';

  switch (field.fieldType) {
    case 'text':
    case 'text_multiline':
      return (
        <textarea
          value={stringValue}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          maxLength={field.configuration?.semanticKey === 'meeting_summary' ? undefined : 4000}
          disabled={readOnly}
          placeholder={String(field.configuration?.placeholder || '')}
          className="w-full resize-y rounded-lg border border-background-300 bg-white px-3.5 py-3 text-sm text-foreground-800 outline-none transition placeholder:text-foreground-300 focus:border-primary-400 focus:ring-2 focus:ring-primary-200 disabled:bg-background-100"
        />
      );
    case 'numeric':
      return (
        <input
          type="number"
          value={stringValue}
          onChange={(e) => onChange(e.target.value)}
          disabled={readOnly}
          className="h-11 w-full max-w-sm rounded-lg border border-background-300 bg-white px-3.5 text-sm font-semibold text-foreground-800 outline-none transition focus:border-primary-400 focus:ring-2 focus:ring-primary-200"
        />
      );
    case 'email':
      return (
        <input
          type="email"
          value={stringValue}
          onChange={(e) => onChange(e.target.value)}
          disabled={readOnly}
          className="h-11 w-full max-w-sm rounded-lg border border-background-300 bg-white px-3.5 text-sm text-foreground-800 outline-none transition focus:border-primary-400 focus:ring-2 focus:ring-primary-200"
        />
      );
    case 'phone':
      return (
        <input
          type="tel"
          value={stringValue}
          onChange={(e) => onChange(e.target.value)}
          disabled={readOnly}
          className="h-11 w-full max-w-sm rounded-lg border border-background-300 bg-white px-3.5 text-sm text-foreground-800 outline-none transition focus:border-primary-400 focus:ring-2 focus:ring-primary-200"
        />
      );
    case 'postcode_address':
      return (
        <textarea
          value={stringValue}
          onChange={(e) => onChange(e.target.value)}
          rows={2}
          disabled={readOnly}
          placeholder="Address / postcode"
          className="w-full resize-y rounded-lg border border-background-300 bg-white px-3.5 py-3 text-sm text-foreground-800 outline-none transition focus:border-primary-400 focus:ring-2 focus:ring-primary-200"
        />
      );
    case 'date':
      return (
        <input
          type="date"
          value={stringValue}
          onChange={(e) => onChange(e.target.value)}
          disabled={readOnly}
          className="h-11 w-full max-w-sm rounded-lg border border-background-300 bg-white px-3.5 text-sm font-semibold text-foreground-800 outline-none transition focus:border-primary-400 focus:ring-2 focus:ring-primary-200"
        />
      );
    case 'boolean':
    case 'boolean_case_block':
      return (
        <div className="grid max-w-sm grid-cols-2 gap-2">
          {(['yes', 'no'] as const).map((option) => (
            <button
              key={option}
              type="button"
              disabled={readOnly}
              onClick={() => onChange(option)}
              className={cn(
                'flex h-11 items-center justify-center gap-2 rounded-lg border text-xs font-bold capitalize transition',
                value === option
                  ? (option === 'yes' ? 'border-emerald-500 bg-emerald-500 text-white shadow-sm' : 'border-foreground-700 bg-foreground-800 text-white shadow-sm')
                  : 'border-background-300 bg-white text-foreground-600 hover:border-primary-300 hover:bg-primary-50',
              )}
            >
              <AppIcon className={option === 'yes' ? 'ri-check-line' : 'ri-close-line'}></AppIcon>{option}
            </button>
          ))}
        </div>
      );
    case 'list_item': {
      const options = Array.isArray(field.configuration?.options) ? (field.configuration!.options as string[]) : [];
      return (
        <div className="grid gap-2 sm:grid-cols-2">
          {options.map((option) => (
            <button
              key={option}
              type="button"
              disabled={readOnly}
              onClick={() => onChange(option)}
              className={cn(
                'min-h-10 rounded-lg border px-3 py-2 text-left text-[12px] font-semibold transition',
                value === option ? 'border-primary-600 bg-primary-600 text-white shadow-sm' : 'border-background-300 bg-white text-foreground-600 hover:border-primary-300 hover:bg-primary-50',
              )}
            >
              <AppIcon className={cn('mr-2', value === option ? 'ri-checkbox-circle-fill' : 'ri-checkbox-blank-circle-line')}></AppIcon>{option}
            </button>
          ))}
        </div>
      );
    }
    default:
      return null;
  }
}

/** Visible required fields with no answer -- a hidden conditional child
 * (its parent boolean_case_block answered the other way) is never included,
 * mirroring the backend's own completion validation. */
/**
 * Every required field the coach can actually see and answer right now: an
 * enabled section's field, not a display-only heading, and -- for a
 * conditional child -- only while its case block's answer reveals it. The
 * set shrinks and grows as case blocks are answered, which is why progress
 * counts and the missing-field check must both be derived from it rather
 * than from the template's flat field list.
 */
export function computeVisibleRequiredFields(sections: ReviewSectionDefinition[], answers: Record<string, unknown>): Set<string> {
  const required = new Set<string>();

  const walk = (fields: ReviewFieldDefinition[], visible: boolean) => {
    for (const field of fields) {
      const isDisplayOnly = field.fieldType === 'title_description' || field.fieldType === 'action_button';
      if (visible && field.required && !isDisplayOnly) {
        required.add(field.id);
      }
      if (field.fieldType === 'boolean_case_block') {
        const answer = answers[field.id];
        walk(field.yesFields || [], visible && answer === 'yes');
        walk(field.noFields || [], visible && answer === 'no');
      }
    }
  };

  for (const section of sections) {
    if (!section.enabled) continue;
    walk(section.fields, true);
  }
  return required;
}

export function computeMissingRequiredFields(sections: ReviewSectionDefinition[], answers: Record<string, unknown>): Set<string> {
  const missing = new Set<string>();
  const byId = new Map(flattenReviewFields(sections).map((field) => [field.id, field]));
  for (const fieldId of computeVisibleRequiredFields(sections, answers)) {
    const field = byId.get(fieldId);
    if (field && !fieldAnswered(field, answers)) missing.add(fieldId);
  }
  return missing;
}
