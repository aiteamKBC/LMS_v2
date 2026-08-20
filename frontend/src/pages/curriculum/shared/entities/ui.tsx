// ============================================================================
// Shared chrome for the entity-based Curriculum pages.
//
// Everything here is presentation only — it holds no curriculum rules. It exists
// so Cohorts, Groups, Modules and Holidays look like one product rather than
// four, and so a change to the filter bar or the table shell lands everywhere at
// once. Styling follows the tokens the rest of the Curriculum Studio already
// uses (background-*/foreground-*/primary-*, `transition-smooth`, the 12–13px
// type ramp); no new visual language is introduced.
// ============================================================================

import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { RightSlidePanel } from '@/components/feature/RightSlidePanel';
import { showCurriculumConfirm } from '@/components/feature/CurriculumSweetAlert';
import { SkeletonBlock } from '@/components/feature/CurriculumSkeletons';
import { SelectMenu } from '@/components/feature/SelectField';
import { statusTone } from './model';
import { AppIcon } from '@/components/feature/AppIcon';

export interface EntityStat {
  icon: string;
  label: string;
  value: string | number;
  detail?: string;
}

/**
 * The page banner every entity page opens with: what this page manages, the
 * live counts, and the one primary action.
 */
export function EntityHero({
  eyebrow,
  title,
  description,
  stats,
  primaryAction,
  secondaryActions,
  loading,
}: {
  eyebrow: string;
  title: string;
  description: string;
  stats: EntityStat[];
  primaryAction?: { label: string; icon?: string; onClick: () => void; disabled?: boolean };
  secondaryActions?: ReactNode;
  loading?: boolean;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-white/10 bg-primary-950 text-white shadow-xl">
      <div className="relative p-5 sm:p-7">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_0%,rgba(255,255,255,0.18),transparent_34%),linear-gradient(135deg,rgba(109,40,217,0.35),rgba(15,23,42,0))]" />
        <div className="relative flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-3xl">
            <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-white/60">{eyebrow}</p>
            <h2 className="mt-2 text-2xl font-heading font-bold text-white sm:text-3xl">{title}</h2>
            <p className="mt-2 max-w-2xl text-[13px] leading-6 text-white/75">{description}</p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            {primaryAction && (
              <button
                type="button"
                onClick={primaryAction.onClick}
                disabled={primaryAction.disabled}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-white px-4 text-[12px] font-bold text-primary-900 shadow-lg shadow-black/10 transition-smooth hover:bg-primary-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <AppIcon className={`${primaryAction.icon || 'ri-add-line'} text-base`}></AppIcon>
                {primaryAction.label}
              </button>
            )}
            {secondaryActions}
          </div>
        </div>
        <div className="relative mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {stats.map(stat => (
            <div key={stat.label} className="rounded-xl border border-white/10 bg-white/[0.07] p-3">
              <div className="flex items-center gap-2 text-white/70">
                <AppIcon className={`${stat.icon} text-sm`}></AppIcon>
                <span className="text-[10px] font-bold uppercase tracking-wider">{stat.label}</span>
              </div>
              <p className="mt-1.5 text-xl font-heading font-bold text-white">
                {loading ? <span className="inline-block h-5 w-10 animate-pulse rounded bg-white/20" /> : stat.value}
              </p>
              {stat.detail && <p className="mt-0.5 text-[11px] text-white/60">{stat.detail}</p>}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'filter';
}

export interface FilterSelect {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  disabled?: boolean;
  /** Why the control is disabled — shown in place of the hint when set. */
  disabledHint?: string;
}

/**
 * Search + cascading selects. Every entity page filters the same way, and the
 * chosen filters are what a create form prefills from — see `EntityFilterBar`
 * callers, which pass the same state into their drawer.
 */
