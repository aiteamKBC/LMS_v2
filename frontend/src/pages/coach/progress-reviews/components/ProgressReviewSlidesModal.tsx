import { useEffect, useRef, useState, type ReactNode } from 'react';
import { toPng } from 'html-to-image';
import { jsPDF } from 'jspdf';
import { useToast } from '@/hooks/useToast';
import { saveProgressReviewPptx } from '../lib/progressReviewPptx';

type SlideTone = 'default' | 'good' | 'warn' | 'danger';

export interface ProgressReviewSlideMetric {
  label: string;
  value: string;
  tone?: SlideTone;
}

export interface ProgressReviewSlideListItem {
  title: string;
  detail?: string;
  meta?: string;
  badge?: string;
  tone?: SlideTone;
}

export interface ProgressReviewSlideColumn {
  title: string;
  items: ProgressReviewSlideListItem[];
}

export type ProgressReviewSlide =
  | {
      id: string;
      title: string;
      type: 'cover';
      eyebrow: string;
      heading: string;
      subheading: string;
      details: Array<{ label: string; value: string }>;
    }
  | {
      id: string;
      title: string;
      type: 'metrics';
      heading: string;
      subheading: string;
      metrics: ProgressReviewSlideMetric[];
      highlights?: ProgressReviewSlideListItem[];
    }
  | {
      id: string;
      title: string;
      type: 'table';
      heading: string;
      subheading: string;
      headers: string[];
      rows: string[][];
      note?: string;
    }
  | {
      id: string;
      title: string;
      type: 'lists';
      heading: string;
      subheading: string;
      columns: ProgressReviewSlideColumn[];
    };

export interface ProgressReviewSlidesDeck {
  learnerName: string;
  reviewLabel: string;
  generatedAt: string;
  windowLabel: string;
  slides: ProgressReviewSlide[];
}

function toneChipClass(tone?: SlideTone) {
  if (tone === 'good') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (tone === 'warn') return 'border-amber-200 bg-amber-50 text-amber-700';
  if (tone === 'danger') return 'border-red-200 bg-red-50 text-red-700';
  return 'border-foreground-200 bg-background-100 text-foreground-600';
}

function toneValueClass(tone?: SlideTone) {
  if (tone === 'good') return 'text-emerald-700';
  if (tone === 'warn') return 'text-amber-700';
  if (tone === 'danger') return 'text-red-700';
  return 'text-foreground-950';
}

function cleanText(value?: string | null) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function detailValue(slide: ProgressReviewSlide, label: string) {
  if (slide.type !== 'cover') return '';
  return cleanText(slide.details.find((detail) => detail.label.toLowerCase() === label.toLowerCase())?.value);
}

function slideMeta(slide: ProgressReviewSlide) {
  const programme = detailValue(slide, 'Programme') || 'Marketing Executive Level 4 Apprenticeship';
  const employer = detailValue(slide, 'Employer') || 'KBC LearningOS';
  const manager = detailValue(slide, 'Line manager');
  return { programme, employer, manager };
}

function bullets(items: ProgressReviewSlideListItem[], limit = 5) {
  return items.slice(0, limit).map((item) => (
    <li key={`${item.title}-${item.meta || ''}`} className="leading-snug">
      <span className="font-bold text-slate-950">{item.title}</span>
      {item.badge ? <span className={`ml-2 rounded-full px-2 py-0.5 text-[10px] font-bold ${toneChipClass(item.tone)}`}>{item.badge}</span> : null}
      {item.detail ? <span className="block pt-1 text-slate-600">{item.detail}</span> : null}
      {item.meta ? <span className="block pt-1 text-[11px] font-semibold uppercase text-slate-400">{item.meta}</span> : null}
    </li>
  ));
}

function SlideShell({
  slide,
  exportMode,
  children,
}: {
  slide: ProgressReviewSlide;
  exportMode: boolean;
  children: ReactNode;
}) {
  const meta = slideMeta(slide);
  return (
    <div className={`relative aspect-video overflow-hidden bg-white text-slate-950 shadow-sm ${exportMode ? '' : 'rounded-xl border border-slate-200'}`}>
      <div className="absolute inset-x-0 top-0 h-14 bg-[#24103f] text-white">
        <div className="flex h-full items-center justify-between px-8">
          <p className="max-w-[58%] truncate text-[10px] font-bold uppercase tracking-[0.16em] text-violet-100">{meta.programme}</p>
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-violet-100">Progress Review</p>
        </div>
      </div>
      <div className="absolute left-8 right-8 top-20">
        <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-violet-700">{slide.title}</p>
        {'heading' in slide ? <h2 className="mt-2 max-w-[920px] text-[26px] font-black leading-tight text-slate-950">{slide.heading}</h2> : null}
        {'subheading' in slide ? <p className="mt-2 max-w-[900px] text-[14px] leading-6 text-slate-600">{slide.subheading}</p> : null}
      </div>
      <div className="absolute left-8 right-8 top-[190px] bottom-14 overflow-hidden">
        {children}
      </div>
      <div className="absolute inset-x-0 bottom-0 flex h-10 items-center justify-between border-t border-slate-200 bg-slate-50 px-8">
        <p className="max-w-[60%] truncate text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">{meta.employer}</p>
        {meta.manager ? <p className="text-[10px] font-semibold text-slate-500">Manager: {meta.manager}</p> : null}
      </div>
    </div>
  );
}

