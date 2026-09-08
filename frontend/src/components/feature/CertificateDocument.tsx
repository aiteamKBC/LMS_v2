import { useMemo, useState, type CSSProperties, type MouseEvent } from 'react';

interface CertificateLayout {
  primaryColor?: string;
  accentColor?: string;
  decorationStyle?: 'waves' | 'classic' | 'minimal' | 'executive' | 'royal' | 'laurel' | 'geometric' | 'ribbon' | 'flourish' | 'none';
  backgroundImageUrl?: string;
  backgroundOpacity?: number;
  backgroundFit?: 'cover' | 'contain';
  backgroundScale?: number;
  backgroundPositionX?: number;
  backgroundPositionY?: number;
  showFrame?: boolean;
  contentBackdropOpacity?: number;
  footerText?: string;
  instructorName?: string;
  website?: string;
  providerBlurb?: string;
  logoUrl?: string;
  certifyText?: string;
  recognitionText?: string;
  progressPrefix?: string;
  instructorLabel?: string;
  awardedLabel?: string;
  certificateNumberLabel?: string;
  showQr?: boolean;
  showLogo?: boolean;
  showInstructor?: boolean;
  showAwardDate?: boolean;
  showCertificateNumber?: boolean;
  showFooter?: boolean;
  showWebsite?: boolean;
  showProgress?: boolean;
  decorationSize?: number;
  logoSize?: number;
  titleSize?: number;
  subtitleSize?: number;
  certifySize?: number;
  learnerNameSize?: number;
  bodySize?: number;
  signatureSize?: number;
  footerSize?: number;
  qrSize?: number;
  extraSignatureFields?: Array<{ label?: string; value?: string }>;
}

export interface CertificateDocumentProps {
  title: string;
  bodyText: string;
  learnerName: string;
  programmeName: string;
  progressLabel: string;
  certificateNumber?: string | null;
  awardedOn?: string | null;
  verificationUrl?: string | null;
  layoutConfig?: CertificateLayout;
  className?: string;
  editable?: boolean;
  selectedElement?: CertificateElementId | null;
  onSelectElement?: (element: CertificateElementId | null) => void;
}

export type CertificateElementId =
  | 'decoration'
  | 'logo'
  | 'title'
  | 'subtitle'
  | 'certify'
  | 'learnerName'
  | 'bodyText'
  | 'programmeName'
  | 'recognitionText'
  | 'progress'
  | 'qr'
  | 'instructor'
  | 'awardDate'
  | 'certificateNumber'
  | 'extraFields'
  | 'footer'
  | 'website';

function WaveCorner({ className, primary, accent }: { className: string; primary: string; accent: string }) {
  const count = 16;
  const startAngle = 5;
  const endAngle = 82;

  return (
    <svg className={className} viewBox="0 0 220 220" aria-hidden="true">
      {Array.from({ length: count }).map((_, index) => {
        const t = index / (count - 1);
        const angle = startAngle + t * (endAngle - startAngle);
        const rad = (angle * Math.PI) / 180;
        const r = 240 - Math.abs(t - 0.5) * 55;
        const perpX = -Math.sin(rad);
        const perpY = Math.cos(rad);
        const bump = 28 * (index % 2 === 0 ? 1 : -1) * (0.5 + 0.5 * (1 - Math.abs(t - 0.5) * 2));
        const r1 = r * 0.32;
        const r2 = r * 0.68;
        const c1x = r1 * Math.cos(rad) + perpX * bump;
        const c1y = r1 * Math.sin(rad) + perpY * bump;
        const c2x = r2 * Math.cos(rad) - perpX * bump * 0.8;
        const c2y = r2 * Math.sin(rad) - perpY * bump * 0.8;
        const endX = r * Math.cos(rad);
        const endY = r * Math.sin(rad);
        const isAccent = index % 4 === 3;
        const isBold = index % 5 === 2;
        const fade = 0.55 - Math.abs(t - 0.5) * 0.6;
        return (
          <path
            key={index}
            d={`M 0 0 C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${endX.toFixed(1)} ${endY.toFixed(1)}`}
            fill="none"
            stroke={isAccent ? accent : primary}
            strokeWidth={isBold ? 3.2 : isAccent ? 1.9 : 1.15}
            strokeLinecap="round"
            opacity={isBold ? Math.max(fade * 0.55, 0.14) : Math.max(fade, 0.14)}
          />
        );
      })}
      <circle cx="0" cy="0" r="4" fill={accent} opacity="0.9" />
    </svg>
  );
}

