import { useState, type ReactNode } from 'react';
import { FieldRow, inputClass } from '../../components/ui';
import { SignaturePad } from './SignaturePad';

/**
 * Format rules for typed inputs.
 *
 * `type="email"` / `type="tel"` alone do not enforce anything here: the browser
 * only applies its own email check on native form submit, and never validates
 * `tel` at all. These fields live outside a <form>, so without an explicit check
 * a single letter is accepted as an email address or a phone number.
 */
// Deliberately permissive: something@something.tld, no spaces. Stricter regexes
// reject addresses that are legitimately valid.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
// UK-friendly: digits with optional +, spaces, dashes, brackets; 10-15 digits.
const PHONE_RE = /^\+?[\d\s().-]{9,}$/;
const digitsOf = (v: string) => v.replace(/\D/g, '');

/** A format complaint for a filled value, or '' when it is acceptable. */
export function formatError(type: string, value: string): string {
  const v = value.trim();
  if (!v) return ''; // emptiness is the required-check's job, not this one
  if (type === 'email' && !EMAIL_RE.test(v)) return 'Enter a valid email address, e.g. name@example.com';
  if (type === 'tel') {
    if (!PHONE_RE.test(v)) return 'Enter a valid phone number, digits only';
    const digits = digitsOf(v);
    if (digits.length < 10 || digits.length > 15) return 'Enter a valid phone number (10–15 digits)';
  }
  if (type === 'number' && Number.isNaN(Number(v))) return 'Enter a number';
  return '';
}

export function LabeledInput({
  label,
  type = 'text',
  value,
  onChange,
  required,
  placeholder,
  helper,
}: {
  label: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  placeholder?: string;
  helper?: ReactNode;
}) {
  // Complain only after the learner has left the field, so an address isn't
  // marked invalid while it is still being typed.
  const [touched, setTouched] = useState(false);
  const error = touched ? formatError(type, value) : '';

  return (
    <FieldRow label={label} required={required}>
      <input
        type={type}
        value={value}
        placeholder={placeholder ?? (type === 'email' ? 'name@example.com' : type === 'tel' ? '07123 456789' : undefined)}
        inputMode={type === 'tel' ? 'tel' : type === 'email' ? 'email' : undefined}
        autoComplete={type === 'email' ? 'email' : type === 'tel' ? 'tel' : undefined}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => setTouched(true)}
        aria-invalid={error ? true : undefined}
        className={`${inputClass}${error ? ' !border-red-400 focus:!border-red-400' : ''}`}
      />
      {error && <p className="text-[11px] text-red-600 mt-1"><i className="ri-error-warning-line mr-1" />{error}</p>}
      {helper && !error && <p className="text-[11px] text-foreground-400 mt-1">{helper}</p>}
    </FieldRow>
  );
}

export function LabeledSelect({
  label,
  value,
  options,
  onChange,
  required,
  placeholder = 'Select…',
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
  required?: boolean;
  placeholder?: string;
}) {
  return (
    <FieldRow label={label} required={required}>
      <select value={value} onChange={(e) => onChange(e.target.value)} className={`${inputClass} cursor-pointer`}>
        <option value="">{placeholder}</option>
        {options.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    </FieldRow>
  );
}

export function LabeledTextarea({
  label,
  value,
  onChange,
  rows = 3,
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  required?: boolean;
}) {
  return (
    <FieldRow label={label} required={required}>
      <textarea rows={rows} value={value} onChange={(e) => onChange(e.target.value)} className={inputClass} />
    </FieldRow>
  );
}

/**
 * Signature capture. The value is a PNG data URL once signed — drawn by hand or
 * uploaded from an existing image (see SignaturePad). Legacy values that are
 * plain text (e.g. 'Signed digitally' from before capture existed) still render,
 * as italic text rather than an image.
 */
export function SignatureField({ label = 'User signature', value, onChange }: { label?: string; value?: string; onChange: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const isImage = Boolean(value && value.startsWith('data:image/'));

  return (
    <div className="py-2.5">
      <p className="text-[12px] text-foreground-500 font-medium mb-2">{label}</p>

      {editing ? (
        <SignaturePad
          onCommit={(url) => { onChange(url); setEditing(false); }}
          onCancel={() => setEditing(false)}
        />
      ) : value ? (
        <div className="flex items-center gap-3 flex-wrap">
          {isImage ? (
            <img src={value} alt={label} className="h-16 max-w-[280px] object-contain px-3 py-2 border border-foreground-200 rounded-lg bg-white" />
          ) : (
            <span className="px-4 py-6 border border-foreground-200 rounded-lg text-[13px] italic text-foreground-700 bg-background-50" style={{ fontFamily: 'cursive' }}>{value}</span>
          )}
          <button onClick={() => setEditing(true)} className="text-[12px] text-primary-600 hover:underline cursor-pointer inline-flex items-center gap-1">
            <AppIcon className="ri-pen-nib-line" />Replace
          </button>
          <button onClick={() => onChange('')} className="text-[12px] text-red-500 hover:underline cursor-pointer">Clear</button>
        </div>
      ) : (
        <button
          onClick={() => setEditing(true)}
          className="w-full max-w-md h-24 border-2 border-dashed border-foreground-200 rounded-lg flex flex-col items-center justify-center text-foreground-400 hover:border-primary-300 hover:text-primary-500 transition-smooth cursor-pointer"
        >
          <AppIcon className="ri-pen-nib-line text-2xl mb-1" />
          <span className="text-[12px]">Click to sign or upload</span>
        </button>
      )}
    </div>
  );
}

export function StepHeading({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-5">
      <h2 className="font-heading text-lg font-semibold tracking-tight text-foreground-900 sm:text-[20px]">{title}</h2>
      {subtitle && <p className="text-[14px] font-medium text-primary-600 mt-1">{subtitle}</p>}
    </div>
  );
}