export function EntityFilterBar({
  search,
  onSearch,
  placeholder,
  selects,
  onReset,
  summary,
  trailing,
}: {
  search: string;
  onSearch: (value: string) => void;
  placeholder: string;
  selects: FilterSelect[];
  onReset: () => void;
  summary?: string;
  trailing?: ReactNode;
}) {
  const dirty = Boolean(search) || selects.some(select => select.value);
  return (
    <div className="rounded-2xl border border-foreground-200/60 bg-background-50 p-4">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <div className="grid flex-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <label className="block">
            <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-foreground-400">Search</span>
            <span className="relative block">
              <AppIcon className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-sm text-foreground-300"></AppIcon>
              <input
                value={search}
                onChange={event => onSearch(event.target.value)}
                placeholder={placeholder}
                className="h-10 w-full rounded-lg border border-background-200 bg-background-50 pl-9 pr-3 text-[13px] text-foreground-900 outline-none transition-smooth focus:border-primary-300"
              />
            </span>
          </label>
          {selects.map(select => (
            <div key={select.label} className="block">
              <span id={`filter-${slug(select.label)}`} className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-foreground-400">
                {select.label}
              </span>
              <SelectMenu
                size="sm"
                value={select.value}
                onChange={select.onChange}
                options={select.options}
                disabled={select.disabled}
                disabledHint={select.disabledHint}
                ariaLabelledBy={`filter-${slug(select.label)}`}
                placeholder={select.options[0]?.label || 'All'}
              />
            </div>
          ))}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {trailing}
          <button
            type="button"
            onClick={onReset}
            disabled={!dirty}
            className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-background-200 bg-background-50 px-3 text-[12px] font-semibold text-foreground-600 transition-smooth hover:bg-background-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <AppIcon className="ri-refresh-line text-sm"></AppIcon>
            Reset
          </button>
        </div>
      </div>
      {summary && <p className="mt-3 text-[11px] font-semibold text-foreground-400">{summary}</p>}
    </div>
  );
}

/**
 * A CSS-grid table. Rows are buttons so the whole row opens the record — the
 * action cell stops propagation for the inline edit/delete controls.
 */
export function EntityTable<T>({
  columns,
  gridClass,
  rows,
  rowKey,
  renderRow,
  loading,
  empty,
}: {
  columns: Array<{ label: string; align?: 'left' | 'center' | 'right' }>;
  gridClass: string;
  rows: T[];
  rowKey: (row: T) => string;
  renderRow: (row: T) => ReactNode;
  loading?: boolean;
  empty: ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-foreground-200/60 bg-background-50">
      <div className="overflow-x-auto">
        <div className="min-w-[860px]">
          <div className={`${gridClass} gap-3 border-b border-background-200 px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-foreground-400`}>
            {columns.map(column => (
              <span
                key={column.label}
                className={column.align === 'right' ? 'text-right' : column.align === 'center' ? 'text-center' : ''}
              >
                {column.label}
              </span>
            ))}
          </div>
          {loading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 6 }).map((_, index) => <SkeletonBlock key={index} className="h-14 w-full" />)}
            </div>
          ) : rows.length ? (
            <div className="divide-y divide-background-200/70">
              {rows.map(row => (
                <div key={rowKey(row)} className={`${gridClass} gap-3 px-4 py-3 transition-smooth hover:bg-background-100/60`}>
                  {renderRow(row)}
                </div>
              ))}
            </div>
          ) : (
            empty
          )}
        </div>
      </div>
    </div>
  );
}

export function EntityEmptyState({
  icon,
  title,
  message,
  action,
}: {
  icon: string;
  title: string;
  message: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="p-12 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-background-100 text-foreground-400">
        <AppIcon className={`${icon} text-xl`}></AppIcon>
      </div>
      <p className="mt-3 text-sm font-bold text-foreground-900">{title}</p>
      <p className="mt-1 text-[12px] text-foreground-400">{message}</p>
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="mt-4 inline-flex h-10 items-center gap-2 rounded-xl bg-primary-600 px-4 text-[12px] font-bold text-white transition-smooth hover:bg-primary-700"
        >
          <AppIcon className="ri-add-line text-sm"></AppIcon>
          {action.label}
        </button>
      )}
    </div>
  );
}