function ClassicCorner({ className, primary, accent }: { className: string; primary: string; accent: string }) {
  return (
    <svg className={className} viewBox="0 0 180 180" aria-hidden="true">
      <path d="M18 132V18h114" fill="none" stroke={primary} strokeWidth="8" strokeLinecap="round" />
      <path d="M40 142V40h102" fill="none" stroke={accent} strokeWidth="3" strokeLinecap="round" opacity="0.85" />
      <circle cx="40" cy="40" r="6" fill={accent} />
    </svg>
  );
}

function MinimalAccent({ className, accent }: { className: string; accent: string }) {
  return (
    <svg className={className} viewBox="0 0 180 180" aria-hidden="true">
      <path d="M28 28h94" fill="none" stroke={accent} strokeWidth="3" strokeLinecap="round" />
      <path d="M28 28v94" fill="none" stroke={accent} strokeWidth="3" strokeLinecap="round" />
      <path d="M46 46h58" fill="none" stroke={accent} strokeWidth="1.5" strokeLinecap="round" opacity="0.65" />
      <path d="M46 46v58" fill="none" stroke={accent} strokeWidth="1.5" strokeLinecap="round" opacity="0.65" />
    </svg>
  );
}

function ExecutiveCorner({ className, primary, accent }: { className: string; primary: string; accent: string }) {
  return (
    <svg className={className} viewBox="0 0 180 180" aria-hidden="true">
      <path d="M20 124V20h104" fill="none" stroke={primary} strokeWidth="5" strokeLinecap="round" />
      <path d="M34 110V34h76" fill="none" stroke={accent} strokeWidth="2.5" strokeLinecap="round" />
      <path d="M49 49h42M49 49v42" fill="none" stroke={primary} strokeWidth="1.6" strokeLinecap="round" opacity="0.55" />
      <circle cx="34" cy="34" r="4.5" fill={accent} />
      <circle cx="124" cy="20" r="3.5" fill={accent} opacity="0.7" />
      <circle cx="20" cy="124" r="3.5" fill={accent} opacity="0.7" />
    </svg>
  );
}

function LaurelCorner({ className, primary, accent }: { className: string; primary: string; accent: string }) {
  const leaves = Array.from({ length: 8 }, (_, index) => ({
    x: 34 + index * 11,
    y: 130 - index * 11,
    rotate: -38 + index * 4,
  }));

  return (
    <svg className={className} viewBox="0 0 180 180" aria-hidden="true">
      <path d="M28 140C54 94 92 56 140 28" fill="none" stroke={primary} strokeWidth="2.2" strokeLinecap="round" opacity="0.45" />
      {leaves.map((leaf, index) => (
        <ellipse
          key={index}
          cx={leaf.x}
          cy={leaf.y}
          rx="5"
          ry="11"
          fill={index % 2 ? primary : accent}
          opacity={index % 2 ? 0.34 : 0.72}
          transform={`rotate(${leaf.rotate} ${leaf.x} ${leaf.y})`}
        />
      ))}
      <circle cx="142" cy="26" r="4" fill={accent} />
    </svg>
  );
}

function GeometricCorner({ className, primary, accent }: { className: string; primary: string; accent: string }) {
  return (
    <svg className={className} viewBox="0 0 180 180" aria-hidden="true">
      <path d="M18 18h118L18 136z" fill={primary} opacity="0.08" />
      <path d="M18 18h76L18 94z" fill={primary} opacity="0.16" />
      <path d="M48 18h88L90 64z" fill={accent} opacity="0.18" />
      <path d="M18 136L136 18" fill="none" stroke={accent} strokeWidth="2" opacity="0.42" />
      <path d="M18 18h118" fill="none" stroke={primary} strokeWidth="3" strokeLinecap="round" opacity="0.65" />
      <path d="M18 18v118" fill="none" stroke={primary} strokeWidth="3" strokeLinecap="round" opacity="0.65" />
    </svg>
  );
}

function RibbonCorner({ className, primary, accent }: { className: string; primary: string; accent: string }) {
  return (
    <svg className={className} viewBox="0 0 180 180" aria-hidden="true">
      <path d="M14 14h124L14 138z" fill={primary} opacity="0.1" />
      <path d="M14 14h96L14 110z" fill={primary} opacity="0.16" />
      <path d="M14 32h74" stroke={accent} strokeWidth="5" strokeLinecap="round" opacity="0.85" />
      <path d="M32 14v74" stroke={accent} strokeWidth="5" strokeLinecap="round" opacity="0.85" />
      <path d="M50 14v52M14 50h52" stroke="white" strokeWidth="2" strokeLinecap="round" opacity="0.9" />
    </svg>
  );
}

