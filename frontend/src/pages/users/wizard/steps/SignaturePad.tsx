import { useEffect, useRef, useState } from 'react';
import SignaturePadLib from 'signature_pad';
import { btnPrimary, btnSecondary } from '../../components/ui';
import { useAuth } from '@/hooks/useAuth';

/**
 * Signature capture: the signatory draws their own signature.
 *
 * The name is not editable. It is whoever is actually signing: the signed-in
 * account by default, or the party named by `signatoryName`.
 *
 * The committed value remains a PNG data URL, so existing backend validation,
 * PDF rendering, and historical signatures keep working.
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

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const padRef = useRef<SignaturePadLib | null>(null);
  const drawingRef = useRef<ReturnType<SignaturePadLib['toData']>>([]);
  const drawingWidthRef = useRef(0);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [hasInk, setHasInk] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    const width = canvas.getBoundingClientRect().width || 360;
    const height = 160;
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    const context = canvas.getContext('2d');
    if (!context) {
      setErr('Signature capture is not available in this browser.');
      return undefined;
    }
    context.scale(ratio, ratio);

    const pad = new SignaturePadLib(canvas, {
      backgroundColor: 'rgb(255,255,255)',
      penColor: 'rgb(15,23,42)',
    });
    if (drawingRef.current.length) {
      const scale = drawingWidthRef.current ? width / drawingWidthRef.current : 1;
      pad.fromData(drawingRef.current.map(group => ({
        ...group,
        points: group.points.map(point => ({ ...point, x: point.x * scale })),
      })));
    }
    drawingWidthRef.current = width;
    padRef.current = pad;
    setHasInk(!pad.isEmpty());

    const changed = () => {
      setHasInk(!pad.isEmpty());
      setErr(null);
    };
    pad.addEventListener('endStroke', changed);
    return () => {
      drawingRef.current = pad.toData();
      pad.removeEventListener('endStroke', changed);
      pad.off();
      padRef.current = null;
    };
  }, []);

  const commit = () => {
    if (!name) {
      setErr('No name is on record for the signatory, so this cannot be signed.');
      return;
    }
    if (!padRef.current || padRef.current.isEmpty()) {
      setErr('Please draw your signature before signing.');
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      onCommit(padRef.current.toDataURL('image/png'));
    } finally {
      setSaving(false);
    }
  };

  const clear = () => {
    padRef.current?.clear();
    drawingRef.current = [];
    setHasInk(false);
    setErr(null);
  };

  return (
    <div className="border border-foreground-200 rounded-xl p-3 max-w-md space-y-3">
      <div>
        <p className="text-[12px] text-foreground-700 mb-1">Signing as</p>
        <p className="text-[13px] font-medium text-foreground-900">
          {name || <span className="text-red-600">No name on record</span>}
        </p>
      </div>

      <div className="space-y-2">
        <canvas
          ref={canvasRef}
          aria-label="Draw your signature"
          className="h-40 w-full touch-none rounded-lg border border-foreground-200 bg-white shadow-sm"
        />
        <button type="button" className={btnSecondary} onClick={clear} disabled={saving || !hasInk}>
          Clear
        </button>
      </div>

      <p className="text-[11px] text-foreground-400">
        Draw using your mouse, pen or finger. Confirming below has the same effect as signing by hand.
      </p>

      {err && <p className="text-[12px] text-red-600">{err}</p>}

      <div className="flex items-center gap-2">
        <button
          type="button"
          className={btnPrimary}
          onClick={commit}
          disabled={saving || !name || !hasInk}
        >
          <i className="ri-check-line" />
          {saving ? 'Signing...' : 'Sign'}
        </button>
        <button type="button" className={btnSecondary} onClick={onCancel} disabled={saving}>
          Cancel
        </button>
      </div>
    </div>
  );
}
