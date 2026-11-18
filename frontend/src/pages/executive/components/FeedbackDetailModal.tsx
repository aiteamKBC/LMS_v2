import type { Feedback } from "@/pages/dashboard/types";
import { fmtDate } from "@/pages/dashboard/utils";

function statusClass(status: Feedback["status"]) {
  if (status === "Escalated") return "bg-red-50 text-red-700";
  if (status === "Acknowledged") return "bg-amber-50 text-amber-800";
  return "bg-background-100 text-foreground-600";
}

export default function FeedbackDetailModal({ feedback, onClose, onOpenWorkspace }: { feedback: Feedback; onClose: () => void; onOpenWorkspace?: () => void }) {
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-foreground-950/35 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="w-full max-w-xl rounded-2xl border border-background-200 bg-background-50 shadow-xl" role="dialog" aria-modal="true" aria-labelledby="red-feedback-detail-title">
        <div className="flex items-start justify-between gap-4 border-b border-background-200 px-5 py-4"><div><p className="font-label text-[10px] font-semibold uppercase tracking-[0.12em] text-red-700">Red feedback</p><h2 id="red-feedback-detail-title" className="mt-1 font-heading text-[20px] font-semibold text-foreground-950">{feedback.author}</h2><p className="mt-1 text-[12px] text-foreground-600">{feedback.source} · {feedback.organisation}</p></div><button type="button" aria-label="Close feedback details" className="flex size-8 items-center justify-center rounded-md border border-background-300 text-foreground-600 hover:bg-background-100" onClick={onClose}><i className="ri-close-line text-[17px]" aria-hidden="true" /></button></div>
        <div className="space-y-4 p-5"><div className="flex flex-wrap items-center gap-2 text-[11px]"><span className="rounded-full bg-red-100 px-2 py-1 font-semibold text-red-700">Red</span><span className={`rounded-full px-2 py-1 font-semibold ${statusClass(feedback.status)}`}>{feedback.status}</span><span className="text-foreground-500">{fmtDate(feedback.date)}</span></div><dl className="grid gap-3 rounded-xl bg-background-100 p-4 text-[12px] sm:grid-cols-2"><div><dt className="text-foreground-500">Coach</dt><dd className="mt-0.5 font-semibold text-foreground-900">{feedback.coach}</dd></div><div><dt className="text-foreground-500">Programme</dt><dd className="mt-0.5 font-semibold text-foreground-900">{feedback.programme}</dd></div><div className="sm:col-span-2"><dt className="text-foreground-500">Topic</dt><dd className="mt-0.5 font-semibold text-foreground-900">{feedback.topic}</dd></div></dl><div className="rounded-xl border border-red-100 bg-red-50/50 p-4"><p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-red-700">Feedback details</p><p className="mt-2 text-[13px] leading-relaxed text-foreground-800">{feedback.comment}</p></div><div className="flex flex-wrap justify-end gap-2"><button type="button" className="rounded-md border border-background-300 px-3 py-2 text-[11px] font-semibold text-foreground-700 hover:bg-background-100" onClick={onClose}>Close</button>{onOpenWorkspace ? <button type="button" className="rounded-md bg-primary-600 px-3 py-2 text-[11px] font-semibold text-background-50 hover:bg-primary-700" onClick={onOpenWorkspace}>Open Feedbacks workspace</button> : null}</div></div>
      </section>
    </div>
  );
}