export function StatusBadge({ status }: { status: unknown }) {
  const label = String(status ?? '').trim() || 'Unknown';
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${statusTone(status)}`}>
      {label}
    </span>
  );
}

export function RowActions({ actions }: {
  actions: Array<{ icon: string; label: string; onClick: () => void; tone?: 'default' | 'danger'; disabled?: boolean }>;
}) {
  return (
    <span className="flex items-center justify-end gap-1 self-center">
      {actions.map(action => (
        <button
          key={action.label}
          type="button"
          title={action.label}
          aria-label={action.label}
          disabled={action.disabled}
          onClick={event => { event.stopPropagation(); action.onClick(); }}
          className={`flex h-8 w-8 items-center justify-center rounded-lg border transition-smooth disabled:cursor-not-allowed disabled:opacity-50 ${
            action.tone === 'danger'
              ? 'border-red-100 bg-red-50 text-red-600 hover:bg-red-100'
              : 'border-background-200 bg-background-50 text-foreground-500 hover:bg-background-100'
          }`}
        >
          <AppIcon className={`${action.icon} text-sm`}></AppIcon>
        </button>
      ))}
    </span>
  );
}

/** Two-line cell: a strong primary value with a muted secondary line under it. */
export function StackedCell({ primary, secondary, href }: { primary: ReactNode; secondary?: ReactNode; href?: string }) {
  const body = (
    <>
      <span className="block truncate text-[13px] font-semibold text-foreground-900">{primary}</span>
      {secondary != null && <span className="block truncate text-[11px] text-foreground-400">{secondary}</span>}
    </>
  );
  if (!href) return <span className="min-w-0 self-center">{body}</span>;
  return (
    <Link to={href} className="min-w-0 self-center transition-smooth hover:text-primary-700">
      {body}
    </Link>
  );
}

export function PlainCell({ children, align = 'left' }: { children: ReactNode; align?: 'left' | 'center' | 'right' }) {
  return (
    <span className={`min-w-0 self-center truncate text-[12px] text-foreground-700 ${align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : ''}`}>
      {children}
    </span>
  );
}

// ----------------------------------------------------------------- form kit

export function FormField({
  label,
  children,
  hint,
  error,
  required,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
  error?: string;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1 flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-foreground-400">
        {label}
        {required && <span className="text-red-500">*</span>}
      </span>
      {children}
      {error ? (
        <span className="mt-1 block text-[11px] font-semibold text-red-600">{error}</span>
      ) : hint ? (
        <span className="mt-1 block text-[11px] text-foreground-400">{hint}</span>
      ) : null}
    </label>
  );
}

const CONTROL_CLASS = 'h-10 w-full rounded-lg border border-background-200 bg-background-50 px-3 text-[13px] text-foreground-900 outline-none transition-smooth focus:border-primary-300 disabled:cursor-not-allowed disabled:bg-background-100 disabled:text-foreground-400';

export function TextControl({
  value,
  onChange,
  type = 'text',
  placeholder,
  disabled,
  min,
  max,
  step,
}: {
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
  disabled?: boolean;
  min?: string | number;
  max?: string | number;
  step?: string | number;
}) {
  return (
    <input
      type={type}
      value={value}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      placeholder={placeholder}
      onChange={event => onChange(event.target.value)}
      className={CONTROL_CLASS}
    />
  );
}

export function TextAreaControl({
  value,
  onChange,
  rows = 3,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  placeholder?: string;
}) {
  return (
    <textarea
      value={value}
      rows={rows}
      placeholder={placeholder}
      onChange={event => onChange(event.target.value)}
      className="w-full rounded-lg border border-background-200 bg-background-50 px-3 py-2 text-[13px] text-foreground-900 outline-none transition-smooth focus:border-primary-300"
    />
  );
}

export function SelectControl({
  value,
  onChange,
  options,
  disabled,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  disabled?: boolean;
  placeholder?: string;
}) {
  return (
    <SelectMenu
      value={value}
      onChange={onChange}
      options={options}
      disabled={disabled}
      placeholder={placeholder || 'Select'}
      clearable={Boolean(placeholder)}
    />
  );
}

const COLOR_PRESETS = ['#6d28d9', '#2563eb', '#0f766e', '#16a34a', '#ea580c', '#dc2626', '#be123c', '#334155'];

export function ColorControl({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        type="color"
        value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#6941c6'}
        onChange={event => onChange(event.target.value)}
        className="h-10 w-14 cursor-pointer rounded-lg border border-background-200 bg-background-50 p-1"
        aria-label="Pick a colour"
      />
      {COLOR_PRESETS.map(preset => (
        <button
          key={preset}
          type="button"
          onClick={() => onChange(preset)}
          aria-label={`Use ${preset}`}
          style={{ backgroundColor: preset }}
          className={`h-7 w-7 rounded-lg border-2 transition-smooth ${value.toLowerCase() === preset ? 'border-foreground-900' : 'border-transparent'}`}
        />
      ))}
    </div>
  );
}

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** Delivery days as a comma-separated string, which is how the API stores them. */
export function WeekdayControl({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const selected = value.split(',').map(day => day.trim()).filter(Boolean);
  const toggle = (day: string) => {
    const next = selected.includes(day) ? selected.filter(item => item !== day) : [...selected, day];
    onChange(WEEKDAYS.filter(item => next.includes(item)).join(', '));
  };
  return (
    <div className="flex flex-wrap gap-1.5">
      {WEEKDAYS.map(day => {
        const active = selected.includes(day);
        return (
          <button
            key={day}
            type="button"
            onClick={() => toggle(day)}
            className={`h-9 rounded-lg border px-3 text-[11px] font-bold transition-smooth ${
              active
                ? 'border-primary-600 bg-primary-600 text-white'
                : 'border-background-200 bg-background-50 text-foreground-600 hover:bg-background-100'
            }`}
          >
            {day.slice(0, 3)}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The focused create/edit surface. Simple records are edited here rather than on
 * a page of their own; anything operational (a module's schedule, its Teams
 * series, its components) gets a full workspace instead.
 */
export function EntityDrawer({
  open,
  title,
  subtitle,
  onClose,
  onSubmit,
  submitLabel,
  saving,
  error,
  dirty = false,
  children,
  width = 'w-[520px]',
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  onSubmit: () => void | Promise<void>;
  submitLabel: string;
  saving?: boolean;
  error?: string | null;
  /**
   * The form has been answered but not saved. Closing a dirty drawer asks
   * before it throws the answers away; a clean one closes straight away.
   */
  dirty?: boolean;
  children: ReactNode;
  width?: string;
}) {
  const firstFieldRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const input = firstFieldRef.current?.querySelector<HTMLElement>('input, select, textarea');
    input?.focus();
  }, [open]);

  // True while the discard dialog is up. Escape reaches this component and
  // SweetAlert's own handler in the same event, so without the flag dismissing
  // the dialog with the keyboard immediately raises a second one.
  const confirmingDiscard = useRef(false);

  // Every way out of the drawer — the header cross, the backdrop, Escape and
  // Cancel — comes through here, so none of them can lose typed answers.
  const requestClose = () => {
    if (saving) return;
    if (!dirty) { onClose(); return; }
    if (confirmingDiscard.current) return;
    confirmingDiscard.current = true;
    void showCurriculumConfirm({
      title: 'Discard unsaved changes?',
      text: 'This form has answers that have not been saved. Closing it now throws them away.',
      icon: 'warning',
      confirmButtonText: 'Discard changes',
      cancelButtonText: 'Keep editing',
      onConfirm: () => { onClose(); },
    }).finally(() => { confirmingDiscard.current = false; });
  };

  // The slide panel stays mounted so it can animate, but its form does not: a
  // closed drawer that keeps its inputs in the DOM leaves tab-reachable fields
  // behind the page, and a page with two drawers ends up with two sets of
  // identically-labelled controls.
  if (!open) return <RightSlidePanel isOpen={false} onClose={onClose} title={title} width={width}><div /></RightSlidePanel>;

  return (
    <RightSlidePanel isOpen={open} onClose={requestClose} title={title} width={width}>
      <form
        className="flex h-full min-h-0 flex-col"
        onSubmit={event => { event.preventDefault(); void onSubmit(); }}
      >
        <div ref={firstFieldRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5">
          {subtitle && <p className="text-[12px] leading-5 text-foreground-500">{subtitle}</p>}
          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-[12px] font-semibold text-red-700">
              <AppIcon className="ri-error-warning-line mt-0.5 text-sm"></AppIcon>
              <span>{error}</span>
            </div>
          )}
          {children}
        </div>
        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-background-200 px-5 py-4">
          <button
            type="button"
            onClick={requestClose}
            disabled={saving}
            className="inline-flex h-10 items-center rounded-xl border border-background-200 bg-background-50 px-4 text-[12px] font-bold text-foreground-600 transition-smooth hover:bg-background-100 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-primary-600 px-4 text-[12px] font-bold text-white transition-smooth hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving && <AppIcon className="ri-loader-4-line animate-spin text-sm"></AppIcon>}
            {submitLabel}
          </button>
        </div>
      </form>
    </RightSlidePanel>
  );
}

// -------------------------------------------------------------- workspaces

export interface WorkspaceTab {
  key: string;
  label: string;
  icon: string;
  count?: number;
}

/** Breadcrumb + title + KPI rail + tab strip, shared by the three workspaces. */
export function WorkspaceHeader({
  breadcrumbs,
  eyebrow,
  title,
  subtitle,
  accentColor,
  stats,
  actions,
}: {
  breadcrumbs: Array<{ label: string; href?: string }>;
  eyebrow: string;
  title: string;
  subtitle: string;
  accentColor?: string;
  stats: EntityStat[];
  actions?: ReactNode;
}) {
  return (
    <section className="relative overflow-hidden rounded-2xl border border-foreground-200/70 bg-background-50 shadow-sm">
      <div className="absolute inset-y-0 left-0 w-1.5" style={{ backgroundColor: accentColor || 'oklch(var(--primary-500))' }} aria-hidden="true" />
      <div className="p-5 pl-6 sm:p-6 sm:pl-7">
        <nav className="mb-2 flex flex-wrap items-center gap-1.5 text-[11px] text-foreground-400">
          {breadcrumbs.map((crumb, index) => (
            <span key={`${crumb.label}-${index}`} className="flex items-center gap-1.5">
              {index > 0 && <AppIcon className="ri-arrow-right-s-line text-[10px]"></AppIcon>}
              {crumb.href ? (
                <Link to={crumb.href} className="font-semibold transition-smooth hover:text-primary-700">{crumb.label}</Link>
              ) : (
                <span className="font-semibold text-foreground-600">{crumb.label}</span>
              )}
            </span>
          ))}
        </nav>
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary-600">{eyebrow}</p>
            <h1 className="mt-1 text-2xl font-heading font-black leading-tight tracking-tight text-foreground-950">{title}</h1>
            <p className="mt-1 text-[13px] leading-6 text-foreground-500">{subtitle}</p>
          </div>
          {actions && <div className="flex flex-wrap gap-2 xl:justify-end">{actions}</div>}
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3 border-t border-foreground-200/60 pt-4 sm:grid-cols-3 xl:grid-cols-6">
          {stats.map(stat => (
            <div key={stat.label} className="rounded-xl border border-background-200 bg-background-100/60 p-3">
              <div className="flex items-center gap-1.5 text-foreground-400">
                <AppIcon className={`${stat.icon} text-sm`}></AppIcon>
                <span className="text-[10px] font-bold uppercase tracking-wider">{stat.label}</span>
              </div>
              <p className="mt-1 text-lg font-heading font-bold text-foreground-950">{stat.value}</p>
              {stat.detail && <p className="text-[11px] text-foreground-400">{stat.detail}</p>}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function WorkspaceTabs({
  tabs,
  active,
  onChange,
  trailing,
}: {
  tabs: WorkspaceTab[];
  active: string;
  onChange: (key: string) => void;
  trailing?: ReactNode;
}) {
  return (
    <div className="sticky top-0 z-20 flex items-center gap-2 rounded-2xl border border-foreground-200/70 bg-background-50/95 p-1.5 shadow-sm backdrop-blur">
      <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto">
        {tabs.map(tab => (
          <button
            key={tab.key}
            type="button"
            onClick={() => onChange(tab.key)}
            className={`group inline-flex min-h-10 items-center gap-2 whitespace-nowrap rounded-xl px-3 py-1.5 text-[12px] font-bold transition-smooth ${
              active === tab.key ? 'bg-primary-600 text-white shadow-sm' : 'text-foreground-600 hover:bg-background-100 hover:text-foreground-900'
            }`}
          >
            <span className={`flex h-7 w-7 items-center justify-center rounded-lg ${active === tab.key ? 'bg-white/[0.16] text-white' : 'bg-background-100 text-foreground-500 group-hover:bg-background-50'}`}>
              <AppIcon className={`${tab.icon} text-[14px]`}></AppIcon>
            </span>
            <span>{tab.label}</span>
            {tab.count != null && (
              <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${active === tab.key ? 'bg-white/[0.15] text-white' : 'bg-foreground-100 text-foreground-500'}`}>
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>
      {trailing && <div className="flex shrink-0 items-center gap-2 border-l border-background-200 pl-2">{trailing}</div>}
    </div>
  );
}

export function WorkspacePanel({ title, description, actions, children }: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-foreground-200/60 bg-background-50">
      <div className="flex flex-col gap-2 border-b border-background-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h3 className="text-[13px] font-heading font-bold text-foreground-950">{title}</h3>
          {description && <p className="mt-0.5 text-[12px] text-foreground-500">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

export function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-background-200/70 py-2.5 last:border-b-0">
      <span className="text-[11px] font-bold uppercase tracking-wider text-foreground-400">{label}</span>
      <span className="min-w-0 text-right text-[13px] font-semibold text-foreground-900">{value}</span>
    </div>
  );
}

export function InlineError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[12px] font-semibold text-red-700">
      <AppIcon className="ri-error-warning-line text-sm"></AppIcon>
      <span className="min-w-0 flex-1">{message}</span>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 text-[11px] font-bold text-red-700 transition-smooth hover:bg-red-100"
        >
          <AppIcon className="ri-refresh-line"></AppIcon>
          Retry
        </button>
      )}
    </div>
  );
}