function FlourishCorner({ className, primary, accent }: { className: string; primary: string; accent: string }) {
  return (
    <svg className={className} viewBox="0 0 180 180" aria-hidden="true">
      <path d="M24 118C42 68 72 42 126 24" fill="none" stroke={accent} strokeWidth="2.4" strokeLinecap="round" />
      <path d="M34 116C56 96 72 92 91 104C106 113 121 105 128 87" fill="none" stroke={primary} strokeWidth="1.8" strokeLinecap="round" opacity="0.55" />
      <path d="M63 60C73 52 85 54 88 66C76 68 68 67 63 60Z" fill={accent} opacity="0.72" />
      <path d="M92 38C104 33 115 38 116 50C105 50 98 47 92 38Z" fill={primary} opacity="0.36" />
      <circle cx="126" cy="24" r="4" fill={accent} />
      <circle cx="24" cy="118" r="3" fill={primary} opacity="0.5" />
    </svg>
  );
}

function QrFallback({ value, color }: { value?: string | null; color: string }) {
  const text = value || 'KBC certificate verification';
  const modules = useMemo(() => Array.from({ length: 625 }, (_, index) => {
    const x = index % 25;
    const y = Math.floor(index / 25);
    const inFinder = (x < 8 && y < 8) || (x > 16 && y < 8) || (x < 8 && y > 16);
    if (inFinder) return false;
    const code = text.charCodeAt(index % text.length) || 0;
    return ((code + index * 11 + x * 7 + y * 13) % 9) < 4;
  }), [text]);
  const finder = (x: number, y: number) => (
    <>
      <rect x={x} y={y} width="28" height="28" fill="currentColor" />
      <rect x={x + 4} y={y + 4} width="20" height="20" fill="white" />
      <rect x={x + 10} y={y + 10} width="8" height="8" fill="currentColor" />
    </>
  );

  return (
    <svg viewBox="0 0 116 116" className="h-full w-full text-black" aria-hidden="true">
      <rect width="116" height="116" fill="white" />
      {modules.map((filled, index) => (
        filled ? <rect key={index} x={8 + (index % 25) * 4} y={8 + Math.floor(index / 25) * 4} width="3.4" height="3.4" fill="currentColor" /> : null
      ))}
      {finder(8, 8)}
      {finder(80, 8)}
      {finder(8, 80)}
      <rect x="96" y="96" width="8" height="8" rx="1.5" fill={color} />
    </svg>
  );
}

function qrImageSource(value?: string | null, size = 180) {
  const target = absoluteUrl(value);
  return target
    ? `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&margin=14&data=${encodeURIComponent(target)}`
    : '';
}

function absoluteUrl(value?: string | null) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (/^https?:\/\//i.test(text)) return text;
  if (typeof window === 'undefined') return text;
  return `${window.location.origin}${text.startsWith('/') ? text : `/${text}`}`;
}

function QrMark({ value, color }: { value?: string | null; color: string }) {
  const [imageFailed, setImageFailed] = useState(false);
  const source = qrImageSource(value);

  return (
    <div className="w-[calc(11.2cqw*var(--certificate-qr-scale))] rounded-[0.9cqw] bg-white p-[0.72cqw] text-black shadow-sm ring-1 ring-slate-200" title={value || undefined}>
      <div className="aspect-square w-full overflow-hidden rounded-[0.28cqw] bg-white">
        {source && !imageFailed ? (
          <img
            src={source}
            alt="Certificate verification QR code"
            className="h-full w-full object-contain"
            loading="eager"
            onError={() => setImageFailed(true)}
          />
        ) : (
          <QrFallback value={value} color={color} />
        )}
      </div>
      <p className="mt-[0.45cqw] text-center text-[0.72cqw] font-bold uppercase tracking-[0.14em] text-slate-500">
        Scan to verify
      </p>
    </div>
  );
}

