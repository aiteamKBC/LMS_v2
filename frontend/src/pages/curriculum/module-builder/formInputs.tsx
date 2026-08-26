import { useEffect, useState } from 'react';

// Small labelled form atoms shared by the Module Builder page and the Teams
// meeting modal. They live here rather than in page.tsx so the modal (which the
// Week Builder also renders) can reuse them without importing the whole page —
// which would create a page <-> modal import cycle.

export function TextInput({ label, value, onChange, required, error }: { label: string; value: string; onChange: (value: string) => void; required?: boolean; error?: string }) {
  return (
    <label className="block">
      <span className="text-[10px] font-semibold text-foreground-400 uppercase">{label}{required ? ' *' : ''}</span>
      <input required={required} value={value} onChange={event => onChange(event.target.value)} className={`mt-1 h-10 w-full rounded-lg border bg-background-50 px-3 text-[13px] text-foreground-900 transition-smooth focus:outline-none ${error ? 'border-red-300 focus:border-red-400' : 'border-foreground-200/60 focus:border-primary-300'}`} />
      {error && <span className="mt-1 block text-[11px] font-semibold text-red-600">{error}</span>}
    </label>
  );
}

export function ReadOnlyInput({ label, value }: { label: string; value: string }) {
  return (
    <label className="block">
      <span className="text-[10px] font-semibold text-foreground-400 uppercase">{label}</span>
      <input type="text" value={value} readOnly className="mt-1 w-full px-3 py-2 bg-background-50 border border-foreground-200/60 rounded-lg text-[13px] text-foreground-900 outline-none" />
    </label>
  );
}

export function TextArea({ label, value, onChange, rows = 3, error }: { label: string; value: string; onChange: (value: string) => void; rows?: number; error?: string }) {
  return (
    <label className="block">
      <span className="text-[10px] font-semibold text-foreground-400 uppercase">{label}</span>
      <textarea value={value} onChange={event => onChange(event.target.value)} rows={rows} className={`mt-1 w-full resize-y rounded-lg border bg-background-50 px-3 py-2 text-[13px] text-foreground-900 transition-smooth focus:outline-none ${error ? 'border-red-300 focus:border-red-400' : 'border-foreground-200/60 focus:border-primary-300'}`} />
      {error && <span className="mt-1 block text-[11px] font-semibold text-red-600">{error}</span>}
    </label>
  );
}

function formatNumberDraft(value: number) {
  return Number.isFinite(value) ? String(value) : '';
}

function parseNumberDraft(value: string) {
  if (value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function NumberInput({ label, value, onChange, min, max, step, error }: { label: string; value: number; onChange: (value: number) => void; min?: number; max?: number; step?: number; error?: string }) {
  const [draft, setDraft] = useState(formatNumberDraft(value));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setDraft(formatNumberDraft(value));
  }, [focused, value]);

  const updateDraft = (nextValue: string) => {
    setDraft(nextValue);
    const parsed = parseNumberDraft(nextValue);
    if (parsed !== null) onChange(parsed);
  };

  return (
    <label className="block">
      <span className="text-[10px] font-semibold text-foreground-400 uppercase">{label}</span>
      <input
        type="number"
        value={focused ? draft : formatNumberDraft(value)}
        min={min}
        max={max}
        step={step}
        onFocus={() => {
          setFocused(true);
          setDraft(formatNumberDraft(value));
        }}
        onBlur={() => {
          setFocused(false);
          const parsed = parseNumberDraft(draft);
          setDraft(parsed === null ? formatNumberDraft(value) : formatNumberDraft(parsed));
        }}
        onChange={event => updateDraft(event.target.value)}
        className={`mt-1 w-full rounded-lg border bg-background-50 px-3 py-2 text-[13px] text-foreground-900 focus:outline-none ${error ? 'border-red-300 focus:border-red-400' : 'border-foreground-200/60 focus:border-primary-300'}`}
      />
      {error && <span className="mt-1 block text-[11px] font-semibold text-red-600">{error}</span>}
    </label>
  );
}

export function SelectInput({
  label,
  value,
  options,
  labels,
  onChange,
  error,
  helper,
  disabled = false,
}: {
  label: string;
  value: string;
  options: readonly string[];
  labels?: Record<string, string>;
  onChange: (value: string) => void;
  error?: string;
  helper?: string;
  disabled?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-[10px] font-semibold text-foreground-400 uppercase">{label}</span>
      <select
        value={value}
        disabled={disabled}
        onChange={event => onChange(event.target.value)}
        className={`mt-1 w-full rounded-lg border px-3 py-2 text-[13px] text-foreground-900 focus:outline-none disabled:cursor-not-allowed disabled:bg-background-100 disabled:text-foreground-400 ${error ? 'border-red-300 bg-background-50 focus:border-red-400' : 'border-foreground-200/60 bg-background-50 focus:border-primary-300'}`}
      >
        {options.map(option => <option key={option || 'empty'} value={option}>{labels?.[option] || option}</option>)}
      </select>
      {error && <span className="mt-1 block text-[11px] font-semibold text-red-600">{error}</span>}
      {!error && helper && <span className="mt-1 block text-[11px] font-semibold text-foreground-400">{helper}</span>}
    </label>
  );
}

export function Checkbox({ label, checked, onChange, disabled = false }: { label: string; checked: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
  return (
    <label className={`flex items-center gap-2 rounded-lg border border-background-200 bg-background-50 px-3 py-2 text-[12px] font-semibold text-foreground-700 ${disabled ? 'opacity-60' : ''}`}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)} className="accent-primary-600" />
      <span>{label}</span>
    </label>
  );
}
