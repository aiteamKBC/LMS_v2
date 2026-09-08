import { useEffect, useRef, useState } from 'react';
import SignaturePad from 'signature_pad';
import { inputClass } from '@/pages/users/components/ui';
import { Modal } from '@/pages/users/components/Modal';
import { AppIcon } from '@/components/feature/AppIcon';
import styles from './design.module.css';

const btnPrimary = styles.primaryButton;
const btnSecondary = styles.secondaryButton;

export function SignatureCapture({ name, busy, onSave, onDraftStart, onDraftReset, dialogRole, hasSavedSignature, saveError, confirmationText }: {
  name: string; busy: boolean; onSave: (blob: Blob, capture: 'draw' | 'upload') => void;
  onDraftStart?: () => void; onDraftReset?: () => void;
  dialogRole?: 'learner' | 'coach'; hasSavedSignature?: boolean; saveError?: string;
  confirmationText?: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const pad = useRef<SignaturePad | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const drawing = useRef<ReturnType<SignaturePad['toData']>>([]);
  const drawingWidth = useRef(0);
  const [open, setOpen] = useState(!dialogRole);
  const [mode, setMode] = useState<'draw' | 'upload'>('draw');
  const [preview, setPreview] = useState('');
  const [blob, setBlob] = useState<Blob | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState('');
  const [hasInk, setHasInk] = useState(false);

  useEffect(() => {
    if (mode !== 'draw' || !open || !canvas.current) return;
    const element = canvas.current;
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    const width = element.getBoundingClientRect().width || 300;
    element.width = width * ratio;
    element.height = 180 * ratio;
    element.getContext('2d')?.scale(ratio, ratio);
    const instance = new SignaturePad(element, { backgroundColor: 'rgb(255,255,255)' });
    // The capture component owns the draft, even while its dialog is closed.
    // Restore strokes at the new width when reopening on a smaller screen.
    if (drawing.current.length) {
      const scale = drawingWidth.current ? width / drawingWidth.current : 1;
      instance.fromData(drawing.current.map(group => ({ ...group, points: group.points.map(point => ({ ...point, x: point.x * scale })) })));
    }
    drawingWidth.current = width;
    pad.current = instance;
    const changed = () => { setHasInk(!instance.isEmpty()); setPreview(''); setBlob(null); setConfirmed(false); };
    instance.addEventListener('endStroke', changed);
    return () => { drawing.current = instance.toData(); instance.removeEventListener('endStroke', changed); instance.off(); pad.current = null; };
  }, [mode, open]);

  const reset = () => { setPreview(''); setBlob(null); setConfirmed(false); setError(''); setHasInk(false); drawing.current = []; pad.current?.clear(); onDraftReset?.(); };
  const previewDrawing = () => {
    if (!pad.current || pad.current.isEmpty() || !canvas.current) return;
    setPreview(pad.current.toDataURL('image/png'));
    canvas.current.toBlob(value => setBlob(value), 'image/png');
    setConfirmed(false);
  };
  const upload = (file?: File) => {
    reset();
    if (!file) return;
    onDraftStart?.();
    if (!['image/png', 'image/jpeg'].includes(file.type) || file.size > 2 * 1024 * 1024) {
      setError('Choose a PNG or JPEG image up to 2 MB.'); return;
    }
    const reader = new FileReader();
    reader.onload = () => { setPreview(String(reader.result)); setBlob(file); };
    reader.onerror = () => setError('Could not read this image. Please try again.');
    reader.readAsDataURL(file);
  };

  const controls = <fieldset disabled={busy} className={`${styles.capture} space-y-3`}>
    <legend className="mb-3 text-sm font-semibold text-foreground-900">Your signature</legend>
    <p className="text-sm text-foreground-600">Signing as <strong>{name}</strong></p>
    <div className={styles.captureModes}>
      <button type="button" aria-pressed={mode === 'draw'} className={mode === 'draw' ? btnPrimary : btnSecondary} onClick={() => { reset(); setMode('draw'); }}>Draw signature</button>
      <button type="button" aria-pressed={mode === 'upload'} className={mode === 'upload' ? btnPrimary : btnSecondary} onClick={() => { reset(); setMode('upload'); }}>Upload signature image</button>
    </div>
    {mode === 'draw' ? <div className="space-y-3">
      <p className="text-sm text-foreground-500">Draw using your mouse, pen or finger.</p>
      <canvas ref={canvas} onPointerDown={onDraftStart} aria-label="Draw your signature" className={`h-[180px] w-full touch-none rounded-xl border border-foreground-200 bg-white ${busy ? 'pointer-events-none' : ''}`} />
      <div className="flex gap-2"><button type="button" className={btnSecondary} onClick={reset}>Clear</button>
        <button type="button" className={btnSecondary} disabled={!hasInk} onClick={previewDrawing}>Preview signature</button></div>
    </div> : <label className="block space-y-2 text-sm">PNG or JPEG, up to 2 MB
      <input aria-label="Upload signature image" type="file" accept="image/png,image/jpeg" className={inputClass} onChange={e => upload(e.target.files?.[0])} />
    </label>}
    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    {saveError && dialogRole && <p role="alert" className="text-sm text-red-600">{saveError}</p>}
    {preview && <div className="space-y-3 border-t border-foreground-100 pt-4">
      <p className="text-sm font-semibold">Signature preview</p>
      <img src={preview} alt="Your signature preview" className="max-h-36 max-w-full rounded-lg border border-foreground-100 bg-white" />
      <label className="flex items-start gap-2 text-sm text-foreground-700"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} className="mt-1 accent-primary-500" />
        {confirmationText || "I have reviewed this month's record and confirm this is my signature."}</label>
      <button type="button" className={btnPrimary} disabled={!confirmed || !blob || busy} onClick={() => blob && onSave(blob, mode)}>{busy ? 'Saving…' : 'Confirm and save signature'}</button>
    </div>}
  </fieldset>;
  if (!dialogRole) return controls;
  return <>
    <button ref={trigger} type="button" className={btnSecondary} disabled={busy} onClick={() => setOpen(true)}>
      <AppIcon className="ri-edit-line" />{hasSavedSignature ? 'Update your signature' : `Sign as ${dialogRole}`}
    </button>
    {open && <Modal size="max-w-xl" className={`${styles.scope} ${styles.dialog}`} returnFocusRef={trigger}
      title={dialogRole === 'coach' ? 'Coach signature' : 'Learner signature'} onClose={() => setOpen(false)}
      footer={<button type="button" className={btnSecondary} onClick={() => setOpen(false)}>Keep draft and close</button>}>
      <p className="mb-4 text-[13px] leading-relaxed text-foreground-500">Draw or upload your signature for this month’s record. Review the preview and confirm before saving.</p>
      {controls}
    </Modal>}
  </>;
}
