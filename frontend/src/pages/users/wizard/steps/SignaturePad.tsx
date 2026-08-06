import { useEffect, useMemo, useState } from 'react';
import { btnPrimary, btnSecondary } from '../../components/ui';
import { useAuth } from '@/hooks/useAuth';
import {
  SIGNATURE_FONT_FAMILY,
  createTypedSignature,
  ensureSignatureFont,
} from '@/lib/typedSignature';

/**
 * Signature capture: the signatory's own name, set in a script face.
 *
 * This replaced a draw-or-upload pad. Typing the name means one person's
 * signature is identical every time they sign and is legible in the document,
 * and there is nothing to redraw badly on a trackpad.
 *
 * The name defaults to the signed-in account holder's, so the common case is
 * simply to confirm. It stays editable because the account name is not always
 * the legal name that belongs on a statutory form — and because a learner may
 * be signing on a page opened by staff.
 *
 * The committed value is still a PNG data URL, exactly as the drawn pad
 * produced. That is deliberate: every signature column, PDF signature block and
 * `startsWith('data:image/')` guard keeps working untouched, and signatures
 * captured before this change still render.
 */
export function SignaturePad({
  onCommit,
  onCancel,
  defaultName,
}: {
  onCommit: (dataUrl: string) => void;
  onCancel: () => void;
  /** Overrides the signed-in account's name (e.g. staff opening a learner's form). */
  defaultName?: string;
}) {
  const { auth } = useAuth();
  const accountName = defaultName || auth.user?.fullName || '';

  const [name, setName] = useState(accountName);
  const [fontReady, setFontReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // The preview must not render in a fallback face before the script font
  // loads, or it misrepresents what will be stored.
  useEffect(() => {
    let cancelled = false;
    void ensureSignatureFont().then(() => {
      if (!cancelled) setFontReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Adopt the account name once it resolves, but never overwrite what the
  // signatory has typed.
  useEffect(() => {
    setName((current) => current || accountName);
  }, [accountName]);

  const trimmed = useMemo(() => name.trim(), [name]);

  const commit = async () => {
    if (!trimmed) {
      setErr('Enter the name to sign with.');
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      const dataUrl = await createTypedSignature(trimmed);
      if (!dataUrl) {
        setErr('Could not create the signature. Please try again.');
        return;
      }
      onCommit(dataUrl);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="border border-foreground-200 rounded-xl p-3 max-w-md space-y-3">
      <label className="block">
        <span className="text-[12px] text-foreground-700 block mb-1">
          Full name <span className="text-red-500">*</span>
        </span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your full name"
          className="w-full bg-background-100 border border-foreground-200 rounded-lg px-2.5 py-2 text-[13px] text-foreground-800 focus:outline-none focus:ring-1 focus:ring-primary-400/40"
        />
      </label>

      {/* Exactly what will be stored. */}
      <div className="rounded-lg border-2 border-dashed border-foreground-200 bg-background-50 px-3 py-4 min-h-[80px] flex items-center justify-center overflow-x-auto">
        {trimmed ? (
          <span
            className="text-foreground-900 whitespace-nowrap"
            style={{
              fontFamily: `"${SIGNATURE_FONT_FAMILY}", cursive`,
              fontSize: '32px',
              lineHeight: 1.4,
              // Hide the fallback face until the real one is ready.
              opacity: fontReady ? 1 : 0,
              transition: 'opacity 120ms ease',
            }}
          >
            {trimmed}
          </span>
        ) : (
          <span className="text-[12px] text-foreground-400">
            Type your name above to preview your signature
          </span>
        )}
      </div>

      <p className="text-[11px] text-foreground-400">
        Typing your name and confirming has the same effect as signing by hand.
      </p>

      {err && <p className="text-[12px] text-red-600">{err}</p>}

      <div className="flex items-center gap-2">
        <button
          type="button"
          className={btnPrimary}
          onClick={() => void commit()}
          disabled={saving || !trimmed}
        >
          <i className="ri-check-line" />
          {saving ? 'Signing…' : 'Use signature'}
        </button>
        <button type="button" className={btnSecondary} onClick={onCancel} disabled={saving}>
          Cancel
        </button>
      </div>
    </div>
  );
}
