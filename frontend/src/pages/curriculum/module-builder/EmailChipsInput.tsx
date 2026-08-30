import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppIcon } from '@/components/feature/AppIcon';

/** Split a newline/comma/semicolon/space-separated string into trimmed emails. */
export function emailList(value: string): string[] {
  return value.split(/[\s,;]+/).map(item => item.trim()).filter(Boolean);
}

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * Presenters/Attendees as removable chips instead of a raw "one per line"
 * textarea — each name typed or pasted becomes its own pill, invalid-looking
 * addresses are flagged in place, and Enter/comma/semicolon/paste all commit
 * a chip the same way. The value stays the newline-joined string every other
 * caller already reads and writes (`emailList()` at submit, `patch()` from
 * Prefill) — this only changes how it is edited, not what it is.
 */
export function EmailChipsInput({ value, onChange, placeholder = 'Type an email and press Enter…' }: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  const emails = useMemo(() => emailList(value), [value]);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  // The outside-click listener below fires from a document-level handler, so
  // it needs whatever was last typed without re-subscribing on every
  // keystroke.
  const draftRef = useRef(draft);
  draftRef.current = draft;

  const commit = useCallback((raw: string) => {
    const additions = emailList(raw).map(email => email.toLowerCase());
    if (!additions.length) { setDraft(''); return; }
    onChange(Array.from(new Set([...emails, ...additions])).join('\n'));
    setDraft('');
  }, [emails, onChange]);

  const removeAt = (index: number) => {
    onChange(emails.filter((_, i) => i !== index).join('\n'));
  };

  // A half-typed draft is only ever committed by Enter/comma/paste, or by a
  // click that lands outside the whole box -- never by a click landing
  // *inside* it (another chip's remove or edit button, empty padding, a
  // non-focusable area), which blur alone cannot tell apart from a real
  // "I'm done here" click.
  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (!draftRef.current.trim()) return;
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        commit(draftRef.current);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [commit]);

  // Editing is "un-commit this chip back into the draft" rather than typing
  // in place inside the pill: the same Enter-to-commit path then re-validates
  // whatever comes out, so a correction can't skip the checks a fresh chip
  // gets.
  const editAt = (index: number) => {
    setDraft(emails[index]);
    onChange(emails.filter((_, i) => i !== index).join('\n'));
    inputRef.current?.focus();
  };

  return (
    <div
      ref={containerRef}
      className="flex min-h-[84px] w-full flex-wrap items-center gap-1.5 rounded-lg border border-background-200 bg-background-50 px-2.5 py-2 outline-none transition-smooth focus-within:border-primary-300"
      onClick={() => inputRef.current?.focus()}
    >
      {emails.map((email, index) => {
        const valid = EMAIL_PATTERN.test(email);
        return (
          <span
            key={`${email}-${index}`}
            className={`inline-flex max-w-full items-center gap-1 rounded-full border py-1 pl-2 pr-1 text-[11px] font-semibold ${
              valid ? 'border-primary-200 bg-primary-50 text-primary-800' : 'border-red-200 bg-red-50 text-red-700'
            }`}
          >
            <AppIcon className="ri-circle-fill shrink-0 text-[5px]"></AppIcon>
            <button
              type="button"
              onClick={event => { event.stopPropagation(); editAt(index); }}
              className="max-w-full truncate rounded-sm text-left hover:underline"
              title="Click to edit"
            >
              {email}
            </button>
            <button
              type="button"
              onClick={event => { event.stopPropagation(); removeAt(index); }}
              className="shrink-0 rounded-full p-0.5 transition-smooth hover:bg-black/10"
              aria-label={`Remove ${email}`}
            >
              <AppIcon className="ri-close-line text-[11px]"></AppIcon>
            </button>
          </span>
        );
      })}
      <input
        ref={inputRef}
        type="text"
        inputMode="email"
        value={draft}
        onChange={event => setDraft(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'Enter' || event.key === ',' || event.key === ';') {
            event.preventDefault();
            commit(draft);
          } else if (event.key === 'Backspace' && !draft && emails.length) {
            removeAt(emails.length - 1);
          }
        }}
        onPaste={event => {
          const text = event.clipboardData.getData('text');
          if (/[\s,;]/.test(text.trim())) {
            event.preventDefault();
            commit(text);
          }
        }}
        placeholder={emails.length ? '' : placeholder}
        className="min-w-[160px] flex-1 border-0 bg-transparent p-1 text-[13px] text-foreground-900 outline-none placeholder:text-foreground-400"
      />
    </div>
  );
}