function QrPreview({ value, color, onClose }: { value?: string | null; color: string; onClose: () => void }) {
  const [imageFailed, setImageFailed] = useState(false);
  const source = qrImageSource(value, 360);
  const target = absoluteUrl(value);

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 p-5" onClick={onClose}>
      <div className="w-full max-w-sm rounded-3xl bg-white p-5 text-center shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between gap-3 text-left">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-foreground-500">Certificate verification</p>
            <h3 className="mt-1 text-lg font-black text-foreground-900">Scan QR code</h3>
          </div>
          <button type="button" onClick={onClose} className="rounded-full bg-foreground-100 px-3 py-1.5 text-sm font-black text-foreground-700">
            ×
          </button>
        </div>
        <div className="mx-auto aspect-square w-72 max-w-full rounded-2xl border border-foreground-100 bg-white p-4 shadow-sm">
          {source && !imageFailed ? (
            <img
              src={source}
              alt="Certificate verification QR code"
              className="h-full w-full object-contain"
              onError={() => setImageFailed(true)}
            />
          ) : (
            <QrFallback value={value} color={color} />
          )}
        </div>
        {target ? (
          <>
            <p className="mt-4 break-all rounded-xl bg-background-100 p-3 text-xs font-semibold text-foreground-600">
              {target}
            </p>
            <a
              href={target}
              target="_blank"
              rel="noreferrer"
              className="mt-4 inline-flex rounded-xl px-4 py-2 text-sm font-bold text-white"
              style={{ backgroundColor: color }}
            >
              Open verification
            </a>
          </>
        ) : null}
      </div>
    </div>
  );
}

function sizeScale(value: unknown, fallback = 100) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback / 100;
  return Math.min(Math.max(numeric, 60), 160) / 100;
}

function percentValue(value: unknown, fallback: number, min = 0, max = 100) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(Math.max(numeric, min), max);
}

