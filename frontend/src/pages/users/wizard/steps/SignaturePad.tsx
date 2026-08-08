import { useEffect, useState } from 'react';
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
 * The name is NOT editable. It is whoever is actually signing — the signed-in
 * account by default, or the party named by `signatoryName` (the learner on
 * their own document, the employer in their portal). A signature that could be
 * typed as any name is not a signature; fixing it to the identity on record is
 * the whole point.
 *
 * There is no drawing and no stored "saved signature" to reuse: the same name
 * always produces the same mark, so reuse is automatic rather than something to
 * capture once and carry around.
 *
 * The committed value is a PNG data URL, exactly as the old drawn pad produced.
 * That is deliberate: every signature column, PDF signature block and
 * `startsWith('data:image/')` guard keeps working untouched, and signatures
 * captured before this change still render.
 */
export function SignaturePad({
  onCommit,
  onCancel,
  signatoryName,
  /** @deprecated Use `signatoryName`. Kept so older call sites keep compiling. */
  defaultName,
}: {
  onCommit: (dataUrl: string) => void;
  onCancel: () => void;
  /** Who is signing. Falls back to the signed-in account when omitted. */
  signatoryName?: string;
  defaultName?: string;
}) {
  const { auth } = useAuth();
  const name = (signatoryName || defaultName || auth.user?.fullName || '').trim();

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

  const commit = async () => {
    if (!name) {
      setErr('No name is on record for the signatory, so this cannot be signed.');
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      const dataUrl = await createTypedSignature(name);
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
      <div>
        <p className="text-[12px] text-foreground-700 mb-1">Signing as</p>
        <p className="text-[13px] font-medium text-foreground-900">
          {name || <span className="text-red-600">No name on record</span>}
        </p>
      </div>

      {/* Exactly what will be stored. */}
      <div className="rounded-lg border-2 border-dashed border-foreground-200 bg-background-50 px-3 py-4 min-h-[80px] flex items-center justify-center overflow-x-auto">
        {name ? (
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
            {name}
          </span>
        ) : (
          <span className="text-[12px] text-foreground-400">
            A signature cannot be produced without a name on record.
          </span>
        )}
      </div>

      <p className="text-[11px] text-foreground-400">
        Confirming below has the same effect as signing by hand.
      </p>

      {err && <p className="text-[12px] text-red-600">{err}</p>}

      <div className="flex items-center gap-2">
        <button
          type="button"
          className={btnPrimary}
          onClick={() => void commit()}
          disabled={saving || !name}
        >
          <i className="ri-check-line" />
          {saving ? 'Signing…' : 'Sign'}
        </button>
        <button type="button" className={btnSecondary} onClick={onCancel} disabled={saving}>
          Cancel
        </button>
      </div>
    </div>
  );
}
