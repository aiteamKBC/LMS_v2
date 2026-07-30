import { useEffect, useRef, useState } from 'react';
import { toPng } from 'html-to-image';
import { jsPDF } from 'jspdf';
import { useToast } from '@/hooks/useToast';

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

function renderSlideContent(slide: ProgressReviewSlide, exportMode = false) {
  const frameClass = exportMode
    ? 'min-h-[640px] rounded-[28px] border border-foreground-200 bg-white p-10'
    : 'min-h-[560px] rounded-[28px] border border-foreground-200 bg-white p-8';

  return (
    <div className={frameClass}>
      {slide.type === 'cover' ? (
        <div className="flex min-h-[560px] flex-col justify-between">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-foreground-400">{slide.eyebrow}</p>
            <h2 className="mt-5 max-w-3xl text-4xl font-heading font-bold tracking-[-0.03em] text-foreground-950">{slide.heading}</h2>
            <p className="mt-4 max-w-2xl text-base leading-8 text-foreground-500">{slide.subheading}</p>
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {slide.details.map((detail) => (
              <div key={detail.label} className="rounded-3xl border border-foreground-200 bg-background-100/60 px-5 py-4">
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-foreground-400">{detail.label}</p>
                <p className="mt-3 text-lg font-semibold leading-7 text-foreground-950">{detail.value}</p>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {slide.type === 'metrics' ? (
        <div className="space-y-6">
          <div>
            <h3 className="text-2xl font-heading font-bold text-foreground-950">{slide.heading}</h3>
            <p className="mt-2 text-sm leading-7 text-foreground-500">{slide.subheading}</p>
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {slide.metrics.map((metric) => (
              <div key={metric.label} className="rounded-3xl border border-foreground-200 bg-background-100/60 px-5 py-4">
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-foreground-400">{metric.label}</p>
                <p className={`mt-3 text-2xl font-heading font-bold ${toneValueClass(metric.tone)}`}>{metric.value}</p>
              </div>
            ))}
          </div>
          {slide.highlights?.length ? (
            <div className="rounded-3xl border border-foreground-200 bg-white px-5 py-5">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-foreground-400">Highlights</p>
              <div className="mt-4 grid gap-3 xl:grid-cols-2">
                {slide.highlights.map((item) => (
                  <div key={`${item.title}-${item.meta || ''}`} className="rounded-2xl border border-foreground-200 bg-background-100/45 px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-foreground-900">{item.title}</p>
                      {item.badge ? (
                        <span className={`rounded-full border px-2.5 py-1 text-[10px] font-bold ${toneChipClass(item.tone)}`}>
                          {item.badge}
                        </span>
                      ) : null}
                    </div>
                    {item.detail ? <p className="mt-2 text-sm leading-6 text-foreground-600">{item.detail}</p> : null}
                    {item.meta ? <p className="mt-2 text-[11px] font-medium text-foreground-400">{item.meta}</p> : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {slide.type === 'table' ? (
        <div className="space-y-6">
          <div>
            <h3 className="text-2xl font-heading font-bold text-foreground-950">{slide.heading}</h3>
            <p className="mt-2 text-sm leading-7 text-foreground-500">{slide.subheading}</p>
          </div>
          <div className="overflow-hidden rounded-3xl border border-foreground-200">
            <table className="min-w-full divide-y divide-foreground-200 text-left text-[12px]">
              <thead className="bg-background-100/80">
                <tr>
                  {slide.headers.map((header) => (
                    <th key={header} className="px-4 py-3 font-bold uppercase tracking-[0.12em] text-foreground-500">
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-foreground-200 bg-white">
                {slide.rows.map((row, rowIndex) => (
                  <tr key={`${slide.id}-${rowIndex}`} className={rowIndex % 2 === 1 ? 'bg-background-100/35' : ''}>
                    {row.map((cell, cellIndex) => (
                      <td key={`${slide.id}-${rowIndex}-${cellIndex}`} className="px-4 py-3 align-top text-foreground-700">
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {slide.note ? (
            <div className="rounded-2xl border border-foreground-200 bg-background-100/55 px-4 py-3 text-sm leading-6 text-foreground-600">
              {slide.note}
            </div>
          ) : null}
        </div>
      ) : null}

      {slide.type === 'lists' ? (
        <div className="space-y-6">
          <div>
            <h3 className="text-2xl font-heading font-bold text-foreground-950">{slide.heading}</h3>
            <p className="mt-2 text-sm leading-7 text-foreground-500">{slide.subheading}</p>
          </div>
          <div className={`grid gap-4 ${slide.columns.length > 1 ? 'xl:grid-cols-2' : ''}`}>
            {slide.columns.map((column) => (
              <section key={column.title} className="rounded-3xl border border-foreground-200 bg-white px-5 py-5">
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-foreground-400">{column.title}</p>
                <div className="mt-4 space-y-3">
                  {column.items.length ? column.items.map((item) => (
                    <div key={`${column.title}-${item.title}-${item.meta || ''}`} className="rounded-2xl border border-foreground-200 bg-background-100/45 px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold text-foreground-900">{item.title}</p>
                        {item.badge ? (
                          <span className={`rounded-full border px-2.5 py-1 text-[10px] font-bold ${toneChipClass(item.tone)}`}>
                            {item.badge}
                          </span>
                        ) : null}
                      </div>
                      {item.detail ? <p className="mt-2 text-sm leading-6 text-foreground-600">{item.detail}</p> : null}
                      {item.meta ? <p className="mt-2 text-[11px] font-medium text-foreground-400">{item.meta}</p> : null}
                    </div>
                  )) : (
                    <div className="rounded-2xl border border-dashed border-foreground-200 bg-background-100/45 px-4 py-5 text-sm text-foreground-400">
                      No data available for this section.
                    </div>
                  )}
                </div>
              </section>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function ProgressReviewSlidesModal({
  open,
  deck,
  onClose,
}: {
  open: boolean;
  deck: ProgressReviewSlidesDeck | null;
  onClose: () => void;
}) {
  const [currentSlide, setCurrentSlide] = useState(0);
  const [mounted, setMounted] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
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

  return (
    <>
      <div ref={exportContainerRef} className="fixed left-[-9999px] top-0 z-[-1] w-[1280px]" aria-hidden="true">
        {deck.slides.map((slide, index) => (
          <div key={slide.id} data-export-slide className="h-[720px] w-[1280px] bg-[#f5f5f4] p-10">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-foreground-400">{deck.reviewLabel}</p>
                <p className="mt-1 text-sm text-foreground-500">{deck.learnerName} · {deck.windowLabel}</p>
              </div>
              <span className="rounded-full border border-foreground-200 bg-white px-3 py-1 text-[11px] font-bold text-foreground-600">
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
          className="relative flex h-[92vh] w-full max-w-7xl flex-col overflow-hidden rounded-[32px] border border-white/10 bg-[#f5f5f4] shadow-2xl transition-all duration-300"
          style={{
            opacity: mounted ? 1 : 0,
            transform: mounted ? 'translateY(0px) scale(1)' : 'translateY(16px) scale(0.98)',
          }}
        >
          <header className="border-b border-foreground-200 bg-white px-6 py-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0">
                <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-foreground-400">{deck.reviewLabel}</p>
                <h2 className="mt-2 truncate text-2xl font-heading font-bold tracking-[-0.02em] text-foreground-950">
                  {deck.learnerName} · 12-week review slides
                </h2>
                <p className="mt-1 text-sm text-foreground-500">
                  {deck.windowLabel} · Generated {deck.generatedAt}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleExportPdf}
                  disabled={isExporting}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-foreground-200 bg-white px-4 text-[12px] font-semibold text-foreground-700 transition hover:bg-background-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <i className={isExporting ? 'ri-loader-4-line animate-spin' : 'ri-download-line'}></i>
                  {isExporting ? 'Exporting PDF' : 'Export PDF'}
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-foreground-950 px-4 text-[12px] font-semibold text-white transition hover:bg-foreground-800"
                >
                  <i className="ri-close-line"></i>Close
                </button>
              </div>
            </div>
          </header>

          <div className="border-b border-foreground-200 bg-white px-6 py-3">
            <div className="flex flex-wrap items-center gap-2">
              {deck.slides.map((slide, index) => (
                <button
                  key={slide.id}
                  type="button"
                  onClick={() => setCurrentSlide(index)}
                  className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-[11px] font-semibold transition ${
                    index === currentSlide
                      ? 'border-foreground-950 bg-foreground-950 text-white'
                      : 'border-foreground-200 bg-background-100/70 text-foreground-600 hover:border-foreground-300 hover:bg-background-100'
                  }`}
                >
                  <span className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[10px] font-bold ${
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
            <div className="mx-auto max-w-6xl">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-foreground-400">Current Slide</p>
                  <h3 className="mt-1 text-lg font-semibold text-foreground-950">{current.title}</h3>
                </div>
                <span className="rounded-full border border-foreground-200 bg-white px-3 py-1 text-[11px] font-bold text-foreground-600">
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
                className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-foreground-200 bg-white px-4 text-[12px] font-semibold text-foreground-700 transition hover:bg-background-100 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <i className="ri-arrow-left-line"></i>Previous
              </button>
              <button
                type="button"
                onClick={() => setCurrentSlide((value) => Math.min(deck.slides.length - 1, value + 1))}
                disabled={currentSlide === deck.slides.length - 1}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-foreground-950 px-4 text-[12px] font-semibold text-white transition hover:bg-foreground-800 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Next<i className="ri-arrow-right-line"></i>
              </button>
            </div>
          </footer>
        </div>
      </div>
    </>
  );
}
