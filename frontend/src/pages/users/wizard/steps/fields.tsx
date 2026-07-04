import type { ReactNode } from 'react';
import { FieldRow, inputClass } from '../../components/ui';

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
  return (
    <FieldRow label={label} required={required}>
      <input type={type} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className={inputClass} />
      {helper && <p className="text-[11px] text-foreground-400 mt-1">{helper}</p>}
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

/** Simple signature capture placeholder (mock): shows a signed state or an upload/sign affordance. */
export function SignatureField({ label = 'User signature', value, onChange }: { label?: string; value?: string; onChange: (v: string) => void }) {
  return (
    <div className="py-2.5">
      <p className="text-[12px] text-foreground-500 font-medium mb-2">{label}</p>
      {value ? (
        <div className="flex items-center gap-3">
          <span className="px-4 py-6 border border-foreground-200 rounded-lg text-[13px] italic text-foreground-700 bg-background-50" style={{ fontFamily: 'cursive' }}>{value}</span>
          <button onClick={() => onChange('')} className="text-[12px] text-red-500 hover:underline cursor-pointer">Clear</button>
        </div>
      ) : (
        <button
          onClick={() => onChange('Signed digitally')}
          className="w-full max-w-md h-24 border-2 border-dashed border-foreground-200 rounded-lg flex flex-col items-center justify-center text-foreground-400 hover:border-primary-300 hover:text-primary-500 transition-smooth cursor-pointer"
        >
          <i className="ri-pen-nib-line text-2xl mb-1" />
          <span className="text-[12px]">Click to sign</span>
        </button>
      )}
    </div>
  );
}

export function StepHeading({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-5">
      <h2 className="text-[20px] font-heading font-semibold text-foreground-900 tracking-tight">{title}</h2>
      {subtitle && <p className="text-[14px] font-medium text-primary-600 mt-1">{subtitle}</p>}
    </div>
  );
}
