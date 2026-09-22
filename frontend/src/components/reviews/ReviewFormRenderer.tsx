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
  /** Per-field override of `readOnly`, e.g. so a Learner/Employer viewer can
   *  write exactly the fields their role was opted into (see
   *  computeWritableFieldIds) while every other field stays read-only. Takes
   *  priority over the blanket `readOnly` prop whenever it is supplied. */
  fieldReadOnly?: (field: ReviewFieldDefinition) => boolean;
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
  variant?: 'accordion' | 'steps';
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
  sections,
  answers,
  onAnswerChange,
  errors,
  readOnly,
  fieldReadOnly,
  openSectionId,
  onOpenSectionChange,
  renderFieldAddon,
  renderFieldInput,
  variant = 'accordion',
}: ReviewFormRendererProps) {
  const enabledSections = sections
    .filter((section) => section.enabled)
    .slice()
    .sort((a, b) => a.displayOrder - b.displayOrder);

  if (variant === 'steps') {
    const activeIndex = Math.max(0, enabledSections.findIndex(section => section.id === openSectionId));
    const activeSection = enabledSections[activeIndex];
    const totalSteps = enabledSections.length;

    if (!activeSection) return null;

    return (
      <div className="grid items-start gap-5 lg:grid-cols-[17rem_minmax(0,1fr)]">
        <nav aria-label="Review steps" className="rounded-2xl border border-background-200 bg-white p-3 lg:sticky lg:top-4">
          <ol className="space-y-1.5">
            {enabledSections.map((section, sectionIndex) => {
              const selected = section.id === activeSection.id;
              const complete = computeMissingRequiredFields([section], answers).size === 0;
              const stepNumber = sectionIndex + 1;
              return (
                <li key={section.id}>
                  <button
                    type="button"
                    onClick={() => onOpenSectionChange(section.id)}
                    aria-current={selected ? 'step' : undefined}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition',
                      selected ? 'bg-primary-50 text-primary-900 ring-1 ring-primary-200' : 'text-foreground-600 hover:bg-background-100',
                    )}
                  >
                    <span className={cn(
                      'flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-xs font-bold',
                      selected
                        ? 'border-primary-600 bg-primary-600 text-white'
                        : complete
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                          : 'border-background-300 bg-white text-foreground-500',
                    )}>
                      {complete && !selected ? <AppIcon className="ri-check-line"></AppIcon> : stepNumber}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[11px] font-bold uppercase tracking-[0.1em]">Step {stepNumber}</span>
                      <span className="mt-0.5 block text-xs font-semibold leading-4">{section.title}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>

        <section className="overflow-hidden rounded-2xl border border-primary-200 bg-white shadow-sm" aria-labelledby={`review-step-${activeSection.id}`}>
          <header className="border-b border-primary-100 bg-primary-50/70 px-5 py-4 sm:px-6">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-600 text-sm font-bold text-white">
                {activeIndex + 1}
              </span>
              <div className="min-w-0">
                <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-primary-600">
                  Step {activeIndex + 1} of {totalSteps}
                </p>
                <h2 id={`review-step-${activeSection.id}`} className="mt-1 text-base font-bold text-foreground-950">
                  {activeSection.title}
                </h2>
                {activeSection.estimatedMinutes ? <p className="mt-1 text-xs text-foreground-500">About {activeSection.estimatedMinutes} minutes</p> : null}
              </div>
            </div>
          </header>

          <div className="space-y-3 p-4 sm:p-6">
            {activeSection.fields
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
                  fieldReadOnly={fieldReadOnly}
                  renderFieldAddon={renderFieldAddon}
                  renderFieldInput={renderFieldInput}
                />
              ))}
          </div>

          {enabledSections.length > 1 ? (
            <footer className="flex items-center justify-between gap-3 border-t border-background-200 bg-background-50 px-4 py-3 sm:px-6">
              <button
                type="button"
                onClick={() => onOpenSectionChange(enabledSections[activeIndex - 1].id)}
                disabled={activeIndex === 0}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold text-foreground-600 transition hover:bg-background-100 disabled:invisible"
              >
                <AppIcon className="ri-arrow-left-line"></AppIcon>Previous
              </button>
              {activeIndex < enabledSections.length - 1 ? (
                <button
                  type="button"
                  onClick={() => onOpenSectionChange(enabledSections[activeIndex + 1].id)}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary-600 px-4 text-xs font-bold text-white transition hover:bg-primary-700"
                >
                  Next step<AppIcon className="ri-arrow-right-line"></AppIcon>
                </button>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
                  <AppIcon className="ri-checkbox-circle-line"></AppIcon>Final form step
                </span>
              )}
            </footer>
          ) : null}
        </section>
      </div>
    );
  }

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
                      fieldReadOnly={fieldReadOnly}
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
  field, index, answers, onAnswerChange, errors, readOnly, fieldReadOnly, renderFieldAddon, renderFieldInput,
}: {
  field: ReviewFieldDefinition;
  index: number;
  answers: Record<string, unknown>;
  onAnswerChange: (fieldId: string, value: unknown) => void;
  errors?: ReviewFieldErrorSet;
  readOnly?: boolean;
  fieldReadOnly?: (field: ReviewFieldDefinition) => boolean;
  renderFieldAddon?: (field: ReviewFieldDefinition) => ReactNode;
  renderFieldInput?: ReviewFormRendererProps['renderFieldInput'];
}) {
  const value = answers[field.id];
  const invalid = Boolean(errors?.missingFieldIds.has(field.id));
  const isMeetingSummary = field.configuration?.semanticKey === 'meeting_summary';
  const effectiveReadOnly = fieldReadOnly ? fieldReadOnly(field) : Boolean(readOnly);

  if (field.fieldType === 'title_description') {
    const description = String(field.configuration?.description || '');
    return (
      <div className="rounded-lg border border-background-200 bg-background-100/70 px-4 py-3">
        <div className="flex items-start gap-3">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary-100 text-[12px] font-bold text-primary-700">{index + 1}</span>
          <div>
            <p className="text-sm font-semibold leading-5 text-foreground-900">{field.title}</p>
            {description ? <p className="mt-1 text-sm leading-5 text-foreground-500">{description}</p> : null}
          </div>
        </div>
      </div>
    );
  }

  if (field.fieldType === 'action_button') {
    return (
      <div className="rounded-2xl border border-background-200 bg-background-50 p-4">
        <button type="button" disabled={effectiveReadOnly} className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary-600 px-4 text-xs font-bold text-white shadow-sm transition hover:bg-primary-700 disabled:opacity-60">
          <AppIcon className="ri-flashlight-line"></AppIcon>{field.title}
        </button>
      </div>
    );
  }

  return (
    <div className={cn('rounded-2xl border bg-background-50 p-4 transition focus-within:border-primary-300 focus-within:shadow-sm', invalid ? 'border-red-300' : 'border-background-200')}>
      <label className="mb-2.5 block !text-base !font-semibold !leading-5 !text-foreground-900">
        <span className="mr-2 inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-primary-100 px-1 text-xs font-bold text-primary-700">{index + 1}</span>
        {isMeetingSummary ? 'Meeting Summary' : field.title}
        {field.required ? <span className="ml-1 text-red-500">*</span> : null}
      </label>

      {renderFieldAddon?.(field)}
      {renderFieldInput?.(field, {
        value,
        onChange: (next) => onAnswerChange(field.id, next),
        readOnly: effectiveReadOnly,
        invalid,
      }) ?? (
        <ReviewFieldInput field={field} value={value} onChange={(next) => onAnswerChange(field.id, next)} readOnly={effectiveReadOnly} />
      )}

      {field.fieldType === 'boolean_case_block' ? (
        <div className="mt-3 space-y-3 border-l-2 border-primary-100 pl-4">
          {value === 'yes' ? (field.yesFields || []).map((child, childIndex) => (
            <ReviewFieldControl key={child.id} field={child} index={childIndex} answers={answers} onAnswerChange={onAnswerChange} errors={errors} readOnly={readOnly} fieldReadOnly={fieldReadOnly} renderFieldAddon={renderFieldAddon} renderFieldInput={renderFieldInput} />
          )) : null}
          {value === 'no' ? (field.noFields || []).map((child, childIndex) => (
            <ReviewFieldControl key={child.id} field={child} index={childIndex} answers={answers} onAnswerChange={onAnswerChange} errors={errors} readOnly={readOnly} fieldReadOnly={fieldReadOnly} renderFieldAddon={renderFieldAddon} renderFieldInput={renderFieldInput} />
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
                'flex h-11 items-center justify-center gap-2 rounded-lg border !text-sm !font-semibold !capitalize !leading-5 transition',
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
                'min-h-10 rounded-lg border px-3 py-2 text-left !text-sm !font-medium !leading-5 transition',
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

/**
 * Field ids this respondent role ('participant' i.e. Learner, or 'employer')
 * was opted into answering by the Curriculum template, at any nesting depth.
 * Mirrors the backend's review_instances.writable_field_ids_for_role exactly
 * -- the Coach is never checked against this and can always answer every
 * field regardless, so this is only ever used for the Learner/Employer
 * surfaces that share this same renderer read-only by default.
 */
export function computeWritableFieldIds(sections: ReviewSectionDefinition[], role: 'participant' | 'employer'): Set<string> {
  const ids = new Set<string>();
  const walk = (fields: ReviewFieldDefinition[]) => {
    for (const field of fields) {
      const roles = (field.configuration?.respondentRoles as string[] | undefined) || [];
      if (roles.includes(role)) ids.add(field.id);
      walk(field.yesFields || []);
      walk(field.noFields || []);
    }
  };
  for (const section of sections) walk(section.fields);
  return ids;
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