export function CertificateDocument({
  title,
  bodyText,
  learnerName,
  programmeName,
  progressLabel,
  certificateNumber,
  awardedOn,
  verificationUrl,
  layoutConfig,
  className = '',
  editable = false,
  selectedElement = null,
  onSelectElement,
}: CertificateDocumentProps) {
  const [qrPreviewOpen, setQrPreviewOpen] = useState(false);
  const primary = layoutConfig?.primaryColor || '#5b21b6';
  const accent = layoutConfig?.accentColor || '#c99a2e';
  const decorationStyle = layoutConfig?.decorationStyle || 'waves';
  const backgroundImageUrl = layoutConfig?.backgroundImageUrl || '';
  const backgroundOpacity = percentValue(layoutConfig?.backgroundOpacity, 100) / 100;
  const backgroundFit = layoutConfig?.backgroundFit || 'cover';
  const backgroundScale = percentValue(layoutConfig?.backgroundScale, 100, 50, 220) / 100;
  const backgroundPositionX = percentValue(layoutConfig?.backgroundPositionX, 50);
  const backgroundPositionY = percentValue(layoutConfig?.backgroundPositionY, 50);
  const showFrame = layoutConfig?.showFrame !== false;
  const contentBackdropOpacity = percentValue(layoutConfig?.contentBackdropOpacity, backgroundImageUrl ? 0 : 90) / 100;
  const logoUrl = layoutConfig?.logoUrl || '/kbc-logo.png';
  const instructor = layoutConfig?.instructorName || 'Instructor';
  const awardDate = awardedOn || 'Awarded on';
  const code = certificateNumber || 'Certificate Number';
  const footer = layoutConfig?.providerBlurb
    || 'Kent Business College proudly provides government-approved, fully funded apprenticeships that support professional growth and long-term career development.';
  const website = layoutConfig?.website || layoutConfig?.footerText || 'www.kentbusinesscollege.com';
  const certifyText = layoutConfig?.certifyText || 'This is to certify that';
  const recognitionText = layoutConfig?.recognitionText || 'in recognition of their dedication, knowledge, and commitment to professional excellence.';
  const progressPrefix = layoutConfig?.progressPrefix || 'with progress';
  const instructorLabel = layoutConfig?.instructorLabel || 'Instructor';
  const awardedLabel = layoutConfig?.awardedLabel || 'Awarded on';
  const certificateNumberLabel = layoutConfig?.certificateNumberLabel || 'Certificate Number';
  const showQr = layoutConfig?.showQr !== false;
  const showLogo = layoutConfig?.showLogo !== false;
  const showInstructor = layoutConfig?.showInstructor !== false;
  const showAwardDate = layoutConfig?.showAwardDate !== false;
  const showCertificateNumber = layoutConfig?.showCertificateNumber !== false;
  const showFooter = layoutConfig?.showFooter !== false;
  const showWebsite = layoutConfig?.showWebsite !== false;
  const showProgress = layoutConfig?.showProgress !== false;
  const extraSignatureFields = Array.isArray(layoutConfig?.extraSignatureFields)
    ? layoutConfig.extraSignatureFields
        .map((field) => ({
          value: String(field?.value || '').trim(),
          label: String(field?.label || '').trim(),
        }))
        .filter((field) => field.value || field.label)
    : [];
  const signatureItems = [
    showInstructor ? { id: 'instructor' as CertificateElementId, value: instructor, label: instructorLabel } : null,
    showAwardDate ? { id: 'awardDate' as CertificateElementId, value: awardDate, label: awardedLabel } : null,
    showCertificateNumber ? { id: 'certificateNumber' as CertificateElementId, value: code, label: certificateNumberLabel } : null,
    ...extraSignatureFields.map((field) => ({ id: 'extraFields' as CertificateElementId, ...field })),
  ].filter((item): item is { id: CertificateElementId; value: string; label: string } => Boolean(item));
  const titleText = (title || 'Certificate of Achievement').trim();
  const ofIndex = titleText.toLowerCase().indexOf(' of ');
  const titleMain = ofIndex >= 0 ? titleText.slice(0, ofIndex) : titleText;
  const titleSub = ofIndex >= 0 ? titleText.slice(ofIndex + 1) : 'of Achievement';
  const style = {
    '--certificate-primary': primary,
    '--certificate-accent': accent,
    '--certificate-decoration-scale': sizeScale(layoutConfig?.decorationSize, 82),
    '--certificate-logo-scale': sizeScale(layoutConfig?.logoSize, 100),
    '--certificate-title-scale': sizeScale(layoutConfig?.titleSize),
    '--certificate-subtitle-scale': sizeScale(layoutConfig?.subtitleSize),
    '--certificate-certify-scale': sizeScale(layoutConfig?.certifySize),
    '--certificate-name-scale': sizeScale(layoutConfig?.learnerNameSize),
    '--certificate-body-scale': sizeScale(layoutConfig?.bodySize, 92),
    '--certificate-signature-scale': sizeScale(layoutConfig?.signatureSize),
    '--certificate-footer-scale': sizeScale(layoutConfig?.footerSize),
    '--certificate-qr-scale': sizeScale(layoutConfig?.qrSize),
  } as CSSProperties;
  const selectElement = (element: CertificateElementId, event: MouseEvent) => {
    if (!editable || !onSelectElement) return;
    event.stopPropagation();
    onSelectElement(element);
  };
  const handleQrClick = (event: MouseEvent) => {
    event.stopPropagation();
    if (editable) {
      selectElement('qr', event);
      return;
    }
    if (verificationUrl) {
      setQrPreviewOpen(true);
    }
  };
  const editorClass = (element: CertificateElementId) => (
    editable
      ? `cursor-pointer rounded-md transition hover:bg-primary-50/50 hover:outline hover:outline-2 hover:outline-primary-200 ${selectedElement === element ? 'bg-primary-50/60 outline outline-2 outline-primary-400' : ''}`
      : ''
  );

  return (
    <>
    <div
      className={`relative mx-auto aspect-[1.414/1] w-full max-w-5xl overflow-hidden rounded-xl border border-slate-200 bg-white text-center shadow-xl [container-type:inline-size] ${className}`}
      style={style}
      onClick={(event) => {
        if (!editable || !onSelectElement) return;
        event.stopPropagation();
        onSelectElement(null);
      }}
    >
      {backgroundImageUrl ? (
        <img
          src={backgroundImageUrl}
          alt=""
          className="absolute inset-0 h-full w-full"
          style={{
            objectFit: backgroundFit,
            objectPosition: `${backgroundPositionX}% ${backgroundPositionY}%`,
            opacity: backgroundOpacity,
            transform: `scale(${backgroundScale})`,
            transformOrigin: `${backgroundPositionX}% ${backgroundPositionY}%`,
          }}
          aria-hidden="true"
        />
      ) : null}
      {showFrame ? (
        <div className="absolute inset-[3%] rounded-md border-[0.7cqw]" style={{ borderColor: primary }} />
      ) : null}
      {decorationStyle === 'royal' ? (
        <>
          <div className="absolute inset-[4.4%] rounded-sm border-[0.18cqw]" style={{ borderColor: accent }} />
          <div className="absolute left-[5.3%] top-[5.3%] h-[1.3cqw] w-[1.3cqw] rounded-full" style={{ backgroundColor: accent }} />
          <div className="absolute right-[5.3%] top-[5.3%] h-[1.3cqw] w-[1.3cqw] rounded-full" style={{ backgroundColor: accent }} />
          <div className="absolute bottom-[5.3%] left-[5.3%] h-[1.3cqw] w-[1.3cqw] rounded-full" style={{ backgroundColor: accent }} />
          <div className="absolute bottom-[5.3%] right-[5.3%] h-[1.3cqw] w-[1.3cqw] rounded-full" style={{ backgroundColor: accent }} />
        </>
      ) : null}
      {decorationStyle === 'waves' ? (
        <>
          <div className="pointer-events-none absolute left-[3.6%] top-[3.6%] h-[22%] w-[20%] overflow-hidden">
            <WaveCorner className="absolute left-0 top-0 h-[calc(100%*var(--certificate-decoration-scale))] w-[calc(100%*var(--certificate-decoration-scale))] origin-top-left" primary={primary} accent={accent} />
          </div>
          <div className="pointer-events-none absolute bottom-[3.6%] right-[3.6%] h-[22%] w-[20%] overflow-hidden">
            <WaveCorner className="absolute left-1/2 top-1/2 h-[calc(100%*var(--certificate-decoration-scale))] w-[calc(100%*var(--certificate-decoration-scale))] origin-center -translate-x-1/2 -translate-y-1/2 rotate-180" primary={primary} accent={accent} />
          </div>
        </>
      ) : null}
      {decorationStyle === 'classic' ? (
        <>
          <div className="pointer-events-none absolute left-[3.7%] top-[3.7%] h-[14%] w-[13%] overflow-hidden">
            <ClassicCorner className="absolute left-0 top-0 h-[calc(100%*var(--certificate-decoration-scale))] w-[calc(100%*var(--certificate-decoration-scale))] origin-top-left" primary={primary} accent={accent} />
          </div>
          <div className="pointer-events-none absolute bottom-[3.7%] right-[3.7%] h-[14%] w-[13%] overflow-hidden">
            <ClassicCorner className="absolute left-1/2 top-1/2 h-[calc(100%*var(--certificate-decoration-scale))] w-[calc(100%*var(--certificate-decoration-scale))] origin-center -translate-x-1/2 -translate-y-1/2 rotate-180" primary={primary} accent={accent} />
          </div>
        </>
      ) : null}
      {decorationStyle === 'minimal' ? (
        <>
          <div className="pointer-events-none absolute left-[4.4%] top-[4.4%] h-[11%] w-[10%] overflow-hidden">
            <MinimalAccent className="absolute left-0 top-0 h-[calc(100%*var(--certificate-decoration-scale))] w-[calc(100%*var(--certificate-decoration-scale))] origin-top-left" accent={accent} />
          </div>
          <div className="pointer-events-none absolute bottom-[4.4%] right-[4.4%] h-[11%] w-[10%] overflow-hidden">
            <MinimalAccent className="absolute left-1/2 top-1/2 h-[calc(100%*var(--certificate-decoration-scale))] w-[calc(100%*var(--certificate-decoration-scale))] origin-center -translate-x-1/2 -translate-y-1/2 rotate-180" accent={accent} />
          </div>
        </>
      ) : null}
      {decorationStyle === 'executive' ? (
        <>
          <div className="pointer-events-none absolute left-[4%] top-[4%] h-[13%] w-[12%] overflow-hidden">
            <ExecutiveCorner className="absolute left-0 top-0 h-[calc(100%*var(--certificate-decoration-scale))] w-[calc(100%*var(--certificate-decoration-scale))] origin-top-left" primary={primary} accent={accent} />
          </div>
          <div className="pointer-events-none absolute bottom-[4%] right-[4%] h-[13%] w-[12%] overflow-hidden">
            <ExecutiveCorner className="absolute left-1/2 top-1/2 h-[calc(100%*var(--certificate-decoration-scale))] w-[calc(100%*var(--certificate-decoration-scale))] origin-center -translate-x-1/2 -translate-y-1/2 rotate-180" primary={primary} accent={accent} />
          </div>
        </>
      ) : null}
      {decorationStyle === 'laurel' ? (
        <>
          <div className="pointer-events-none absolute left-[4.1%] top-[4.2%] h-[14%] w-[13%] overflow-hidden">
            <LaurelCorner className="absolute left-0 top-0 h-[calc(100%*var(--certificate-decoration-scale))] w-[calc(100%*var(--certificate-decoration-scale))] origin-top-left -rotate-3" primary={primary} accent={accent} />
          </div>
          <div className="pointer-events-none absolute bottom-[4.1%] right-[4.2%] h-[14%] w-[13%] overflow-hidden">
            <LaurelCorner className="absolute left-1/2 top-1/2 h-[calc(100%*var(--certificate-decoration-scale))] w-[calc(100%*var(--certificate-decoration-scale))] origin-center -translate-x-1/2 -translate-y-1/2 rotate-180" primary={primary} accent={accent} />
          </div>
        </>
      ) : null}
      {decorationStyle === 'geometric' ? (
        <>
          <div className="pointer-events-none absolute left-[3.8%] top-[3.8%] h-[15%] w-[14%] overflow-hidden">
            <GeometricCorner className="absolute left-0 top-0 h-[calc(100%*var(--certificate-decoration-scale))] w-[calc(100%*var(--certificate-decoration-scale))] origin-top-left" primary={primary} accent={accent} />
          </div>
          <div className="pointer-events-none absolute bottom-[3.8%] right-[3.8%] h-[15%] w-[14%] overflow-hidden">
            <GeometricCorner className="absolute left-1/2 top-1/2 h-[calc(100%*var(--certificate-decoration-scale))] w-[calc(100%*var(--certificate-decoration-scale))] origin-center -translate-x-1/2 -translate-y-1/2 rotate-180" primary={primary} accent={accent} />
          </div>
        </>
      ) : null}
      {decorationStyle === 'ribbon' ? (
        <>
          <div className="pointer-events-none absolute left-[3.7%] top-[3.7%] h-[13%] w-[12%] overflow-hidden">
            <RibbonCorner className="absolute left-0 top-0 h-[calc(100%*var(--certificate-decoration-scale))] w-[calc(100%*var(--certificate-decoration-scale))] origin-top-left" primary={primary} accent={accent} />
          </div>
          <div className="pointer-events-none absolute bottom-[3.7%] right-[3.7%] h-[13%] w-[12%] overflow-hidden">
            <RibbonCorner className="absolute left-1/2 top-1/2 h-[calc(100%*var(--certificate-decoration-scale))] w-[calc(100%*var(--certificate-decoration-scale))] origin-center -translate-x-1/2 -translate-y-1/2 rotate-180" primary={primary} accent={accent} />
          </div>
        </>
      ) : null}
      {decorationStyle === 'flourish' ? (
        <>
          <div className="pointer-events-none absolute left-[4.2%] top-[4.2%] h-[13%] w-[12%] overflow-hidden">
            <FlourishCorner className="absolute left-0 top-0 h-[calc(100%*var(--certificate-decoration-scale))] w-[calc(100%*var(--certificate-decoration-scale))] origin-top-left" primary={primary} accent={accent} />
          </div>
          <div className="pointer-events-none absolute bottom-[4.2%] right-[4.2%] h-[13%] w-[12%] overflow-hidden">
            <FlourishCorner className="absolute left-1/2 top-1/2 h-[calc(100%*var(--certificate-decoration-scale))] w-[calc(100%*var(--certificate-decoration-scale))] origin-center -translate-x-1/2 -translate-y-1/2 rotate-180" primary={primary} accent={accent} />
          </div>
        </>
      ) : null}
      {editable && decorationStyle !== 'none' ? (
        <button
          type="button"
          aria-label="Edit certificate decoration"
          onClick={(event) => selectElement('decoration', event)}
          className={`${editorClass('decoration')} absolute left-[3.2%] top-[3.2%] h-[16%] w-[15%]`}
        />
      ) : null}

      {showLogo ? (
        <div
          onClick={(event) => selectElement('logo', event)}
          className={`${editorClass('logo')} absolute right-[6.1%] top-[5.6%] flex h-[calc(13.2cqw*var(--certificate-logo-scale))] w-[calc(18.5cqw*var(--certificate-logo-scale))] items-start justify-center`}
        >
          <img src={logoUrl} alt="Kent Business College" className="max-h-full max-w-full object-contain" />
        </div>
      ) : null}

      <div className="absolute left-[18%] right-[18%] top-[7%]">
        <h2
          onClick={(event) => selectElement('title', event)}
          className={`${editorClass('title')} font-serif text-[calc(4.45cqw*var(--certificate-title-scale))] font-semibold uppercase leading-[0.95] tracking-[0.18em] text-slate-900`}
        >
          {titleMain}
        </h2>
        <p
          onClick={(event) => selectElement('subtitle', event)}
          className={`${editorClass('subtitle')} mt-[0.5cqw] font-serif text-[calc(3.2cqw*var(--certificate-subtitle-scale))] uppercase leading-none tracking-[0.18em]`}
          style={{ color: accent }}
        >
          {titleSub}
        </p>
        <p
          onClick={(event) => selectElement('certify', event)}
          className={`${editorClass('certify')} mt-[1.4cqw] text-[calc(1.15cqw*var(--certificate-certify-scale))] font-bold uppercase tracking-[0.38em] text-slate-500`}
        >
          {certifyText}
        </p>
      </div>

      <div className="absolute left-[20%] right-[20%] top-[31%]">
        <p
          onClick={(event) => selectElement('learnerName', event)}
          className={`${editorClass('learnerName')} font-sans text-[calc(3.35cqw*var(--certificate-name-scale))] font-black italic leading-none text-black`}
        >
          -{learnerName}-
        </p>
        <div className="mx-auto mt-[2cqw] flex w-full items-center">
          <span className="h-px flex-1" style={{ backgroundColor: accent }} />
          <span className="h-2 w-2 rounded-full border bg-white" style={{ borderColor: accent }} />
          <span className="h-px flex-1" style={{ backgroundColor: accent }} />
        </div>
      </div>

      <div className="absolute left-[17%] right-[17%] top-[43%] max-h-[24%] overflow-hidden font-serif text-[calc(1.66cqw*var(--certificate-body-scale))] leading-[1.45] text-slate-700">
        <p onClick={(event) => selectElement('bodyText', event)} className={editorClass('bodyText')}>{bodyText || 'has successfully completed the requirements and passed the LMS final examination for'}</p>
        <p onClick={(event) => selectElement('programmeName', event)} className={`${editorClass('programmeName')} mt-[0.55cqw] font-sans text-[calc(1.45cqw*var(--certificate-body-scale))] font-black italic leading-[1.18] text-black`}>-{programmeName}-</p>
        <p onClick={(event) => selectElement('recognitionText', event)} className={editorClass('recognitionText')}>{recognitionText}</p>
        {showProgress ? <p onClick={(event) => selectElement('progress', event)} className={editorClass('progress')}>{progressPrefix} <span className="font-sans font-black italic text-black">-{progressLabel}-</span></p> : null}
      </div>

      {showQr ? (
        <div onClick={handleQrClick} className={`${editorClass('qr')} ${!editable && verificationUrl ? 'cursor-pointer' : ''} absolute bottom-[12%] left-[5.2%]`}>
          <QrMark value={verificationUrl} color={primary} />
        </div>
      ) : null}

      {signatureItems.length ? (
        <div
          className={`${showQr ? 'left-[24%]' : 'left-[12%]'} absolute bottom-[16.8%] right-[15%] grid gap-[6%] text-center`}
          style={{ gridTemplateColumns: `repeat(${signatureItems.length}, minmax(0, 1fr))`, backgroundColor: `rgba(255,255,255,${contentBackdropOpacity})` }}
        >
          {signatureItems.map((item, index) => (
            <div
              key={`${item.label}-${item.value}-${index}`}
              onClick={(event) => selectElement(item.id, event)}
              className={editorClass(item.id)}
            >
              <p className="truncate border-b border-slate-300 pb-[0.45cqw] text-[calc(1.55cqw*var(--certificate-signature-scale))] font-black italic leading-tight text-black">-{item.value}-</p>
              <p className="mt-[0.75cqw] font-serif text-[calc(1.65cqw*var(--certificate-signature-scale))]" style={{ color: accent }}>{item.label}</p>
            </div>
          ))}
        </div>
      ) : null}

      {showFooter ? (
        <p
          onClick={(event) => selectElement('footer', event)}
          className={`${editorClass('footer')} absolute bottom-[8.8%] left-[18%] right-[22%] max-h-[5.8%] overflow-hidden font-serif text-[calc(1.15cqw*var(--certificate-footer-scale))] leading-snug text-slate-700`}
          style={{ backgroundColor: `rgba(255,255,255,${contentBackdropOpacity})` }}
        >
          {footer}
        </p>
      ) : null}
      {showWebsite ? (
        <p
          onClick={(event) => selectElement('website', event)}
          className={`${editorClass('website')} absolute bottom-[5.9%] left-[12%] right-[12%] truncate text-[calc(1.15cqw*var(--certificate-footer-scale))] font-semibold`}
          style={{ color: primary }}
        >
          {website}
        </p>
      ) : null}
    </div>
    {qrPreviewOpen ? <QrPreview value={verificationUrl} color={primary} onClose={() => setQrPreviewOpen(false)} /> : null}
    </>
  );
}
