import { useId, useState } from 'react';
import { ChevronDown, FileText } from 'lucide-react';
import { EvidencePdfActions } from '@/pages/coaching-recordings/SavedEvidencePdf';
import { loadLectureTranscriptPdf } from '../lectureTranscript';
import type { TeachingLectureScope } from '../teachingQuality';

export default function LectureTranscript({ scope }: { scope: TeachingLectureScope }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return <section aria-label="Lecture transcript" className="mt-5 space-y-3 border-t border-background-200 pt-4">
    <div className="rounded-xl border border-background-200 bg-white">
      <button type="button" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(value => !value)}
        className="flex w-full items-center justify-between gap-2 rounded-xl p-3 text-left text-sm font-semibold text-primary-800 hover:bg-primary-50">
        <span className="inline-flex items-center gap-2"><FileText size={16} />Transcript</span>
        <ChevronDown size={15} className={open ? 'rotate-180' : ''} />
      </button>
      <div id={panelId} hidden={!open} className="border-t border-background-100 p-3">
        {open && <EvidencePdfActions kind="transcript" filename="tutor-session-transcript.pdf"
          loadPdf={signal => loadLectureTranscriptPdf(scope, signal)} />}
      </div>
    </div>
  </section>;
}
