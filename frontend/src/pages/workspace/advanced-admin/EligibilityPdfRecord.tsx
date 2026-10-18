import { useEffect, useState } from 'react';
import { advancedAdminEligibilityForm, advancedAdminOriginalReviewPdf } from '@/api/advancedAdmin';
import { buildReviewPdf, reviewDocumentFilename } from '@/pages/learner/onboarding/reviews/reviewDocument';
import { REVIEW_QUESTION_LABELS } from '@/pages/learner/onboarding/reviews/questions';

interface EligibilityPdfRecordProps {
  learnerId: number;
  recordKey: string;
  label: string;
  status: string;
  date: string | null;
  source: 'native' | 'imported';
  aptemReviewId?: string;
}

export default function EligibilityPdfRecord({ learnerId, recordKey, label, status, date, source, aptemReviewId }: EligibilityPdfRecordProps) {
  const [open, setOpen] = useState(false);
  const [pdfUrl, setPdfUrl] = useState('');
  const [filename, setFilename] = useState('eligibility-review.pdf');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) {
      setPdfUrl('');
      return;
    }
    const controller = new AbortController();
    let objectUrl = '';
    setPdfUrl('');
    setError('');
    async function load() {
      let blob: Blob;
      let name = 'eligibility-review.pdf';
      if (source === 'imported') {
        if (!aptemReviewId) throw new Error('The original PDF is unavailable for this review.');
        const response = await fetch(advancedAdminOriginalReviewPdf(learnerId, aptemReviewId), {
          credentials: 'include', signal: controller.signal,
          headers: { 'X-Requested-With': 'XMLHttpRequest' },
        });
        if (!response.ok || !response.headers.get('content-type')?.includes('application/pdf')) {
          throw new Error('The original PDF is unavailable for this review.');
        }
        blob = await response.blob();
      } else {
        const form = await advancedAdminEligibilityForm(learnerId, recordKey, controller.signal);
        blob = buildReviewPdf(form, REVIEW_QUESTION_LABELS).output('blob');
        name = reviewDocumentFilename(form);
      }
      if (controller.signal.aborted) return;
      objectUrl = URL.createObjectURL(blob);
      setFilename(name);
      setPdfUrl(objectUrl);
    }
    void load().catch((cause: unknown) => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'This review PDF could not be opened. Please try again.');
    });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [open, learnerId, recordKey, source, aptemReviewId]);

  return <details className="rounded-2xl border bg-white p-5 text-sm" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary className="cursor-pointer font-semibold">{label || 'Eligibility Review'} · {status} · {date?.slice(0, 10) || 'Date not recorded'}</summary>
    {open && <div className="mt-4 space-y-3">
      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-700">{error}</p>}
      {!error && !pdfUrl && <p role="status" className="text-foreground-600">Loading PDF…</p>}
      {pdfUrl && <>
        <a className="inline-block font-semibold text-primary-700 underline" href={pdfUrl} download={filename}>Download PDF</a>
        <iframe title={`${label || 'Eligibility Review'} PDF`} src={pdfUrl} className="h-[min(80vh,900px)] w-full rounded-lg border border-foreground-200" />
      </>}
    </div>}
  </details>;
}
