import { useEffect, useRef, useState } from 'react';
import { btnPrimary, btnSecondary } from '../../components/ui';

/**
 * Signature capture: draw one by hand, or upload an image of an existing one.
 *
 * Both routes produce a PNG data URL, which is what `signatureUrl` already held
 * (previously the literal string 'Signed digitally'), so the stored shape and
 * the PDF's signature block need no schema change — see ilrDocument.sigRow,
 * which renders a data URL as an image and anything else as italic text.
 */

/** Drawn strokes are trimmed and downscaled to keep the stored data URL small. */
const MAX_WIDTH_PX = 600;
/** Refuse oversized uploads: the whole ILR document is capped server-side at 512KB. */
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
const ACCEPTED = ['image/png', 'image/jpeg', 'image/webp'];

type Mode = 'draw' | 'upload';

/** Crops transparent margins so a small squiggle doesn't render as a tiny mark
 *  in a wide box, then scales the result down to MAX_WIDTH_PX. */
function trimmedDataUrl(source: HTMLCanvasElement): string | null {
  const w = source.width;
  const h = source.height;
  const ctx = source.getContext('2d');
  if (!ctx) return null;
  const { data } = ctx.getImageData(0, 0, w, h);

  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Alpha channel only — the canvas starts fully transparent.
      if (data[(y * w + x) * 4 + 3] > 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null; // nothing drawn

  const pad = 8;
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(w - 1, maxX + pad);
  maxY = Math.min(h - 1, maxY + pad);

  const cropW = maxX - minX + 1;
  const cropH = maxY - minY + 1;
  const scale = Math.min(1, MAX_WIDTH_PX / cropW);

  const out = document.createElement('canvas');
  out.width = Math.round(cropW * scale);
  out.height = Math.round(cropH * scale);
  const octx = out.getContext('2d');
  if (!octx) return null;
  octx.drawImage(source, minX, minY, cropW, cropH, 0, 0, out.width, out.height);
  return out.toDataURL('image/png');
}

/** Downscale an uploaded image so a phone photo of a signature isn't stored at full size. */
function normaliseUpload(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('That file is not a readable image.'));
      img.onload = () => {
        const scale = Math.min(1, MAX_WIDTH_PX / img.width);
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * scale);
        c.height = Math.round(img.height * scale);
        const ctx = c.getContext('2d');
        if (!ctx) return reject(new Error('Could not process that image.'));
        ctx.drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/png'));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

export function SignaturePad({ onCommit, onCancel }: { onCommit: (dataUrl: string) => void; onCancel: () => void }) {
  const [mode, setMode] = useState<Mode>('draw');
  const [hasInk, setHasInk] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);

  // Size the backing store to the element's CSS size × DPR, so strokes are
  // crisp on retina screens and coordinates map 1:1 to what the user sees.
  useEffect(() => {
    if (mode !== 'draw') return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#111827';
  }, [mode]);

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    // Capture the pointer so a stroke continuing outside the canvas still tracks.
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    const { x, y } = pos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    // A single tap should leave a visible dot, not nothing.
    ctx.lineTo(x + 0.01, y);
    ctx.stroke();
    setHasInk(true);
  };

  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const { x, y } = pos(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const end = () => {
    drawing.current = false;
  };

  const clear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    // Reset in device pixels, ignoring the DPR transform.
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    setHasInk(false);
  };

  const commitDrawing = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const url = trimmedDataUrl(canvas);
    if (!url) {
      setErr('Please draw your signature first.');
      return;
    }
    onCommit(url);
  };

  const pickFile = async (file?: File) => {
    setErr(null);
    if (!file) return;
    if (!ACCEPTED.includes(file.type)) {
      setErr('Please choose a PNG, JPEG or WebP image.');
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setErr('That image is larger than 2 MB. Please use a smaller file.');
      return;
    }
    try {
      onCommit(await normaliseUpload(file));
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not process that image.');
    }
  };

  const tab = (m: Mode, label: string, icon: string) => (
    <button
      onClick={() => { setMode(m); setErr(null); }}
      className={`px-3 py-1.5 rounded-lg text-[12px] font-medium inline-flex items-center gap-1.5 cursor-pointer transition-smooth border ${
        mode === m ? 'bg-primary-50 text-primary-700 border-primary-300/60' : 'text-foreground-500 border-transparent hover:bg-background-100'
      }`}
    >
      <i className={icon} />{label}
    </button>
  );

  return (
    <div className="border border-foreground-200 rounded-xl p-3 max-w-md">
      <div className="flex items-center gap-1.5 mb-3">
        {tab('draw', 'Draw', 'ri-pen-nib-line')}
        {tab('upload', 'Upload', 'ri-upload-2-line')}
      </div>

      {mode === 'draw' ? (
        <>
          <canvas
            ref={canvasRef}
            onPointerDown={start}
            onPointerMove={move}
            onPointerUp={end}
            onPointerLeave={end}
            className="w-full h-32 border-2 border-dashed border-foreground-200 rounded-lg bg-background-50 touch-none cursor-crosshair"
          />
          <p className="text-[11px] text-foreground-400 mt-1.5">Sign inside the box using a mouse, trackpad or finger.</p>
          <div className="flex items-center gap-2 mt-3">
            <button className={btnPrimary} onClick={commitDrawing} disabled={!hasInk}>
              <i className="ri-check-line" />Use signature
            </button>
            <button className={btnSecondary} onClick={clear} disabled={!hasInk}><i className="ri-eraser-line" />Clear</button>
            <button className={btnSecondary} onClick={onCancel}>Cancel</button>
          </div>
        </>
      ) : (
        <>
          <label className="w-full h-32 border-2 border-dashed border-foreground-200 rounded-lg bg-background-50 flex flex-col items-center justify-center text-foreground-400 hover:border-primary-300 hover:text-primary-500 transition-smooth cursor-pointer">
            <i className="ri-image-add-line text-2xl mb-1" />
            <span className="text-[12px]">Choose a signature image</span>
            <span className="text-[11px] text-foreground-300 mt-0.5">PNG, JPEG or WebP · max 2 MB</span>
            <input
              type="file"
              accept={ACCEPTED.join(',')}
              className="hidden"
              onChange={(e) => {
                void pickFile(e.target.files?.[0]);
                // Reset so re-picking the same file fires change again.
                e.target.value = '';
              }}
            />
          </label>
          <p className="text-[11px] text-foreground-400 mt-1.5">A photo or scan of an existing signature works. A transparent PNG looks best.</p>
          <div className="flex items-center gap-2 mt-3">
            <button className={btnSecondary} onClick={onCancel}>Cancel</button>
          </div>
        </>
      )}

      {err && <p className="text-[12px] text-red-600 mt-2"><i className="ri-error-warning-line mr-1" />{err}</p>}
    </div>
  );
}