function renderSlideContent(slide: ProgressReviewSlide, exportMode = false) {
  const shellClass = exportMode ? 'h-[640px] w-full' : 'mx-auto w-full max-w-[1120px]';

  return (
    <div className={shellClass}>
      {slide.type === 'cover' ? (
        <div className={`relative aspect-video overflow-hidden bg-white text-slate-950 shadow-sm ${exportMode ? '' : 'rounded-xl border border-slate-200'}`}>
          <div className="absolute inset-x-0 top-0 h-20 bg-[#24103f]" />
          <div className="absolute left-10 top-10 rounded-full bg-white px-4 py-2 text-[11px] font-black uppercase tracking-[0.2em] text-violet-800 shadow-sm">
            {slide.eyebrow}
          </div>
          <div className="absolute left-10 top-36 max-w-[720px]">
            <h1 className="text-[44px] font-black leading-tight text-slate-950">{slide.heading}</h1>
            <p className="mt-5 text-[18px] leading-8 text-slate-600">{slide.subheading}</p>
          </div>
          <div className="absolute bottom-16 left-10 right-10 grid grid-cols-4 gap-3">
            {slide.details.slice(0, 8).map((detail) => (
              <div key={detail.label} className="min-h-[82px] border-l-4 border-violet-700 bg-slate-50 px-4 py-3">
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">{detail.label}</p>
                <p className="mt-2 text-[16px] font-bold leading-snug text-slate-950">{detail.value}</p>
              </div>
            ))}
          </div>
          <div className="absolute inset-x-0 bottom-0 flex h-10 items-center justify-between border-t border-slate-200 bg-slate-50 px-10">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">{detailValue(slide, 'Employer') || 'KBC LearningOS'}</p>
            <p className="text-[10px] font-semibold text-slate-500">{detailValue(slide, 'Review window')}</p>
          </div>
        </div>
      ) : null}

      {slide.type === 'metrics' ? (
        <SlideShell slide={slide} exportMode={exportMode}>
          <div className="grid grid-cols-4 gap-3">
            {slide.metrics.slice(0, 8).map((metric) => (
              <div key={metric.label} className="min-h-[92px] border-t-4 border-violet-700 bg-slate-50 px-4 py-3">
                <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">{metric.label}</p>
                <p className={`mt-2 text-[26px] font-black leading-none ${toneValueClass(metric.tone)}`}>{metric.value}</p>
              </div>
            ))}
          </div>
          {slide.highlights?.length ? (
            <div className="mt-5 grid grid-cols-2 gap-4">
              {slide.highlights.slice(0, 4).map((item) => (
                <div key={`${item.title}-${item.meta || ''}`} className="min-h-[102px] bg-white p-4 ring-1 ring-slate-200">
                  <div className="flex items-center gap-2">
                    <p className="text-[14px] font-black text-slate-950">{item.title}</p>
                    {item.badge ? <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${toneChipClass(item.tone)}`}>{item.badge}</span> : null}
                  </div>
                  {item.detail ? <p className="mt-2 text-[12px] leading-5 text-slate-600">{item.detail}</p> : null}
                  {item.meta ? <p className="mt-2 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">{item.meta}</p> : null}
                </div>
              ))}
            </div>
          ) : null}
        </SlideShell>
      ) : null}

      {slide.type === 'table' ? (
        <SlideShell slide={slide} exportMode={exportMode}>
          <div className="overflow-hidden border border-slate-200">
            <table className="min-w-full border-collapse text-left text-[11px]">
              <thead className="bg-[#24103f] text-white">
                <tr>
                  {slide.headers.map((header) => (
                    <th key={header} className="px-3 py-2 font-black uppercase tracking-[0.12em]">
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="bg-white">
                {slide.rows.slice(0, 10).map((row, rowIndex) => (
                  <tr key={`${slide.id}-${rowIndex}`} className={rowIndex % 2 === 1 ? 'bg-slate-50' : ''}>
                    {row.map((cell, cellIndex) => (
                      <td key={`${slide.id}-${rowIndex}-${cellIndex}`} className="border-t border-slate-200 px-3 py-2 align-top text-slate-700">
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {slide.note ? (
            <div className="mt-4 border-l-4 border-violet-700 bg-violet-50 px-4 py-3 text-[12px] leading-5 text-slate-700">
              {slide.note}
            </div>
          ) : null}
        </SlideShell>
      ) : null}

      {slide.type === 'lists' ? (
        <SlideShell slide={slide} exportMode={exportMode}>
          <div className={`grid h-full gap-6 ${slide.columns.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
            {slide.columns.map((column) => (
              <section key={column.title} className="bg-white">
                <div className="border-l-4 border-violet-700 pl-3">
                  <p className="text-[12px] font-black uppercase tracking-[0.16em] text-violet-700">{column.title}</p>
                </div>
                {column.items.length ? (
                  <ul className="mt-4 space-y-3 text-[12px] text-slate-600">
                    {bullets(column.items, slide.columns.length > 1 ? 5 : 8)}
                  </ul>
                ) : (
                  <div className="mt-4 border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-[12px] text-slate-400">
                    No data available for this section.
                  </div>
                )}
              </section>
            ))}
          </div>
        </SlideShell>
      ) : null}
    </div>
  );
}

export default function ProgressReviewSlidesModal({
  open,
  deck,
  onClose,
  primaryAction,
}: {
  open: boolean;
  deck: ProgressReviewSlidesDeck | null;
  onClose: () => void;
  primaryAction?: ReactNode;
}) {
  const [currentSlide, setCurrentSlide] = useState(0);
  const [mounted, setMounted] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isExportingPptx, setIsExportingPptx] = useState(false);
  const exportContainerRef = useRef<HTMLDivElement>(null);
  const { success, error } = useToast();

  useEffect(() => {
    if (open) {
      const timeout = window.setTimeout(() => setMounted(true), 80);
      return () => window.clearTimeout(timeout);
    }
    setMounted(false);
    setCurrentSlide(0);
    return undefined;
  }, [open, deck?.learnerName]);

  if (!open || !deck) return null;

  const current = deck.slides[currentSlide];

  async function handleExportPdf() {
    setIsExporting(true);
    try {
      const pdf = new jsPDF({ orientation: 'landscape', unit: 'px', format: [1280, 720] });
      const slideElements = exportContainerRef.current?.querySelectorAll('[data-export-slide]');
      if (!slideElements?.length) {
        error('Export failed', 'Could not capture the generated slides.');
        return;
      }
      for (let index = 0; index < slideElements.length; index += 1) {
        const element = slideElements[index] as HTMLElement;
        const image = await toPng(element, {
          backgroundColor: '#ffffff',
          pixelRatio: 2,
          skipFonts: true,
        });
        if (index > 0) pdf.addPage();
        pdf.addImage(image, 'PNG', 0, 0, 1280, 720);
      }
      const learnerSlug = deck.learnerName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      pdf.save(`progress-review-slides-${learnerSlug || 'learner'}.pdf`);
      success('Slides exported', 'The progress review slides were downloaded as a PDF.');
    } catch {
      error('Export failed', 'Something went wrong while generating the slide deck PDF.');
    } finally {
      setIsExporting(false);
    }
  }

  async function handleExportPptx() {
    setIsExportingPptx(true);
    try {
      await saveProgressReviewPptx(deck);
      success('PPTX exported', 'The editable progress review PowerPoint was downloaded.');
    } catch {
      error('Export failed', 'Something went wrong while generating the PowerPoint deck.');
    } finally {
      setIsExportingPptx(false);
    }
  }

  return (
    <>
      <div ref={exportContainerRef} className="fixed left-[-9999px] top-0 z-[-1] w-[1280px]" aria-hidden="true">
        {deck.slides.map((slide, index) => (
          <div key={slide.id} data-export-slide className="h-[720px] w-[1280px] bg-[#f5f5f4] p-10">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="text-[12px] font-bold uppercase tracking-[0.18em] text-foreground-400">{deck.reviewLabel}</p>
                <p className="mt-1 text-sm text-foreground-500">{deck.learnerName} · {deck.windowLabel}</p>
              </div>
              <span className="rounded-full border border-foreground-200 bg-white px-3 py-1 text-[12px] font-bold text-foreground-600">
                Slide {index + 1} of {deck.slides.length}
              </span>
            </div>
            {renderSlideContent(slide, true)}
          </div>
        ))}
      </div>

      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-foreground-950/60 backdrop-blur-sm" onClick={onClose} />
        <div
          className="relative flex h-[94vh] w-full max-w-[1500px] flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#eef1f5] shadow-2xl transition-all duration-300"
          style={{
            opacity: mounted ? 1 : 0,
            transform: mounted ? 'translateY(0px) scale(1)' : 'translateY(16px) scale(0.98)',
          }}
        >
          <header className="border-b border-foreground-200 bg-white px-6 py-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0">
                <p className="text-[12px] font-bold uppercase tracking-[0.18em] text-foreground-400">{deck.reviewLabel}</p>
                <h2 className="mt-2 truncate text-2xl font-heading font-bold tracking-[-0.02em] text-foreground-950">
                  {deck.learnerName} · 12-week review slides
                </h2>
                <p className="mt-1 text-sm text-foreground-500">
                  {deck.windowLabel} · Generated {deck.generatedAt}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {primaryAction}
                <button
                  type="button"
                  onClick={handleExportPdf}
                  disabled={isExporting}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-foreground-200 bg-white px-4 text-[12px] font-semibold text-foreground-700 transition hover:bg-background-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <AppIcon className={isExporting ? 'ri-loader-4-line animate-spin' : 'ri-download-line'}></AppIcon>
                  {isExporting ? 'Exporting PDF' : 'Export PDF'}
                </button>
                <button
                  type="button"
                  onClick={handleExportPptx}
                  disabled={isExportingPptx}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-foreground-200 bg-white px-4 text-[12px] font-semibold text-foreground-700 transition hover:bg-background-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <AppIcon className={isExportingPptx ? 'ri-loader-4-line animate-spin' : 'ri-slideshow-line'}></AppIcon>
                  {isExportingPptx ? 'Exporting PPTX' : 'Export PPTX'}
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-foreground-950 px-4 text-[12px] font-semibold text-white transition hover:bg-foreground-800"
                >
                  <AppIcon className="ri-close-line"></AppIcon>Close
                </button>
              </div>
            </div>
          </header>

          <div className="border-b border-foreground-200 bg-white px-6 py-3">
            <div className="flex items-center gap-2 overflow-x-auto pb-1">
              {deck.slides.map((slide, index) => (
                <button
                  key={slide.id}
                  type="button"
                  onClick={() => setCurrentSlide(index)}
                  className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-[12px] font-semibold transition ${
                    index === currentSlide
                      ? 'border-foreground-950 bg-foreground-950 text-white'
                      : 'border-foreground-200 bg-background-100/70 text-foreground-600 hover:border-foreground-300 hover:bg-background-100'
                  }`}
                >
                  <span className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[12px] font-bold ${
                    index === currentSlide ? 'bg-white/15 text-white' : 'bg-white text-foreground-500'
                  }`}>
                    {index + 1}
                  </span>
                  {slide.title}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-6">
            <div className="mx-auto max-w-[1200px]">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <p className="text-[12px] font-bold uppercase tracking-[0.18em] text-foreground-400">Current Slide</p>
                  <h3 className="mt-1 text-lg font-semibold text-foreground-950">{current.title}</h3>
                </div>
                <span className="rounded-full border border-foreground-200 bg-white px-3 py-1 text-[12px] font-bold text-foreground-600">
                  {currentSlide + 1} / {deck.slides.length}
                </span>
              </div>
              {renderSlideContent(current)}
            </div>
          </div>

          <footer className="flex items-center justify-between border-t border-foreground-200 bg-white px-6 py-4">
            <p className="text-[12px] text-foreground-500">Auto-generated from learner progress, evidence, quiz, and KSB data for the selected 12-week window.</p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setCurrentSlide((value) => Math.max(0, value - 1))}
                disabled={currentSlide === 0}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-foreground-200 bg-white px-4 text-[12px] font-semibold text-foreground-700 transition hover:bg-background-100 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <AppIcon className="ri-arrow-left-line"></AppIcon>Previous
              </button>
              <button
                type="button"
                onClick={() => setCurrentSlide((value) => Math.min(deck.slides.length - 1, value + 1))}
                disabled={currentSlide === deck.slides.length - 1}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-foreground-950 px-4 text-[12px] font-semibold text-white transition hover:bg-foreground-800 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Next<AppIcon className="ri-arrow-right-line"></AppIcon>
              </button>
            </div>
          </footer>
        </div>
      </div>
    </>
  );
}
